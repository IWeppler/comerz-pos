-- Pagar la cuenta corriente con Mercado Pago desde el resumen (docs/cuenta-corriente.md,
-- "Pagar con Mercado Pago desde el resumen", decidido el 22/10/2026).
--
--   1. `cobros_cc_online`: un intento de pago por botón tocado. Congela lo que se
--      cobra (capital + mora calculada en ese momento) porque el pago llega minutos
--      después y la mora pudo cambiar. El id del intento es el id del cobro en
--      `venta_pagos`: `registrar_cobro_cc` ya es idempotente por ese id.
--   2. El cobro sin sesión. `registrar_cobro_cc`, `registrar_recibo_cobro_cc` y
--      `recibo_cobro_cc` leen el negocio de la sesión; el aviso de Mercado Pago no
--      tiene sesión. Desde acá leen `coalesce(sesión, _negocio_de_sistema())`, y
--      `_negocio_de_sistema()` SOLO devuelve algo con el rol service_role y una
--      variable de la transacción que pone `aplicar_pago_mp_cobro_cc`. Con una
--      sesión normal nada cambia: la sesión gana. Reescritas con replace() sobre el
--      cuerpo vivo, con guard de un reemplazo por función.
--   3. `aplicar_pago_mp_cobro_cc`: la única puerta (webhook y conciliación).
--      Aprobado y exacto -> cobro de CC sin turno, al método MP_CHECKOUT de la tienda
--      (misma cuenta "Mercado Pago (tienda online)"), con la comisión real.
--      Si la deuda bajó mientras tanto (pagó en el local), la mora congelada NO se
--      materializa y todo el pago es crédito: el excedente queda a favor (decisión
--      del 22/10: la plata ya entró). Monto distinto -> REVISAR, sin cobro.
--   4. Aviso en la campana: tipo COBRO_CC_ONLINE (categoría PLATA).
--   5. `eventos_pago.cobro_cc_id`: el mismo log idempotente que las órdenes.
-- Reversión: supabase/reversals/20261022180000_cobro_cc_mercadopago.sql

begin;

do $pre$
begin
  if to_regclass('public.cobros_cc_online') is not null then
    raise exception 'cobros_cc_online ya existe';
  end if;
  if to_regprocedure('public.metodo_pago_tienda(uuid,text)') is null then
    raise exception 'falta metodo_pago_tienda (T5 de la tienda)';
  end if;
end
$pre$;

-- ─── 2. El negocio cuando no hay sesión ───────────────────────────────────
create function public._negocio_de_sistema()
returns uuid
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when auth.role() = 'service_role'
      then nullif(current_setting('comerz.negocio_sistema', true), '')::uuid
  end
$$;
-- La llaman funciones INVOKER que corren como authenticated: necesita EXECUTE.
-- Para cualquier rol que no sea service_role devuelve null.
revoke all on function public._negocio_de_sistema() from public, anon;
grant execute on function public._negocio_de_sistema() to authenticated, service_role;

do $reescritura$
declare
  v_def text;
  v_nuevo text;
  v_viejo text;
  v_fn text;
begin
  foreach v_fn in array array['registrar_cobro_cc', 'registrar_recibo_cobro_cc', 'recibo_cobro_cc'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_def is null then
      raise exception 'falta %', v_fn;
    end if;
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn) <> 1 then
      raise exception '% tiene sobrecargas', v_fn;
    end if;
    v_viejo := 'security.current_negocio_id()';
    if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
      raise exception '%: se esperaba exactamente un current_negocio_id()', v_fn;
    end if;
    v_nuevo := replace(v_def, v_viejo,
      'coalesce(security.current_negocio_id(), public._negocio_de_sistema())');
    execute v_nuevo;
  end loop;
end
$reescritura$;

-- ─── 1. Los intentos de pago ──────────────────────────────────────────────
create table public.cobros_cc_online (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  -- Sin FK al cliente: el intento es historia y tiene que sobrevivirlo.
  cliente_id uuid not null,
  alcance text not null check (alcance in ('VENCIDO', 'TOTAL', 'CICLO')),
  monto_capital numeric(14,2) not null check (monto_capital > 0),
  mora_monto numeric(14,2) not null default 0 check (mora_monto >= 0),
  mora_descripcion text,
  mora_debito_origen_id uuid,
  total numeric(14,2) generated always as (monto_capital + mora_monto) stored,
  estado text not null default 'PENDIENTE'
    check (estado in ('PENDIENTE', 'EN_PROCESO', 'PAGADO', 'REVISAR')),
  mp_preference_id text,
  mp_payment_id text,
  vence_en timestamptz not null,
  creado_en timestamptz not null default now(),
  pagado_en timestamptz,
  -- Qué se aplicó: si se materializó la mora y cuánto quedó a favor.
  resultado jsonb
);

create index cobros_cc_online_negocio_cliente_idx
  on public.cobros_cc_online (negocio_id, cliente_id, creado_en desc);
create unique index cobros_cc_online_pago_unico
  on public.cobros_cc_online (mp_payment_id) where mp_payment_id is not null;

alter table public.cobros_cc_online enable row level security;

create policy aislamiento_negocio on public.cobros_cc_online
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy cobros_cc_online_leer on public.cobros_cc_online
  as permissive for select to authenticated
  using ((select public.tiene_permiso('clientes.ver_modulo')));

-- Solo lectura para la app. Escriben el server (service_role) y las RPC.
revoke all on public.cobros_cc_online from public, anon, authenticated;
grant select on public.cobros_cc_online to authenticated;

-- ─── 4 y 5. Aviso y log ────────────────────────────────────────────────────
alter table public.notificaciones drop constraint notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('STOCK_AGOTADO', 'ORDEN_PAGADA', 'ORDEN_REVISAR', 'ORDEN_SIN_STOCK',
                  'DEBITO_COBRADO', 'COBRO_CC_ONLINE'));

alter table public.eventos_pago add column cobro_cc_id uuid;

-- ─── 3. Aplicar un pago de Mercado Pago a un intento ───────────────────────
create function public.aplicar_pago_mp_cobro_cc(
  p_negocio uuid,
  p_cobro uuid,
  p_origen text,
  p_pago jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cobro public.cobros_cc_online%rowtype;
  v_mp text := nullif(p_pago->>'mp_payment_id', '');
  v_estado_mp text := p_pago->>'estado_mp';
  v_monto numeric := (p_pago->>'monto')::numeric;
  v_moneda text := p_pago->>'moneda';
  v_comision numeric := coalesce((p_pago->>'comision_monto')::numeric, 0);
  v_clave text;
  v_saldo numeric;
  v_nombre text;
  v_con_mora boolean;
  v_metodo record;
  v_metodo_id uuid;
  v_res jsonb;
  v_a_favor numeric;
  v_resultado text;
begin
  if p_origen not in ('MP_WEBHOOK', 'SISTEMA') then
    raise exception 'ORIGEN_INVALIDO';
  end if;
  if v_mp is null then
    raise exception 'PAGO_SIN_ID';
  end if;

  select * into v_cobro from public.cobros_cc_online c
   where c.id = p_cobro and c.negocio_id = p_negocio
   for update;
  if v_cobro.id is null then
    raise exception 'COBRO_CC_NO_ENCONTRADO';
  end if;

  v_clave := 'mp:' || v_mp || ':' || coalesce(v_estado_mp, 'desconocido');

  -- No aprobado: en proceso queda a la espera; rechazado no cambia nada.
  if v_estado_mp is distinct from 'approved' then
    if v_estado_mp in ('pending', 'in_process', 'authorized') and v_cobro.estado = 'PENDIENTE' then
      update public.cobros_cc_online set estado = 'EN_PROCESO', mp_payment_id = v_mp
       where id = p_cobro;
    elsif v_estado_mp in ('rejected', 'cancelled') and v_cobro.estado = 'EN_PROCESO'
          and v_cobro.mp_payment_id = v_mp then
      update public.cobros_cc_online set estado = 'PENDIENTE', mp_payment_id = null
       where id = p_cobro;
    end if;
    insert into public.eventos_pago (negocio_id, cobro_cc_id, origen, clave_idempotencia, mp_payment_id,
                                     estado_mp, monto, moneda, payload, resultado)
    values (p_negocio, p_cobro, p_origen, v_clave, v_mp, v_estado_mp, v_monto, v_moneda,
            coalesce(p_pago->'resumen', '{}'::jsonb), 'IGNORADO')
    on conflict (clave_idempotencia) do nothing;
    return 'IGNORADO';
  end if;

  -- Ya cobrado: el mismo pago otra vez es un duplicado; otro pago aprobado es
  -- plata que entró dos veces y lo decide el comercio.
  if v_cobro.estado = 'PAGADO' then
    v_resultado := case when v_cobro.mp_payment_id = v_mp then 'DUPLICADO' else 'PAGO_DUPLICADO' end;
    insert into public.eventos_pago (negocio_id, cobro_cc_id, origen, clave_idempotencia, mp_payment_id,
                                     estado_mp, monto, moneda, payload, resultado)
    values (p_negocio, p_cobro, p_origen, v_clave, v_mp, v_estado_mp, v_monto, v_moneda,
            coalesce(p_pago->'resumen', '{}'::jsonb), v_resultado)
    on conflict (clave_idempotencia) do nothing;
    if v_resultado = 'PAGO_DUPLICADO' and found then
      perform public._notificar(p_negocio, 'COBRO_CC_ONLINE', 'cobro_cc:' || p_cobro || ':' || v_mp,
        'Pago repetido con Mercado Pago',
        public.pesos_ar(v_monto) || '. Entró un segundo pago para el mismo cobro de cuenta corriente: revisalo en Mercado Pago.',
        '/clientes', jsonb_build_object('cobro_cc_id', p_cobro, 'cliente_id', v_cobro.cliente_id));
    end if;
    return v_resultado;
  end if;

  select c.nombre, coalesce(c.saldo_pendiente, 0) into v_nombre, v_saldo
    from public.clientes c
   where c.id = v_cobro.cliente_id and c.negocio_id = p_negocio;

  -- Otro monto u otra moneda: no se adivina.
  if v_moneda is distinct from 'ARS' or v_monto is null or abs(v_monto - v_cobro.total) > 0.005 then
    update public.cobros_cc_online
       set estado = 'REVISAR', mp_payment_id = v_mp,
           resultado = jsonb_build_object('motivo', 'MONTO', 'monto_pagado', v_monto, 'moneda', v_moneda)
     where id = p_cobro;
    insert into public.eventos_pago (negocio_id, cobro_cc_id, origen, clave_idempotencia, mp_payment_id,
                                     estado_mp, monto, moneda, payload, resultado)
    values (p_negocio, p_cobro, p_origen, v_clave, v_mp, v_estado_mp, v_monto, v_moneda,
            coalesce(p_pago->'resumen', '{}'::jsonb), 'RECHAZADO_MONTO')
    on conflict (clave_idempotencia) do nothing;
    perform public._notificar(p_negocio, 'COBRO_CC_ONLINE', 'cobro_cc:' || p_cobro,
      'Pago de cuenta corriente para revisar',
      coalesce(v_nombre, 'Un cliente') || ' pagó ' || public.pesos_ar(v_monto) || ' con Mercado Pago, pero se esperaban '
        || public.pesos_ar(v_cobro.total) || '. No se registró: revisalo y cargalo a mano.',
      '/clientes', jsonb_build_object('cobro_cc_id', p_cobro, 'cliente_id', v_cobro.cliente_id));
    return 'RECHAZADO_MONTO';
  end if;

  if v_nombre is null then
    raise exception 'CLIENTE_NO_ENCONTRADO';
  end if;

  -- La mora congelada vale si la deuda sigue alcanzando para todo el pago. Si
  -- bajó (pagó en el local entre medio, mora incluida), materializarla otra vez
  -- la cobraría dos veces: todo el pago va como crédito y lo que sobra queda a favor.
  v_con_mora := v_cobro.mora_monto > 0 and v_saldo + v_cobro.mora_monto >= v_cobro.total - 0.005;
  v_a_favor := greatest(v_cobro.total - (v_saldo + case when v_con_mora then v_cobro.mora_monto else 0 end), 0);

  -- En dos pasos: `metodo_pago_tienda` puede CREAR el método, y un select que la
  -- llama en el where no ve la fila que ella misma insertó.
  v_metodo_id := public.metodo_pago_tienda(p_negocio, 'MP_CHECKOUT');
  select m.id, m.nombre, m.tipo, m.acreditacion_dias into v_metodo
    from public.metodos_pago m
   where m.id = v_metodo_id;

  perform set_config('comerz.negocio_sistema', p_negocio::text, true);
  v_res := public.registrar_cobro_cc(
    jsonb_build_object(
      'id', v_cobro.id,
      'cliente_id', v_cobro.cliente_id,
      'turno_caja_id', null,
      'metodo_pago_id', v_metodo.id,
      'metodo_nombre', v_metodo.nombre,
      'metodo_tipo', v_metodo.tipo,
      'monto_base', v_cobro.total,
      'recargo_porcentaje', 0,
      'recargo_monto', 0,
      'monto_bruto', v_cobro.total,
      'comision_porcentaje', case when v_cobro.total > 0 then round(v_comision * 100 / v_cobro.total, 2) else 0 end,
      'comision_monto', v_comision,
      'monto_neto', v_cobro.total - v_comision,
      'acreditacion_dias', coalesce(v_metodo.acreditacion_dias, 0),
      'descripcion_cc', case when v_a_favor > 0.005
                             then 'Pago con Mercado Pago (deja ' || public.pesos_ar(v_a_favor) || ' a favor)'
                             else 'Pago con Mercado Pago' end,
      'permitir_saldo_a_favor', true
    ),
    case when v_con_mora then jsonb_build_object(
      'monto', v_cobro.mora_monto,
      'descripcion', coalesce(v_cobro.mora_descripcion, 'Recargo por mora'),
      'debito_origen_id', v_cobro.mora_debito_origen_id
    ) end
  );
  perform set_config('comerz.negocio_sistema', '', true);

  update public.cobros_cc_online
     set estado = 'PAGADO', mp_payment_id = v_mp, pagado_en = now(),
         resultado = jsonb_build_object('mora_aplicada', v_con_mora, 'a_favor', v_a_favor,
                                        'comision', v_comision, 'cobro', v_res)
   where id = p_cobro;

  insert into public.eventos_pago (negocio_id, cobro_cc_id, origen, clave_idempotencia, mp_payment_id,
                                   estado_mp, monto, moneda, payload, resultado)
  values (p_negocio, p_cobro, p_origen, v_clave, v_mp, v_estado_mp, v_monto, v_moneda,
          coalesce(p_pago->'resumen', '{}'::jsonb), 'APLICADO')
  on conflict (clave_idempotencia) do nothing;

  perform public._notificar(p_negocio, 'COBRO_CC_ONLINE', 'cobro_cc:' || p_cobro,
    v_nombre || ' pagó con Mercado Pago',
    public.pesos_ar(v_cobro.total) || ' de su cuenta corriente.'
      || case when v_a_favor > 0.005
              then ' Ya había pagado parte: quedan ' || public.pesos_ar(v_a_favor) || ' a su favor.'
              else '' end,
    '/clientes', jsonb_build_object('cobro_cc_id', p_cobro, 'cliente_id', v_cobro.cliente_id));

  return 'APLICADO';
end;
$$;

revoke all on function public.aplicar_pago_mp_cobro_cc(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_pago_mp_cobro_cc(uuid, uuid, text, jsonb) to service_role;

-- ─── Guards ───────────────────────────────────────────────────────────────
do $guard$
declare
  v_fn text;
begin
  foreach v_fn in array array['registrar_cobro_cc', 'registrar_recibo_cobro_cc', 'recibo_cobro_cc'] loop
    if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_fn)
       not like '%coalesce(security.current_negocio_id(), public._negocio_de_sistema())%' then
      raise exception '%: el reemplazo no quedó', v_fn;
    end if;
  end loop;
  if not (select prosecdef from pg_proc where oid = 'public.registrar_recibo_cobro_cc'::regproc)
     or (select prosecdef from pg_proc where oid = 'public.registrar_cobro_cc'::regproc) then
    raise exception 'cambió SECURITY DEFINER/INVOKER de las funciones de cobro';
  end if;
  if not has_function_privilege('authenticated', 'public.registrar_cobro_cc(jsonb,jsonb)', 'EXECUTE') then
    raise exception 'authenticated perdió registrar_cobro_cc';
  end if;
  if has_function_privilege('authenticated', 'public.aplicar_pago_mp_cobro_cc(uuid,uuid,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.aplicar_pago_mp_cobro_cc(uuid,uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'aplicar_pago_mp_cobro_cc tiene que ser solo service_role';
  end if;
  if has_table_privilege('anon', 'public.cobros_cc_online', 'SELECT')
     or has_table_privilege('authenticated', 'public.cobros_cc_online', 'INSERT')
     or has_table_privilege('authenticated', 'public.cobros_cc_online', 'UPDATE') then
    raise exception 'cobros_cc_online: permisos de más';
  end if;
  -- Con una sesión normal (sin service_role) el negocio de sistema es null.
  if public._negocio_de_sistema() is not null then
    raise exception '_negocio_de_sistema devolvió algo sin service_role';
  end if;
end
$guard$;

commit;
