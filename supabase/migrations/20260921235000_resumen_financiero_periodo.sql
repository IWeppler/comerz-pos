-- El resumen del período para la pestaña Dinero: RPC `resumen_financiero_periodo`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ RESPONDE (Y QUÉ NO)
--
-- `posicion_dinero` responde DÓNDE está la plata ahora (fotos: saldos, por
-- acreditar). Esto responde QUÉ PASÓ en el período: cuánto entró, por dónde,
-- cuánto salió, en qué, y cuánto quedó. Es flujo, no resultado.
--
-- **`neto_caja` NO es la ganancia.** La ganancia necesita el costo de la
-- mercadería vendida y vive en el panel (`get-dashboard-metrics`,
-- `margen_realizado`). Devolver acá un "resultado" sin costo sería una
-- segunda ganancia distinta de la del panel, y dos números con el mismo
-- nombre son la forma más rápida de perder la confianza. El campo se llama
-- como lo que es, y la pantalla tiene que decirlo al lado del número.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LAS REGLAS QUE HEREDA
--
-- * Ingresos = cobros NO anulados (`20260920160000`: ingresos/ventas miran el
--   estado; el efectivo del cajón, no — pero eso es el arqueo, no esto).
--   Cuenta corriente NO es un ingreso: un fiado no es plata que entró. Lo que
--   sí entra es el COBRO de esa deuda (`tipo_movimiento` distinto de
--   PAGO_VENTA), y viaja separado en `cobros_de_deuda`.
-- * Reintegros = `reintegros_al_cliente`, la fuente única de "qué le
--   devolvimos y por qué medio", en todos los medios.
-- * Egresos por tipo, y los OPERATIVOS por categoría (viva, con "Sin
--   categoría" como fila propia: null es un valor, no un hueco).
-- * **`neto_caja = cobrado − reintegros − egresos sin DEVOLUCION`.** El
--   reintegro en efectivo existe DOS veces en la base —como fila de
--   `reintegros_al_cliente` y como egreso `DEVOLUCION`— y restar las dos lo
--   contaría doble. Se resta por la vista (que además trae los digitales, que
--   no tienen egreso) y el tipo DEVOLUCION se muestra en el desglose pero no
--   entra al neto.
-- * Faltantes y sobrantes de arqueo salen del ledger (`AJUSTE_ARQUEO`), que
--   desde `20260920180000` es la única fuente donde son un movimiento propio.
-- * Las transferencias se informan (cantidad y monto) y no suman: son pases
--   entre cuentas propias.
-- * El período se resuelve en la BASE con la misma forma que `posicion_dinero`
--   (`p_periodo` hoy/semana/mes/anio, o `p_desde`/`p_hasta`), en hora de
--   Buenos Aires. Gate `caja.ver_gerencial`, el de la pestaña.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.resumen_financiero_periodo(
  p_desde date default null,
  p_hasta date default null,
  p_periodo text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid := security.current_negocio_id();
  v_hoy date := (now() at time zone v_tz)::date;
  v_desde date;
  v_hasta date;
  v_ini timestamptz;
  v_fin timestamptz;
  v_out jsonb;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if p_periodo is not null then
    v_hasta := v_hoy;
    v_desde := case p_periodo
      when 'hoy' then v_hoy
      when 'semana' then date_trunc('week', v_hoy)::date
      when 'mes' then date_trunc('month', v_hoy)::date
      when 'anio' then date_trunc('year', v_hoy)::date
      else v_hoy end;
  else
    v_hasta := coalesce(p_hasta, v_hoy);
    v_desde := coalesce(p_desde, v_hasta - 29);
  end if;

  -- Rango en timestamptz para que los índices por fecha se usen (un cast por
  -- fila a date los deja afuera).
  v_ini := (v_desde::timestamp) at time zone v_tz;
  v_fin := ((v_hasta + 1)::timestamp) at time zone v_tz;

  with cobros as (
    select vp.metodo_tipo, vp.tipo_movimiento, vp.monto_bruto
      from public.venta_pagos vp
     where vp.negocio_id = v_negocio
       and vp.creado_en >= v_ini and vp.creado_en < v_fin
       and coalesce(vp.estado_pago_operacion, 'CONFIRMADO') <> 'ANULADO'
  ),
  reintegros as (
    select r.metodo_tipo, r.monto
      from public.reintegros_al_cliente r
     where r.negocio_id = v_negocio
       and r.fecha >= v_ini and r.fecha < v_fin
  ),
  egresos_p as (
    select e.tipo, e.monto, e.categoria_id, ce.nombre as categoria_nombre
      from public.egresos e
      left join public.categorias_egreso ce
        on ce.id = e.categoria_id and ce.negocio_id = v_negocio
     where e.negocio_id = v_negocio
       and e.fecha >= v_ini and e.fecha < v_fin
  ),
  transf as (
    select count(*) as cantidad, coalesce(sum(t.monto), 0) as monto
      from public.transferencias_financieras t
     where t.negocio_id = v_negocio
       and t.fecha >= v_ini and t.fecha < v_fin
  ),
  arqueo as (
    select coalesce(sum(case when m.importe < 0 then -m.importe else 0 end), 0) as faltantes,
           coalesce(sum(case when m.importe > 0 then  m.importe else 0 end), 0) as sobrantes,
           count(*) filter (where m.importe <> 0) as turnos_con_diferencia
      from public.movimientos_financieros m
     where m.negocio_id = v_negocio
       and m.origen_tipo = 'TURNO_CAJA' and m.evento = 'AJUSTE_ARQUEO'
       and m.fecha_movimiento >= v_ini and m.fecha_movimiento < v_fin
  ),
  tot as (
    select
      (select coalesce(sum(monto_bruto), 0) from cobros) as cobrado,
      (select coalesce(sum(monto_bruto), 0) from cobros where tipo_movimiento = 'PAGO_VENTA') as cobrado_ventas,
      (select coalesce(sum(monto_bruto), 0) from cobros where tipo_movimiento <> 'PAGO_VENTA') as cobros_de_deuda,
      (select count(*) from cobros) as cantidad_cobros,
      (select coalesce(sum(monto), 0) from reintegros) as reintegros,
      (select count(*) from reintegros) as cantidad_reintegros,
      (select coalesce(sum(monto), 0) from egresos_p) as egresos_total,
      (select coalesce(sum(monto), 0) from egresos_p where tipo <> 'DEVOLUCION') as egresos_sin_devolucion,
      (select coalesce(sum(monto), 0) from egresos_p where tipo = 'OPERATIVO') as gasto_operativo,
      (select coalesce(sum(monto), 0) from egresos_p where tipo = 'OPERATIVO' and categoria_id is null) as gasto_sin_categoria,
      (select count(*) from egresos_p where tipo = 'OPERATIVO' and categoria_id is null) as cantidad_sin_categoria
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'periodo', p_periodo, 'generado_en', now(),
    'ingresos', jsonb_build_object(
      'cobrado', t.cobrado,
      'cobrado_ventas', t.cobrado_ventas,
      'cobros_de_deuda', t.cobros_de_deuda,
      'cantidad', t.cantidad_cobros,
      'por_medio', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'metodo_tipo', c.metodo_tipo, 'monto', c.monto, 'cantidad', c.cantidad
               ) order by c.monto desc)
          from (select metodo_tipo, sum(monto_bruto) monto, count(*) cantidad
                  from cobros group by metodo_tipo) c
      ), '[]'::jsonb)
    ),
    'reintegros', jsonb_build_object(
      'total', t.reintegros,
      'cantidad', t.cantidad_reintegros,
      'por_medio', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'metodo_tipo', r.metodo_tipo, 'monto', r.monto, 'cantidad', r.cantidad
               ) order by r.monto desc)
          from (select metodo_tipo, sum(monto) monto, count(*) cantidad
                  from reintegros group by metodo_tipo) r
      ), '[]'::jsonb)
    ),
    'egresos', jsonb_build_object(
      'total', t.egresos_total,
      'sin_devolucion', t.egresos_sin_devolucion,
      'gasto_operativo', t.gasto_operativo,
      'por_tipo', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'tipo', x.tipo, 'monto', x.monto, 'cantidad', x.cantidad
               ) order by x.monto desc)
          from (select tipo, sum(monto) monto, count(*) cantidad
                  from egresos_p group by tipo) x
      ), '[]'::jsonb),
      'gastos_por_categoria', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'categoria_id', g.categoria_id,
                 'categoria_nombre', coalesce(g.categoria_nombre, 'Sin categoría'),
                 'monto', g.monto, 'cantidad', g.cantidad
               ) order by g.monto desc)
          from (select categoria_id, categoria_nombre, sum(monto) monto, count(*) cantidad
                  from egresos_p where tipo = 'OPERATIVO'
                 group by categoria_id, categoria_nombre) g
      ), '[]'::jsonb),
      'sin_categoria', jsonb_build_object(
        'monto', t.gasto_sin_categoria, 'cantidad', t.cantidad_sin_categoria
      )
    ),
    'transferencias', (select jsonb_build_object('cantidad', cantidad, 'monto', monto) from transf),
    'arqueo', (select jsonb_build_object(
                 'faltantes', faltantes, 'sobrantes', sobrantes,
                 'turnos_con_diferencia', turnos_con_diferencia) from arqueo),
    -- Flujo, no ganancia. Ver el encabezado.
    'neto_caja', t.cobrado - t.reintegros - t.egresos_sin_devolucion
  )
  into v_out
  from tot t;

  return v_out;
end;
$$;

revoke all on function public.resumen_financiero_periodo(date, date, text) from public, anon;
grant execute on function public.resumen_financiero_periodo(date, date, text) to authenticated;

comment on function public.resumen_financiero_periodo(date, date, text) is
  'Flujo del período para la pestaña Dinero: cobros no anulados (por medio; ventas y cobros de deuda aparte), reintegros, egresos por tipo y gastos operativos por categoría, transferencias, faltantes/sobrantes de arqueo y neto_caja. neto_caja NO es ganancia (no tiene costo de mercadería). Gate caja.ver_gerencial.';

do $guard$
declare
  v_def text := pg_get_functiondef('public.resumen_financiero_periodo(date,date,text)'::regprocedure);
begin
  if v_def not like '%caja.ver_gerencial%' then
    raise exception 'GUARD: resumen_financiero_periodo no pide caja.ver_gerencial';
  end if;
  if v_def not like '%<> ''ANULADO''%' then
    raise exception 'GUARD: los ingresos dejaron de excluir los cobros anulados';
  end if;
  if v_def not like '%egresos_sin_devolucion%' or v_def not like '%reintegros_al_cliente%' then
    raise exception 'GUARD: el neto volvió a contar el reintegro en efectivo dos veces';
  end if;
  if (select count(*) from regexp_matches(v_def, 'negocio_id = v_negocio', 'g')) < 6 then
    raise exception 'GUARD: faltan filtros de negocio (DEFINER)';
  end if;
end
$guard$;

commit;
