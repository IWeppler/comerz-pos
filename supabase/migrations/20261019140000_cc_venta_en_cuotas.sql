-- Venta en cuotas dentro de la cuenta corriente (docs/cuenta-corriente.md,
-- "Venta en cuotas"). Una venta en N cuotas son N tickets de deuda (DEBITO
-- con venta_id), cada uno con su vencimiento guardado.
--
-- 1. Columnas en cuenta_corriente_movimientos: vence_el (null = la regla del
--    comercio, como hasta ahora), cuota_numero, cuotas_total. Congeladas por
--    trigger: la policy de la tabla deja hacer UPDATE de cualquier columna.
-- 2. cc_registrar_cuotas_venta: relee la tasa de la config (fail-closed),
--    valida porcentaje e interés, reparte en centavos (el resto a la última,
--    espejo de shared/lib/cuotas.ts) y fecha cada cuota a fecha + k meses
--    (espejo de vencimientosMensuales en plan-cuotas-cc.ts).
-- 3. cc_deudas_vivas y deuda_cc_vencida ordenan por VENCIMIENTO: los pagos
--    cancelan primero lo que vence primero. Para la deuda que existe hoy el
--    orden es el mismo (vencimiento y fecha avanzan juntos); el guard lo
--    compara para TODOS los clientes.
-- 4. registrar_venta: con p_cc.cuotas escribe el plan en vez del ticket
--    único, y el plan no pide ventas.fiar_sin_recargo (su tasa la configuró
--    el comercio). Además el vencimiento de la venta pasa a día comercial
--    argentino (usaba UTC: un fiado después de las 21 vencía un día más tarde
--    en ventas.fecha_vencimiento).
--
-- Todas las funciones se reescriben desde el cuerpo VIVO con replace() y
-- guard de que cada ancla matchea exactamente una vez.

-- 1. Columnas ------------------------------------------------------------------

alter table public.cuenta_corriente_movimientos
  add column vence_el date,
  add column cuota_numero integer,
  add column cuotas_total integer;

alter table public.cuenta_corriente_movimientos
  add constraint cc_mov_vence_el_solo_en_ticket check (
    vence_el is null or (tipo = 'DEBITO' and pago_id is null)
  ),
  add constraint cc_mov_cuota_coherente check (
    (cuota_numero is null and cuotas_total is null)
    or (
      cuotas_total between 1 and 60
      and cuota_numero between 1 and cuotas_total
      and vence_el is not null
      and venta_id is not null
    )
  );

comment on column public.cuenta_corriente_movimientos.vence_el is
  'Vencimiento propio del ticket (venta en cuotas). Null = la regla del comercio (cc_vence_el).';
comment on column public.cuenta_corriente_movimientos.cuota_numero is
  'Número de cuota (1..cuotas_total) de una venta en cuotas.';

create or replace function public.cc_mov_cuota_inmutable()
returns trigger
language plpgsql
set search_path to 'pg_temp'
as $$
begin
  if new.vence_el is distinct from old.vence_el
     or new.cuota_numero is distinct from old.cuota_numero
     or new.cuotas_total is distinct from old.cuotas_total then
    raise exception 'CUOTA_INMUTABLE';
  end if;
  return new;
end;
$$;

create trigger trg_cc_mov_cuota_inmutable
  before update of vence_el, cuota_numero, cuotas_total
  on public.cuenta_corriente_movimientos
  for each row execute function public.cc_mov_cuota_inmutable();

-- 2. Escritura del plan ---------------------------------------------------------

create or replace function public.cc_registrar_cuotas_venta(
  p_negocio uuid,
  p_cliente uuid,
  p_venta_id uuid,
  p_vendedor uuid,
  p_pendiente numeric,
  p_interes numeric,
  p_pct numeric,
  p_cuotas integer,
  p_descripcion text,
  p_dia date,
  p_offline boolean
)
returns date
language plpgsql
set search_path to 'public', 'security', 'pg_temp'
as $$
declare
  v_pct numeric;
  v_esperado numeric;
  v_total_c bigint;
  v_cuota_c bigint;
  v_rec_c bigint;
  v_rec_cuota_c bigint;
  v_monto_c bigint;
  v_recargo_c bigint;
  k integer;
begin
  if p_negocio is distinct from security.current_negocio_id() then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  -- La venta offline no elige plan: el catálogo y la config del celular son
  -- una copia, y la tasa tiene que ser la vigente.
  if coalesce(p_offline, false) then
    raise exception 'PLAN_CUOTAS_OFFLINE';
  end if;

  if p_cuotas is null or p_cuotas < 1 or p_cuotas > 60 then
    raise exception 'PLAN_CUOTAS_INVALIDO';
  end if;

  -- Fail-closed: una cantidad que el comercio no configuró no se vende.
  select (t->>'pct')::numeric into v_pct
    from public.configuracion_pos c
    cross join lateral jsonb_array_elements(
      coalesce(c.plan_tasas_financiacion, '[]'::jsonb)) t
   where c.negocio_id = p_negocio
     and (t->>'cuotas')::int = p_cuotas
   limit 1;
  if v_pct is null then
    raise exception 'PLAN_CUOTAS_INVALIDO'
      using detail = jsonb_build_object('cuotas', p_cuotas)::text;
  end if;

  if round(coalesce(p_pct, -1), 2) <> round(v_pct, 2) then
    raise exception 'PLAN_CUOTAS_TASA_DISTINTA'
      using detail = jsonb_build_object('pct', p_pct, 'config', v_pct)::text;
  end if;

  -- Interés sobre lo FINANCIADO (la entrega no paga interés), al centavo.
  v_esperado := round((p_pendiente - coalesce(p_interes, 0)) * v_pct / 100, 2);
  if abs(v_esperado - coalesce(p_interes, 0)) > 0.01 then
    raise exception 'PLAN_CUOTAS_INTERES_DISTINTO'
      using detail = jsonb_build_object(
        'interes', p_interes, 'esperado', v_esperado)::text;
  end if;

  v_total_c := round(p_pendiente * 100);
  v_cuota_c := v_total_c / p_cuotas;
  if v_cuota_c < 1 then
    raise exception 'PLAN_CUOTAS_INVALIDO';
  end if;
  v_rec_c := round(coalesce(p_interes, 0) * 100);
  v_rec_cuota_c := v_rec_c / p_cuotas;

  for k in 1..p_cuotas loop
    if k < p_cuotas then
      v_monto_c := v_cuota_c;
      v_recargo_c := v_rec_cuota_c;
    else
      v_monto_c := v_total_c - v_cuota_c * (p_cuotas - 1);
      v_recargo_c := v_rec_c - v_rec_cuota_c * (p_cuotas - 1);
    end if;

    insert into public.cuenta_corriente_movimientos (
      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
      monto_recargo, recargo_porcentaje, vence_el, cuota_numero, cuotas_total
    ) values (
      p_negocio, p_cliente, p_venta_id, 'DEBITO', v_monto_c / 100.0,
      coalesce(p_descripcion, 'Compra en cuotas') || ' - Cuota ' || k || '/' || p_cuotas,
      p_vendedor, v_recargo_c / 100.0, v_pct,
      (p_dia + k * interval '1 month')::date, k, p_cuotas
    );
  end loop;

  return (p_dia + interval '1 month')::date;
end;
$$;

revoke execute on function public.cc_registrar_cuotas_venta(
  uuid, uuid, uuid, uuid, numeric, numeric, numeric, integer, text, date, boolean
) from public, anon;

-- 3 y 4. Reescrituras desde el cuerpo vivo, con guard de equivalencia -----------

do $$
declare
  v_def text;
  v_nuevo text;
  v_n int;
  v_overloads int;
  v_dif int;
  r record;
  v_anclas text[][];
  i int;
begin
  -- Foto ANTES, para todos los clientes con movimientos.
  create temp table _cc_antes on commit drop as
    select c.id as cliente_id, d.debito_id, d.vivo, d.vence_el
      from public.clientes c
     cross join lateral public.cc_deudas_vivas(c.id) d
     where exists (select 1 from public.cuenta_corriente_movimientos m
                    where m.cliente_id = c.id);

  create temp table _vencida_antes on commit drop as
    select * from public.deuda_cc_vencida(null);

  -- cc_deudas_vivas
  v_def := pg_get_functiondef('public.cc_deudas_vivas(uuid,uuid)'::regprocedure);
  -- `vence` es lo que se muestra; `orden` es por dónde cancelan los pagos.
  -- Un ticket ordena por su vencimiento (el propio de una cuota o la regla).
  -- Un recargo huérfano VENCE el día que nace, pero ORDENA como una compra de
  -- ese día: es lo que hacía el orden por fecha, y ordenarlo por su
  -- vencimiento lo pagaría antes que tickets más viejos (medido el 19/10:
  -- SILVINA GONZALEZ en Colores pasaba de vencida a al día).
  v_anclas := array[
    [E'           false as es_mora_huerfana\n      from tickets t\n      left join mora_por_ticket mt on mt.ticket_id = t.id',
     E'           false as es_mora_huerfana,\n           coalesce(t.vence_el, public.cc_vence_el(t.dia, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento)) as vence,\n           coalesce(t.vence_el, public.cc_vence_el(t.dia, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento)) as orden\n      from tickets t\n      cross join cliente cl\n      left join mora_por_ticket mt on mt.ticket_id = t.id'],
    [E'           m.monto, m.monto, true\n      from movs m',
     E'           m.monto, m.monto, true, m.dia,\n           public.cc_vence_el(m.dia, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento)\n      from movs m\n      cross join cliente cl'],
    [E'             order by u.fecha, u.creado_en, u.id',
     E'             order by u.orden, u.fecha, u.creado_en, u.id'],
    [E'         case when o.es_mora_huerfana then o.fecha\n              else public.cc_vence_el(o.fecha, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento) end,',
     E'         o.vence,'],
    [E'   order by o.fecha, o.creado_en, o.id;',
     E'   order by o.orden, o.fecha, o.creado_en, o.id;']
  ];
  for i in 1..array_length(v_anclas, 1) loop
    v_n := (length(v_def) - length(replace(v_def, v_anclas[i][1], ''))) / length(v_anclas[i][1]);
    if v_n <> 1 then
      raise exception 'Guard: ancla % de cc_deudas_vivas matchea % veces', i, v_n;
    end if;
    v_def := replace(v_def, v_anclas[i][1], v_anclas[i][2]);
  end loop;
  execute v_def;

  -- deuda_cc_vencida: la mora se pega al ticket de capital que vence primero.
  v_def := pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure);
  v_anclas := array[
    [E'array_agg(m.debito_id order by m.fecha, m.creado_en, m.debito_id)',
     E'array_agg(m.debito_id order by m.vence_el, m.fecha, m.creado_en, m.debito_id)']
  ];
  v_n := (length(v_def) - length(replace(v_def, v_anclas[1][1], ''))) / length(v_anclas[1][1]);
  if v_n <> 1 then
    raise exception 'Guard: ancla de deuda_cc_vencida matchea % veces', v_n;
  end if;
  execute replace(v_def, v_anclas[1][1], v_anclas[1][2]);

  -- Equivalencia: la deuda de hoy no tiene cuotas, así que nada cambia.
  select count(*) into v_dif from (
    (select cliente_id, debito_id, vivo, vence_el from _cc_antes
     except
     select c.id, d.debito_id, d.vivo, d.vence_el
       from public.clientes c
      cross join lateral public.cc_deudas_vivas(c.id) d
      where c.id in (select cliente_id from _cc_antes))
    union all
    (select c.id, d.debito_id, d.vivo, d.vence_el
       from public.clientes c
      cross join lateral public.cc_deudas_vivas(c.id) d
      where c.id in (select cliente_id from _cc_antes)
     except
     select cliente_id, debito_id, vivo, vence_el from _cc_antes)
  ) x;
  if v_dif <> 0 then
    raise exception 'Guard: cc_deudas_vivas cambió en % filas', v_dif;
  end if;

  select count(*) into v_dif from (
    (select * from _vencida_antes except select * from public.deuda_cc_vencida(null))
    union all
    (select * from public.deuda_cc_vencida(null) except select * from _vencida_antes)
  ) x;
  if v_dif <> 0 then
    raise exception 'Guard: deuda_cc_vencida cambió en % filas', v_dif;
  end if;
  raise notice 'Equivalencia OK: % tickets, % clientes en deuda_cc_vencida',
    (select count(*) from _cc_antes), (select count(*) from _vencida_antes);

  -- registrar_venta
  v_def := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_anclas := array[
    -- El plan no pide fiar_sin_recargo: su tasa (0 incluido) la configuró el
    -- comercio y cc_registrar_cuotas_venta la valida.
    [E'         and not coalesce(public.tiene_permiso(''ventas.fiar_sin_recargo''), false) then',
     E'         and nullif(p_cc->>''cuotas'', '''') is null\n         and not coalesce(public.tiene_permiso(''ventas.fiar_sin_recargo''), false) then'],
    -- Día comercial, no UTC.
    [E'v_negocio, (v_fecha_venta at time zone ''UTC'')::date);',
     E'v_negocio, (v_fecha_venta at time zone ''America/Argentina/Buenos_Aires'')::date);'],
    [E'      insert into public.cuenta_corriente_movimientos (\n        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n        monto_recargo, recargo_porcentaje\n      )\n      values (\n        v_negocio, v_cliente, v_venta_id, ''DEBITO'', v_pendiente,\n        p_cc->>''descripcion'', v_vendedor,\n        v_recargo_cc,\n        (p_venta->>''recargo_cc_porcentaje'')::numeric\n      );',
     E'      if nullif(p_cc->>''cuotas'', '''') is null then\n        insert into public.cuenta_corriente_movimientos (\n          negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n          monto_recargo, recargo_porcentaje\n        )\n        values (\n          v_negocio, v_cliente, v_venta_id, ''DEBITO'', v_pendiente,\n          p_cc->>''descripcion'', v_vendedor,\n          v_recargo_cc,\n          (p_venta->>''recargo_cc_porcentaje'')::numeric\n        );\n      else\n        -- Venta en cuotas (20261019140000): N tickets con su vencimiento.\n        -- La venta vence con la primera cuota.\n        v_vencimiento := public.cc_registrar_cuotas_venta(\n          v_negocio, v_cliente, v_venta_id, v_vendedor, v_pendiente,\n          v_recargo_cc, (p_venta->>''recargo_cc_porcentaje'')::numeric,\n          (p_cc->>''cuotas'')::int, p_cc->>''descripcion'',\n          (v_fecha_venta at time zone ''America/Argentina/Buenos_Aires'')::date,\n          coalesce((p_venta->>''registrada_offline'')::boolean, false)\n        );\n      end if;']
  ];
  for i in 1..array_length(v_anclas, 1) loop
    v_n := (length(v_def) - length(replace(v_def, v_anclas[i][1], ''))) / length(v_anclas[i][1]);
    if v_n <> 1 then
      raise exception 'Guard: ancla % de registrar_venta matchea % veces', i, v_n;
    end if;
    v_def := replace(v_def, v_anclas[i][1], v_anclas[i][2]);
  end loop;
  execute v_def;

  v_def := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  if position('SIN_PERMISO_FIAR_SIN_RECARGO' in v_def) = 0
     or position('security.current_negocio_id()' in v_def) = 0
     or position('cc_registrar_cuotas_venta' in v_def) = 0
     or position('SALDO_A_FAVOR_INSUFICIENTE' in v_def) = 0
     or position('at time zone ''UTC''' in v_def) > 0 then
    raise exception 'Guard: registrar_venta no quedó como se esperaba';
  end if;

  for r in
    select p.proname, p.prosecdef from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('registrar_venta', 'cc_deudas_vivas', 'deuda_cc_vencida',
                         'cc_registrar_cuotas_venta')
  loop
    if r.prosecdef then
      raise exception 'Guard: % pasó a SECURITY DEFINER', r.proname;
    end if;
  end loop;

  select count(*) into v_overloads from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('registrar_venta', 'cc_deudas_vivas', 'deuda_cc_vencida',
                     'cc_registrar_cuotas_venta');
  if v_overloads <> 4 then
    raise exception 'Guard: % versiones entre las 4 funciones', v_overloads;
  end if;

  -- Los mismos casos que plan-cuotas-cc.test.ts (vencimientosMensuales).
  if (date '2027-01-31' + 1 * interval '1 month')::date <> date '2027-02-28'
     or (date '2027-01-31' + 2 * interval '1 month')::date <> date '2027-03-31'
     or (date '2027-01-31' + 3 * interval '1 month')::date <> date '2027-04-30'
     or (date '2028-01-30' + 1 * interval '1 month')::date <> date '2028-02-29'
     or (date '2026-12-15' + 13 * interval '1 month')::date <> date '2028-01-15' then
    raise exception 'Guard: los vencimientos mensuales no coinciden con el espejo TS';
  end if;
end $$;
