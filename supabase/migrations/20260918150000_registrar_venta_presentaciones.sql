-- ---------------------------------------------------------------------------
-- `registrar_venta` escribe qué PRESENTACIÓN se vendió en cada renglón.
--
-- Las cinco columnas de `ventas_items` existen desde 20260918120000 con
-- default/null, así que la RPC era válida sin tocarla — pero no las escribía:
-- un balde vendido quedaba como "4,7 kg a $9.574,47" y el ticket no podía
-- decir "1 Balde". Acá el recordset de `p_items` las acepta; ausentes, caen a
-- lo de siempre (factor 1, sin presentación), así los renglones sin
-- presentación y las ventas offline encoladas antes de este deploy entran
-- igual.
--
-- `cantidad` SIGUE EN UNIDAD BASE. El CHECK `ventas_items_presentacion_coherente`
-- lo obliga: con presentación, cantidad = cantidad_base(cantidad_presentacion,
-- factor). Quien manda `cantidad` mal contra su factor no escribe nada.
--
-- Cuerpo reescrito desde `pg_get_functiondef` (18/9/2026), NO desde
-- 20260917120000: la regla de 20260904140000. Lo único que cambia es el
-- INSERT de ventas_items; el resto es idéntico al vivo. `registrar_venta_facturada`
-- delega en esta y no se toca.
-- ---------------------------------------------------------------------------

create or replace function public.registrar_venta(
  p_venta        jsonb,
  p_pagos        jsonb    default '[]'::jsonb,
  p_items        jsonb    default '[]'::jsonb,
  p_stock_legacy jsonb    default '[]'::jsonb,
  p_descuento    jsonb    default null,
  p_cc           jsonb    default null,
  p_reserva_ids  uuid[]   default '{}'::uuid[]
)
returns jsonb
language plpgsql
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_venta_id uuid;
  v_fecha_venta timestamptz;
  v_vencimiento date;
  v_turno uuid := nullif(p_venta->>'turno_caja_id', '')::uuid;
  v_vendedor uuid := (p_venta->>'vendedor_id')::uuid;
  v_cliente uuid;
  v_pendiente numeric;
  v_promocion uuid;
  v_recargo_cc numeric;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  insert into public.ventas (
    id, negocio_id, vendedor_id, cliente_id, turno_caja_id, estado_operacion,
    metodo_pago, total, precio_costo, cantidad, total_bruto,
    recargo_metodo_total, comision_total, total_neto, es_pago_mixto,
    monto_cobrado, monto_pendiente, estado_pago,
    recargo_cc_porcentaje, recargo_cc_monto,
    fecha_venta, registrada_offline, desfasaje_precio,
    lista_precio_id, lista_precio_nombre
  )
  values (
    (p_venta->>'id')::uuid,
    v_negocio,
    v_vendedor,
    nullif(p_venta->>'cliente_id', '')::uuid,
    v_turno,
    p_venta->>'estado_operacion',
    p_venta->>'metodo_pago',
    (p_venta->>'total')::numeric,
    (p_venta->>'precio_costo')::numeric,
    (p_venta->>'cantidad')::numeric,
    (p_venta->>'total_bruto')::numeric,
    (p_venta->>'recargo_metodo_total')::numeric,
    (p_venta->>'comision_total')::numeric,
    (p_venta->>'total_neto')::numeric,
    (p_venta->>'es_pago_mixto')::boolean,
    (p_venta->>'monto_cobrado')::numeric,
    (p_venta->>'monto_pendiente')::numeric,
    p_venta->>'estado_pago',
    (p_venta->>'recargo_cc_porcentaje')::numeric,
    (p_venta->>'recargo_cc_monto')::numeric,
    coalesce((p_venta->>'fecha_venta')::timestamptz, now()),
    coalesce((p_venta->>'registrada_offline')::boolean, false),
    (p_venta->>'desfasaje_precio')::numeric,
    nullif(p_venta->>'lista_precio_id', '')::uuid,
    nullif(p_venta->>'lista_precio_nombre', '')
  )
  on conflict (id) do nothing
  returning id, fecha_venta into v_venta_id, v_fecha_venta;

  if v_venta_id is null then
    return jsonb_build_object(
      'ya_registrada', true,
      'venta_id', (p_venta->>'id')::uuid
    );
  end if;

  insert into public.venta_pagos (
    negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
    monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
    comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
    turno_caja_id
  )
  select
    v_negocio, v_venta_id, p.metodo_pago_id, p.metodo_nombre, p.metodo_tipo,
    p.monto_base, p.recargo_porcentaje, p.recargo_monto, p.monto_bruto,
    p.comision_porcentaje, p.comision_monto, p.monto_neto,
    p.acreditacion_dias, v_turno
  from jsonb_to_recordset(p_pagos) as p(
    metodo_pago_id uuid, metodo_nombre text, metodo_tipo text,
    monto_base numeric, recargo_porcentaje numeric, recargo_monto numeric,
    monto_bruto numeric, comision_porcentaje numeric, comision_monto numeric,
    monto_neto numeric, acreditacion_dias int
  );

  -- Presentación: `factor` cae a 1 y el resto a null cuando el renglón no la
  -- trae, que es todo lo vendido en unidad base. Ver 20260918120000.
  insert into public.ventas_items (
    negocio_id, venta_id, producto_id, variante, variante_id, unidad_serie_id, cantidad,
    precio_unitario, precio_costo, descuento_monto, precio_final,
    promocion_id, promocion_nombre, es_venta_libre,
    presentacion_id, presentacion_nombre, factor, cantidad_presentacion, precio_presentacion
  )
  select
    v_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.unidad_serie_id,
    i.cantidad, i.precio_unitario, i.precio_costo, i.descuento_monto,
    i.precio_final, i.promocion_id, i.promocion_nombre,
    coalesce(i.es_venta_libre, false),
    i.presentacion_id, i.presentacion_nombre, coalesce(i.factor, 1),
    i.cantidad_presentacion, i.precio_presentacion
  from jsonb_to_recordset(p_items) as i(
    producto_id uuid, variante text, variante_id uuid, unidad_serie_id uuid, cantidad numeric,
    precio_unitario numeric, precio_costo numeric, descuento_monto numeric,
    precio_final numeric, promocion_id uuid, promocion_nombre text,
    es_venta_libre boolean,
    presentacion_id uuid, presentacion_nombre text, factor numeric,
    cantidad_presentacion numeric, precio_presentacion numeric
  );

  if not exists (select 1 from public.ventas_items where venta_id = v_venta_id) then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;

  if p_descuento is not null then
    v_promocion := (p_descuento->>'promocion_id')::uuid;

    insert into public.ventas_descuentos (
      negocio_id, venta_id, promocion_id, promocion_nombre, tipo_descuento,
      monto_descontado
    )
    values (
      v_negocio, v_venta_id, v_promocion,
      p_descuento->>'promocion_nombre',
      p_descuento->>'tipo_descuento',
      (p_descuento->>'monto_descontado')::numeric
    );

    update public.promociones
       set usos_actuales = coalesce(usos_actuales, 0) + 1
     where id = v_promocion;
  end if;

  if p_cc is not null then
    v_cliente := nullif(p_cc->>'cliente_id', '')::uuid;
    v_pendiente := coalesce((p_cc->>'monto_pendiente')::numeric, 0);

    if v_cliente is not null and v_pendiente > 0.05 then
      v_vencimiento := (v_fecha_venta at time zone 'UTC')::date
                       + coalesce((p_cc->>'plazo_mora')::int, 30);

      v_recargo_cc := least(
        coalesce((p_venta->>'recargo_cc_monto')::numeric, 0),
        v_pendiente
      );

      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
        monto_recargo, recargo_porcentaje
      )
      values (
        v_negocio, v_cliente, v_venta_id, 'DEBITO', v_pendiente,
        p_cc->>'descripcion', v_vendedor,
        v_recargo_cc,
        (p_venta->>'recargo_cc_porcentaje')::numeric
      );

      update public.clientes
         set saldo_pendiente = coalesce(saldo_pendiente, 0) + v_pendiente,
             fecha_vencimiento_deuda = coalesce(
               public.recalcular_vencimiento_cc(v_cliente),
               v_vencimiento
             )
       where id = v_cliente;

      if not found then
        raise exception 'CLIENTE_NO_ENCONTRADO';
      end if;

      update public.ventas
         set fecha_vencimiento = v_vencimiento
       where id = v_venta_id;
    end if;
  end if;

  -- Una variante puede aparecer en dos renglones (unidad base + Balde). Un
  -- UPDATE ... FROM no acumula filas fuente duplicadas: se agrupa también en
  -- la frontera SQL, aunque Node ya mande el payload consolidado.
  update public.productos_stock ps
     set cantidad = ps.cantidad - s.cantidad
    from (
      select x.stock_id, sum(x.cantidad) as cantidad
        from jsonb_to_recordset(p_stock_legacy)
          as x(stock_id uuid, cantidad numeric)
       group by x.stock_id
    ) s
   where ps.id = s.stock_id;

  if array_length(p_reserva_ids, 1) > 0 then
    update public.reservas
       set estado = 'CONFIRMADA',
           venta_id = v_venta_id,
           resuelto_en = now()
     where id = any(p_reserva_ids)
       and estado = 'ACTIVA';
  end if;

  return jsonb_build_object(
    'venta_id', v_venta_id,
    'fecha_venta', v_fecha_venta,
    'fecha_vencimiento', v_vencimiento
  );
end;
$function$;

-- Guard: el cuerpo vivo tiene que escribir las columnas de presentación y
-- conservar lo que las migraciones anteriores agregaron (venta libre, lista,
-- reservas). Mismo criterio que 20260904140000.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'registrar_venta';

  if v_def not like '%presentacion_id%'
     or v_def not like '%cantidad_presentacion%'
     or v_def not like '%es_venta_libre%'
     or v_def not like '%lista_precio_id%'
     or v_def not like '%p_reserva_ids%' then
    raise exception 'GUARD: registrar_venta perdió columnas al reescribirse';
  end if;
end $$;
