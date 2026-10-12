-- Pagos en el checkout, T5: la orden pagada se convierte en VENTA sola.
-- Diseño: docs/pagos-auditoria.md §10 y §11 (la venta se registra sola; la
-- transferencia va solo al alias de Mercado Pago conectado).
--
--  1. Métodos de pago de la tienda (`metodos_pago.uso_tienda`): nacen
--     INACTIVOS y un CHECK lo garantiza. Todos los selectores (POS, cobro de
--     CC, reintegro, corrección de medio, catálogo) filtran `activo`, así que
--     no aparecen para elegir en ningún lado; solo los usa la venta online.
--     Los dos cobran en UNA cuenta "Mercado Pago (tienda online)".
--  2. `_registrar_venta_orden_tienda`: UNA transacción que, con la orden
--     bloqueada, escribe venta + cobro + renglones + descuentos y marca la
--     orden PAGADA. NO toca stock (salió al crear la orden). Sin turno y sin
--     vendedor: la plata es digital, no pasa por el cajón, y la venta no es de
--     ninguna vendedora (no suma comisiones). Idempotente: una orden con venta
--     devuelve esa venta; la clave del evento no se repite. Solo service_role.
--  3. `confirmar_transferencia_orden`: el botón del panel. Pide
--     `ventas.cobrar` y el negocio sale de la sesión.
--  4. `cancelar_orden_tienda`: el comercio cancela una orden impaga y el stock
--     vuelve (mismo `_devolver_stock_orden_tienda` que el vencimiento).
--  5. `orden_tienda_publica(token)`: la página de la orden para la clienta
--     (anon). Antes de leer, vence las del negocio (STOPGAP sin pg_cron).
--  6. `tomar_turno_conciliacion_mp`: a lo sumo una conciliación de
--     transferencias por negocio cada N segundos (la dispara la lectura).
--
-- Reversión: supabase/reversals/20261012162839_tienda_cobrar_orden.sql

-- ─── 1. Métodos de la tienda: siempre inactivos ──────────────────────────
alter table public.metodos_pago
  add constraint metodos_pago_uso_tienda_inactivo check (uso_tienda is null or activo = false);

create table public.conciliaciones_mp (
  negocio_id uuid primary key references public.negocios(id) on delete cascade,
  ultima_en timestamptz not null default now()
);
alter table public.conciliaciones_mp enable row level security;
revoke all on public.conciliaciones_mp from public, anon, authenticated;

create or replace function public.metodo_pago_tienda(p_negocio uuid, p_uso text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_cuenta uuid;
begin
  if p_uso not in ('MP_CHECKOUT', 'TRANSFERENCIA_MP') then
    raise exception 'USO_TIENDA_DESCONOCIDO';
  end if;

  select m.id into v_id from public.metodos_pago m
   where m.negocio_id = p_negocio and m.uso_tienda = p_uso;
  if v_id is not null then return v_id; end if;

  -- Dos ventas a la vez del mismo negocio no crean dos métodos ni dos cuentas.
  perform pg_advisory_xact_lock(hashtextextended(p_negocio::text, 4417));
  select m.id into v_id from public.metodos_pago m
   where m.negocio_id = p_negocio and m.uso_tienda = p_uso;
  if v_id is not null then return v_id; end if;

  -- La cuenta es la de Mercado Pago del comercio: la comparten los dos medios.
  select m.cuenta_destino_id into v_cuenta from public.metodos_pago m
   where m.negocio_id = p_negocio and m.uso_tienda is not null and m.cuenta_destino_id is not null
   limit 1;
  if v_cuenta is null then
    insert into public.cuentas_financieras (
      negocio_id, codigo, nombre, tipo, es_efectivo, requiere_arqueo, es_sistema, activa
    ) values (
      p_negocio, 'MP_TIENDA_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      'Mercado Pago (tienda online)', 'BILLETERA', false, false, false, true
    ) returning id into v_cuenta;
  end if;

  insert into public.metodos_pago (
    negocio_id, nombre, tipo, comision, acreditacion_dias, activo, recargo_porcentaje,
    cuenta_destino_id, uso_tienda
  ) values (
    p_negocio,
    case p_uso when 'MP_CHECKOUT' then 'Mercado Pago (tienda online)'
               else 'Transferencia a Mercado Pago (tienda online)' end,
    case p_uso when 'MP_CHECKOUT' then 'BILLETERA_VIRTUAL' else 'TRANSFERENCIA' end,
    0, 0, false, 0, v_cuenta, p_uso
  ) returning id into v_id;

  return v_id;
end $$;

-- ─── 2. La venta de una orden pagada ─────────────────────────────────────
create or replace function public._registrar_venta_orden_tienda(
  p_negocio uuid, p_orden uuid, p_origen text, p_usuario uuid, p_pago jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orden record;
  v_metodo record;
  v_metodo_id uuid;
  v_venta_id uuid := gen_random_uuid();
  v_mercaderia numeric;
  v_costo numeric;
  v_unidades numeric;
  v_comision numeric;
  v_promos jsonb;
  v_una_promo uuid;
  v_clave text;
  v_mp_payment text := nullif(p_pago->>'mp_payment_id', '');
begin
  if p_origen not in ('MANUAL', 'MP_WEBHOOK', 'SISTEMA') then raise exception 'ORIGEN_INVALIDO'; end if;

  -- La orden BLOQUEADA: dos confirmaciones a la vez (el botón y la
  -- conciliación, o dos webhooks) esperan acá y la segunda ve la venta hecha.
  select * into v_orden from public.ordenes_tienda o
   where o.id = p_orden and o.negocio_id = p_negocio
   for update;
  if v_orden.id is null then raise exception 'ORDEN_NO_ENCONTRADA'; end if;

  v_clave := coalesce(nullif(p_pago->>'clave', ''),
                      case when v_mp_payment is not null then 'mp:' || v_mp_payment || ':approved'
                           else 'manual:' || p_orden end);

  if v_orden.venta_id is not null then
    insert into public.eventos_pago (negocio_id, orden_id, origen, clave_idempotencia, mp_payment_id,
                                     monto, moneda, payload, resultado, usuario_id)
    values (p_negocio, p_orden, p_origen, v_clave, v_mp_payment, (p_pago->>'monto')::numeric,
            p_pago->>'moneda', coalesce(p_pago->'resumen', '{}'::jsonb),
            case when v_mp_payment is not null and v_mp_payment is distinct from v_orden.mp_payment_id
                 then 'PAGO_DUPLICADO' else 'DUPLICADO' end, p_usuario)
    on conflict (clave_idempotencia) do nothing;
    return jsonb_build_object('venta_id', v_orden.venta_id, 'numero', v_orden.numero, 'ya_registrada', true);
  end if;

  -- Solo se cobra lo que sigue apartado. Una orden vencida ya devolvió su
  -- stock: registrarla vendería mercadería que pudo haberse vendido a otra.
  if v_orden.estado not in ('PENDIENTE_PAGO', 'EN_PROCESO') or v_orden.stock_liberado_en is not null then
    raise exception 'ORDEN_NO_COBRABLE' using detail = v_orden.estado;
  end if;

  v_metodo_id := public.metodo_pago_tienda(
    p_negocio, case when v_orden.medio = 'TRANSFERENCIA' then 'TRANSFERENCIA_MP' else 'MP_CHECKOUT' end);
  select m.id, m.nombre, m.tipo, m.comision, m.acreditacion_dias into v_metodo
    from public.metodos_pago m where m.id = v_metodo_id;

  -- Comisión: la REAL del pago si MP la informó (T7); si no, la del método.
  v_comision := coalesce((p_pago->>'comision_monto')::numeric,
                         round(v_orden.total * coalesce(v_metodo.comision, 0) / 100, 2));

  select coalesce(sum(i.subtotal), 0), coalesce(sum(i.cantidad), 0),
         coalesce(sum(i.cantidad * coalesce(v.costo, p.precio_costo, 0)), 0)
    into v_mercaderia, v_unidades, v_costo
    from public.ordenes_tienda_items i
    left join public.producto_variantes v on v.id = i.variante_id and v.negocio_id = p_negocio
    left join public.productos p on p.id = i.producto_id and p.negocio_id = p_negocio
   where i.negocio_id = p_negocio and i.orden_id = p_orden;

  v_promos := coalesce(v_orden.promociones_aplicadas, '[]'::jsonb);
  if jsonb_array_length(v_promos) = 1 then
    v_una_promo := nullif(v_promos->0->>'id', '')::uuid;
  end if;

  insert into public.ventas (
    id, negocio_id, vendedor_id, cliente_id, turno_caja_id, estado_operacion,
    metodo_pago, total, precio_costo, cantidad, total_bruto,
    recargo_metodo_total, comision_total, total_neto, es_pago_mixto,
    monto_cobrado, monto_pendiente, estado_pago,
    recargo_cc_porcentaje, recargo_cc_monto, fecha_venta, registrada_offline
  ) values (
    v_venta_id, p_negocio, null, null, null, 'CONFIRMADA',
    case when v_orden.medio = 'TRANSFERENCIA' then 'TRANSFERENCIA' else 'TARJETA' end,
    v_orden.total, v_costo, v_unidades, v_orden.total,
    v_orden.recargo, v_comision, v_orden.total - v_comision, false,
    v_orden.total, 0, 'PAGADA',
    0, 0, now(), false
  );

  insert into public.venta_pagos (
    negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
    monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
    comision_porcentaje, comision_monto, monto_neto, acreditacion_dias, turno_caja_id
  ) values (
    p_negocio, v_venta_id, v_metodo.id, v_metodo.nombre, v_metodo.tipo,
    v_orden.total - v_orden.recargo,
    case when v_orden.total - v_orden.recargo > 0
         then round(v_orden.recargo * 100 / (v_orden.total - v_orden.recargo), 2) else 0 end,
    v_orden.recargo, v_orden.total,
    case when v_orden.total > 0 then round(v_comision * 100 / v_orden.total, 2) else 0 end,
    v_comision, v_orden.total - v_comision, coalesce(v_metodo.acreditacion_dias, 0), null
  );

  -- Renglones: el descuento de la orden se prorratea por peso de cada
  -- renglón, por unidad (la misma forma que `create-sale.ts`).
  insert into public.ventas_items (
    negocio_id, venta_id, producto_id, variante, variante_id, cantidad,
    precio_unitario, precio_costo, descuento_monto, precio_final,
    promocion_id, promocion_nombre, es_venta_libre, motivo_sin_imei
  )
  select p_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.cantidad,
         i.precio_unitario,
         coalesce(v.costo, p.precio_costo, 0),
         case when v_mercaderia > 0 then v_orden.descuento * (i.subtotal / v_mercaderia) / i.cantidad else 0 end,
         i.precio_unitario
           - case when v_mercaderia > 0 then v_orden.descuento * (i.subtotal / v_mercaderia) / i.cantidad else 0 end,
         case when v_orden.descuento > 0 then v_una_promo end,
         case when v_orden.descuento > 0 and v_una_promo is not null then v_promos->0->>'nombre' end,
         false,
         case when coalesce(p.lleva_serie, false)
              then 'Venta online: el IMEI se carga al entregar' end
    from public.ordenes_tienda_items i
    left join public.producto_variantes v on v.id = i.variante_id and v.negocio_id = p_negocio
    left join public.productos p on p.id = i.producto_id and p.negocio_id = p_negocio
   where i.negocio_id = p_negocio and i.orden_id = p_orden;

  -- El envío es plata que entró pero no es mercadería: renglón libre, sin
  -- stock ni costo. Así `ventas.total` cierra contra la suma de renglones.
  if v_orden.envio > 0 then
    insert into public.ventas_items (
      negocio_id, venta_id, producto_id, variante, variante_id, cantidad,
      precio_unitario, precio_costo, descuento_monto, precio_final, es_venta_libre
    ) values (
      p_negocio, v_venta_id, null, 'Envío', null, 1, v_orden.envio, 0, 0, v_orden.envio, true
    );
  end if;

  -- Descuentos aplicados, uno por promoción, y su uso.
  insert into public.ventas_descuentos (negocio_id, venta_id, promocion_id, promocion_nombre, tipo_descuento, monto_descontado)
  select p_negocio, v_venta_id, pr.id,
         coalesce(pr.nombre, x.nombre, 'Promoción'),
         coalesce(pr.tipo_descuento, 'MONTO_FIJO'),
         coalesce(x.monto, 0)
    from jsonb_to_recordset(v_promos) as x(id uuid, nombre text, monto numeric)
    left join public.promociones pr on pr.id = x.id and pr.negocio_id = p_negocio
   where coalesce(x.monto, 0) > 0;

  update public.promociones pr
     set usos_actuales = coalesce(pr.usos_actuales, 0) + 1
   where pr.negocio_id = p_negocio
     and pr.id in (select (e->>'id')::uuid from jsonb_array_elements(v_promos) e
                    where coalesce((e->>'monto')::numeric, 0) > 0);

  update public.ordenes_tienda
     set estado = 'PAGADA', venta_id = v_venta_id, pagada_en = now(),
         mp_payment_id = coalesce(v_mp_payment, mp_payment_id), actualizado_en = now()
   where id = p_orden and negocio_id = p_negocio;

  insert into public.eventos_pago (negocio_id, orden_id, origen, clave_idempotencia, mp_payment_id,
                                   estado_mp, monto, moneda, payload, resultado, usuario_id)
  values (p_negocio, p_orden, p_origen, v_clave, v_mp_payment, p_pago->>'estado_mp',
          coalesce((p_pago->>'monto')::numeric, v_orden.total), coalesce(p_pago->>'moneda', 'ARS'),
          coalesce(p_pago->'resumen', '{}'::jsonb), 'APLICADO', p_usuario);

  return jsonb_build_object('venta_id', v_venta_id, 'numero', v_orden.numero, 'ya_registrada', false);
end $$;

comment on function public._registrar_venta_orden_tienda(uuid, uuid, text, uuid, jsonb) is
  'Convierte una orden de la tienda PENDIENTE_PAGO/EN_PROCESO en venta (sin turno, sin vendedor, sin tocar stock) con el método uso_tienda, y la marca PAGADA. Idempotente con la orden bloqueada. Solo service_role.';

-- ─── 3. "Confirmar transferencia" (panel) ────────────────────────────────
create or replace function public.confirmar_transferencia_orden(p_orden uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_medio text;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not coalesce(public.tiene_permiso('ventas.cobrar'), false) then raise exception 'SIN_PERMISO'; end if;
  select o.medio into v_medio from public.ordenes_tienda o where o.id = p_orden and o.negocio_id = v_negocio;
  if v_medio is null then raise exception 'ORDEN_NO_ENCONTRADA'; end if;
  if v_medio <> 'TRANSFERENCIA' then raise exception 'NO_ES_TRANSFERENCIA'; end if;
  return public._registrar_venta_orden_tienda(v_negocio, p_orden, 'MANUAL', auth.uid(),
                                               jsonb_build_object('clave', 'manual:' || p_orden));
end $$;

-- ─── 4. Cancelar una orden impaga ────────────────────────────────────────
create or replace function public.cancelar_orden_tienda(p_orden uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_id uuid;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not coalesce(public.tiene_permiso('ventas.cobrar'), false) then raise exception 'SIN_PERMISO'; end if;

  update public.ordenes_tienda
     set estado = 'CANCELADA', stock_liberado_en = now(), actualizado_en = now()
   where id = p_orden and negocio_id = v_negocio
     and estado = 'PENDIENTE_PAGO' and stock_liberado_en is null
  returning id into v_id;
  if v_id is null then return false; end if;

  perform public._devolver_stock_orden_tienda(v_negocio, v_id);
  insert into public.eventos_pago (negocio_id, orden_id, origen, clave_idempotencia, resultado, usuario_id)
  values (v_negocio, v_id, 'MANUAL', 'cancela:' || v_id, 'APLICADO', auth.uid())
  on conflict (clave_idempotencia) do nothing;
  return true;
end $$;

-- ─── 5. La orden para la clienta (anon, por token) ───────────────────────
create or replace function public.orden_tienda_publica(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_negocio uuid := security.negocio_publico();
  v_orden record;
  v_config record;
begin
  if v_negocio is null or p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;

  -- STOPGAP (sin pg_cron): mirar la orden vence las del negocio.
  perform public.liberar_ordenes_tienda_vencidas(v_negocio);

  select * into v_orden from public.ordenes_tienda o
   where o.token_publico = p_token and o.negocio_id = v_negocio;
  if v_orden.id is null then return null; end if;

  select c."posName" as nombre, c.whatsapp, c.alias_mercadopago_tienda, c.transferencia_titular
    into v_config from public.configuracion_pos c where c.negocio_id = v_negocio;

  return jsonb_build_object(
    'numero', v_orden.numero,
    'estado', v_orden.estado,
    'medio', v_orden.medio,
    'cliente_nombre', v_orden.cliente_nombre,
    'modalidad_entrega', v_orden.modalidad_entrega,
    'subtotal', v_orden.subtotal,
    'descuento', v_orden.descuento,
    'recargo', v_orden.recargo,
    'envio', v_orden.envio,
    'total', v_orden.total,
    'vence_en', v_orden.vence_en,
    'creado_en', v_orden.creado_en,
    'pagada_en', v_orden.pagada_en,
    'comercio', v_config.nombre,
    'whatsapp', v_config.whatsapp,
    -- Los datos para transferir, solo mientras se esperan.
    'alias', case when v_orden.medio = 'TRANSFERENCIA' and v_orden.estado = 'PENDIENTE_PAGO'
                  then v_config.alias_mercadopago_tienda end,
    'titular', case when v_orden.medio = 'TRANSFERENCIA' and v_orden.estado = 'PENDIENTE_PAGO'
                    then v_config.transferencia_titular end,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                 'nombre', i.nombre, 'variante', i.variante, 'cantidad', i.cantidad, 'subtotal', i.subtotal)
               order by i.nombre), '[]'::jsonb)
                from public.ordenes_tienda_items i
               where i.negocio_id = v_negocio and i.orden_id = v_orden.id)
  );
end $$;

-- ─── 6. Turno de conciliación ────────────────────────────────────────────
create or replace function public.tomar_turno_conciliacion_mp(p_negocio uuid, p_segundos integer default 30)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ok boolean;
begin
  insert into public.conciliaciones_mp (negocio_id, ultima_en) values (p_negocio, now())
  on conflict (negocio_id) do update set ultima_en = now()
   where public.conciliaciones_mp.ultima_en < now() - make_interval(secs => greatest(p_segundos, 5))
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

-- ─── Permisos ────────────────────────────────────────────────────────────
revoke all on function public.metodo_pago_tienda(uuid, text) from public, anon, authenticated;
revoke all on function public._registrar_venta_orden_tienda(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.confirmar_transferencia_orden(uuid) from public, anon;
revoke all on function public.cancelar_orden_tienda(uuid) from public, anon;
revoke all on function public.orden_tienda_publica(text) from public;
revoke all on function public.tomar_turno_conciliacion_mp(uuid, integer) from public, anon, authenticated;
grant execute on function public._registrar_venta_orden_tienda(uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.tomar_turno_conciliacion_mp(uuid, integer) to service_role;
grant execute on function public.confirmar_transferencia_orden(uuid) to authenticated;
grant execute on function public.cancelar_orden_tienda(uuid) to authenticated;
grant execute on function public.orden_tienda_publica(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from public.metodos_pago where uso_tienda is not null and activo) then
    raise exception 'TIENDA_COBRO_GUARD_METODOS';
  end if;
  if has_function_privilege('anon', 'public._registrar_venta_orden_tienda(uuid,uuid,text,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._registrar_venta_orden_tienda(uuid,uuid,text,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.metodo_pago_tienda(uuid,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.confirmar_transferencia_orden(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cancelar_orden_tienda(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.tomar_turno_conciliacion_mp(uuid,integer)', 'EXECUTE')
    or not has_function_privilege('anon', 'public.orden_tienda_publica(text)', 'EXECUTE')
    or has_table_privilege('anon', 'public.conciliaciones_mp', 'SELECT')
    or has_table_privilege('authenticated', 'public.conciliaciones_mp', 'SELECT') then
    raise exception 'TIENDA_COBRO_GUARD_GRANTS';
  end if;
end $$;
