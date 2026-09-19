-- Integra Etapas 3/4 en las lecturas gerenciales existentes.
-- Se preserva el contrato JSON y se agrega transferencias_netas.

begin;

create or replace function public.posicion_dinero(
  p_desde date default null,
  p_hasta date default null,
  p_periodo text default null
)
returns jsonb
language plpgsql stable security definer
set search_path = public, security, pg_temp
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid := security.current_negocio_id();
  v_hoy date := (now() at time zone v_tz)::date;
  v_hasta date;
  v_desde date;
  v_out jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver la posición de dinero'
      using errcode = '42501';
  end if;
  if v_negocio is null then raise exception 'No hay un negocio activo' using errcode = '42501'; end if;

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

  with turnos_abiertos as (
    select t.id, t.monto_inicial, t.fecha_apertura, t.vendedor_id,
           t.cuenta_financiera_id, coalesce(p.nombre, 'Sin nombre') vendedor
      from public.turnos_caja t left join public.perfiles p on p.id = t.vendedor_id
     where t.negocio_id = v_negocio and t.estado <> 'CERRADO'
  ),
  efectivo_turno as (
    select vp.turno_caja_id, sum(vp.monto_bruto) ingresos
      from public.venta_pagos vp join turnos_abiertos t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio and vp.metodo_tipo = 'EFECTIVO'
       and vp.estado_pago_operacion <> 'ANULADO' group by vp.turno_caja_id
  ),
  egresos_turno as (
    select e.turno_caja_id, sum(e.monto) salidas
      from public.egresos e join turnos_abiertos t on t.id = e.turno_caja_id
       and e.cuenta_origen_id = t.cuenta_financiera_id
     where e.negocio_id = v_negocio group by e.turno_caja_id
  ),
  transferencias_turno as (
    select m.turno_caja_id, sum(m.importe) neto
      from public.movimientos_financieros m join turnos_abiertos t
        on t.id = m.turno_caja_id and t.cuenta_financiera_id = m.cuenta_financiera_id
     where m.negocio_id = v_negocio and m.origen_tipo = 'TRANSFERENCIA'
     group by m.turno_caja_id
  ),
  cajas as (
    select t.id, t.vendedor, t.fecha_apertura, t.monto_inicial,
           coalesce(e.ingresos, 0) ingresos, coalesce(g.salidas, 0) salidas,
           coalesce(x.neto, 0) transferencias_netas,
           t.monto_inicial + coalesce(e.ingresos, 0) - coalesce(g.salidas, 0)
             + coalesce(x.neto, 0) esperado
      from turnos_abiertos t
      left join efectivo_turno e on e.turno_caja_id = t.id
      left join egresos_turno g on g.turno_caja_id = t.id
      left join transferencias_turno x on x.turno_caja_id = t.id
  ),
  digitales as (
    select vp.metodo_nombre, vp.metodo_tipo, vp.monto_bruto, vp.comision_monto,
           vp.monto_neto, vp.creado_en + (vp.acreditacion_dias || ' days')::interval fecha_acreditacion
      from public.venta_pagos vp where vp.negocio_id = v_negocio
       and vp.metodo_tipo <> 'EFECTIVO' and vp.estado_pago_operacion <> 'ANULADO'
  ),
  pendientes as (
    select metodo_nombre, metodo_tipo, count(*) cantidad, sum(monto_bruto) bruto,
           sum(comision_monto) comision, sum(monto_neto) neto,
           min(fecha_acreditacion) proxima, max(fecha_acreditacion) ultima
      from digitales where fecha_acreditacion > now() group by metodo_nombre, metodo_tipo
  ),
  acreditados as (
    select metodo_nombre, metodo_tipo, count(*) cantidad, sum(monto_bruto) bruto,
           sum(comision_monto) comision, sum(monto_neto) neto
      from digitales where fecha_acreditacion <= now()
       and (fecha_acreditacion at time zone v_tz)::date between v_desde and v_hasta
     group by metodo_nombre, metodo_tipo
  ),
  efectivo_cerrado as (
    select coalesce(sum(monto_declarado), 0) declarado from public.turnos_caja
     where negocio_id = v_negocio and estado = 'CERRADO'
       and (fecha_cierre at time zone v_tz)::date = v_hoy
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'periodo', p_periodo, 'generado_en', now(),
    'efectivo', jsonb_build_object(
      'total', (select coalesce(sum(esperado), 0) from cajas),
      'turnos_abiertos', (select count(*) from cajas),
      'cerrado_hoy', (select declarado from efectivo_cerrado),
      'cajas', (select coalesce(jsonb_agg(jsonb_build_object(
        'turno_id', id, 'vendedor', vendedor, 'desde', fecha_apertura,
        'inicial', monto_inicial, 'ingresos', ingresos, 'salidas', salidas,
        'transferencias_netas', transferencias_netas, 'esperado', esperado
      ) order by esperado desc), '[]'::jsonb) from cajas)
    ),
    'por_acreditar', (select coalesce(jsonb_agg(jsonb_build_object(
      'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo, 'cantidad', cantidad,
      'bruto', bruto, 'comision', comision, 'neto', neto, 'proxima', proxima, 'ultima', ultima
    ) order by neto desc), '[]'::jsonb) from pendientes),
    'acreditado', (select coalesce(jsonb_agg(jsonb_build_object(
      'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo, 'cantidad', cantidad,
      'bruto', bruto, 'comision', comision, 'neto', neto
    ) order by neto desc), '[]'::jsonb) from acreditados)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.posicion_dinero(date, date, text) from public, anon;
grant execute on function public.posicion_dinero(date, date, text) to authenticated;

create or replace function public.resumen_gerencial_caja(p_fecha date default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, security, pg_temp
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_fecha date := coalesce(p_fecha, (now() at time zone v_tz)::date);
  v_negocio uuid := security.current_negocio_id();
  v_out jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver el resumen gerencial de caja' using errcode = '42501';
  end if;
  if v_negocio is null then raise exception 'No hay un negocio activo' using errcode = '42501'; end if;

  with turnos_dia as (
    select id, estado, monto_inicial, monto_declarado, cuenta_financiera_id
      from public.turnos_caja where negocio_id = v_negocio
       and (fecha_apertura at time zone v_tz)::date = v_fecha
  ),
  pagos as (
    select vp.venta_id, vp.metodo_tipo, vp.monto_bruto, vp.tipo_movimiento
      from public.venta_pagos vp join turnos_dia t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio and vp.estado_pago_operacion <> 'ANULADO'
  ),
  ventas_dia as (
    select v.id, v.monto_pendiente from public.ventas v join turnos_dia t on t.id = v.turno_caja_id
     where v.negocio_id = v_negocio and v.estado_operacion <> 'ANULADA'
  ),
  tipos as (
    select * from (values ('EFECTIVO'), ('TRANSFERENCIA'), ('TARJETA')) c(tipo)
    union select metodo_tipo from pagos
  ),
  medios as (
    select metodo_tipo tipo, sum(monto_bruto) monto,
      count(distinct venta_id) filter (where venta_id is not null) cantidad_ventas,
      coalesce(sum(monto_bruto) filter (where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'), 0) monto_cobranzas_cc
    from pagos group by metodo_tipo
  ),
  breakdown as (
    select t.tipo, coalesce(m.monto, 0) monto, coalesce(m.cantidad_ventas, 0) cantidad_ventas,
           coalesce(m.monto_cobranzas_cc, 0) monto_cobranzas_cc
      from tipos t left join medios m on m.tipo = t.tipo
  ),
  egresos_caja as (
    select coalesce(sum(e.monto), 0) total from public.egresos e join turnos_dia t
      on t.id = e.turno_caja_id and t.cuenta_financiera_id = e.cuenta_origen_id
     where e.negocio_id = v_negocio
  ),
  transferencias_caja as (
    select coalesce(sum(m.importe), 0) neto from public.movimientos_financieros m join turnos_dia t
      on t.id = m.turno_caja_id and t.cuenta_financiera_id = m.cuenta_financiera_id
     where m.negocio_id = v_negocio and m.origen_tipo = 'TRANSFERENCIA'
  ),
  caja as (
    select (select coalesce(sum(monto_inicial), 0) from turnos_dia) fondo_inicial,
      (select coalesce(sum(monto_bruto), 0) from pagos where metodo_tipo = 'EFECTIVO') ingresos_efectivo,
      (select total from egresos_caja) egresos_efectivo,
      (select neto from transferencias_caja) transferencias_netas,
      (select count(*) from turnos_dia) turnos_totales,
      (select count(*) from turnos_dia where estado <> 'CERRADO') turnos_abiertos,
      (select coalesce(sum(monto_declarado), 0) from turnos_dia where estado = 'CERRADO') real_declarado
  )
  select jsonb_build_object(
    'fecha', v_fecha, 'generado_en', now(),
    'ventas', jsonb_build_object(
      'total_cobrado', (select coalesce(sum(monto_bruto), 0) from pagos where tipo_movimiento = 'PAGO_VENTA'),
      'cantidad_ventas', (select count(distinct venta_id) from pagos where tipo_movimiento = 'PAGO_VENTA' and venta_id is not null)),
    'cuenta_corriente', jsonb_build_object(
      'fiado_otorgado', (select coalesce(sum(monto_pendiente), 0) from ventas_dia),
      'cantidad_ventas_con_fiado', (select count(*) from ventas_dia where monto_pendiente > 0),
      'cobranzas_monto', (select coalesce(sum(monto_bruto), 0) from pagos where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'),
      'cobranzas_cantidad', (select count(*) from pagos where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE')),
    'breakdown_medios', (select coalesce(jsonb_agg(jsonb_build_object(
      'tipo', tipo, 'monto', monto, 'cantidad_ventas', cantidad_ventas,
      'monto_cobranzas_cc', monto_cobranzas_cc) order by monto desc, tipo), '[]'::jsonb) from breakdown),
    'caja', (select jsonb_build_object(
      'fondo_inicial', fondo_inicial, 'ingresos_efectivo', ingresos_efectivo,
      'egresos_efectivo', egresos_efectivo, 'transferencias_netas', transferencias_netas,
      'esperado', fondo_inicial + ingresos_efectivo - egresos_efectivo + transferencias_netas,
      'turnos_totales', turnos_totales, 'turnos_abiertos', turnos_abiertos,
      'cierre_completo', turnos_totales > 0 and turnos_abiertos = 0,
      'real_declarado', case when turnos_totales > 0 and turnos_abiertos = 0 then real_declarado end,
      'diferencia', case when turnos_totales > 0 and turnos_abiertos = 0
        then real_declarado - (fondo_inicial + ingresos_efectivo - egresos_efectivo + transferencias_netas) end
    ) from caja)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.resumen_gerencial_caja(date) from public, anon;
grant execute on function public.resumen_gerencial_caja(date) to authenticated;

commit;
