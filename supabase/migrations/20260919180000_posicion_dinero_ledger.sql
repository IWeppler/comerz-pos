-- Etapa 7: la pestaña Dinero lee el ledger. La RPC vieja se conserva como
-- referencia de conciliación mientras convivan ambos modelos.
begin;
create or replace function public.posicion_dinero_ledger(
  p_desde date default null, p_hasta date default null, p_periodo text default 'mes'
) returns jsonb language plpgsql stable security definer
set search_path = public, security, pg_temp as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_desde date := coalesce(p_desde, date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_hasta date := coalesce(p_hasta, v_hoy);
  v_legacy jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then raise exception using errcode = '42501', message = 'SIN_PERMISO'; end if;
  if p_periodo = 'hoy' then v_desde := v_hoy; v_hasta := v_hoy; end if;
  if p_periodo = 'semana' then v_desde := v_hoy - 6; v_hasta := v_hoy; end if;
  if p_periodo = 'mes' then v_desde := date_trunc('month', v_hoy)::date; v_hasta := v_hoy; end if;
  v_legacy := public.posicion_dinero(v_desde, v_hasta, p_periodo);
  return v_legacy || jsonb_build_object(
    'modelo', 'LEDGER',
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
      'cuenta_id', x.id, 'nombre', x.nombre, 'tipo', x.tipo,
      'es_efectivo', x.es_efectivo, 'saldo', x.saldo
    ) order by x.es_efectivo desc, x.nombre) from (
      select c.id, c.nombre, c.tipo, c.es_efectivo, coalesce(sum(m.importe), 0) as saldo
      from public.cuentas_financieras c left join public.movimientos_financieros m
        on m.cuenta_financiera_id = c.id and m.negocio_id = c.negocio_id
      where c.negocio_id = v_negocio and c.activa and c.codigo <> 'POR_ACREDITAR'
      group by c.id, c.nombre, c.tipo, c.es_efectivo
    ) x), '[]'::jsonb),
    'por_acreditar_real', coalesce((select jsonb_build_object(
      'nombre', c.nombre, 'saldo', coalesce(sum(m.importe), 0),
      'cantidad_movimientos', count(m.id)
    ) from public.cuentas_financieras c left join public.movimientos_financieros m
      on m.cuenta_financiera_id = c.id and m.negocio_id = c.negocio_id
    where c.negocio_id = v_negocio and c.codigo = 'POR_ACREDITAR'
    group by c.id, c.nombre), jsonb_build_object('nombre','Dinero por acreditar','saldo',0,'cantidad_movimientos',0)),
    'acreditado', coalesce((select jsonb_agg(jsonb_build_object(
      'metodo_nombre', x.nombre, 'metodo_tipo', x.tipo, 'cantidad', x.cantidad,
      'bruto', x.neto, 'comision', 0, 'neto', x.neto
    ) order by x.neto desc) from (
      select c.id, c.nombre, c.tipo, count(m.id) as cantidad, sum(m.importe) as neto
      from public.movimientos_financieros m join public.cuentas_financieras c on c.id = m.cuenta_financiera_id
      where m.negocio_id = v_negocio and m.origen_tipo = 'ACREDITACION'
        and m.evento = 'ACREDITACION_ENTRADA'
        and (m.fecha_movimiento at time zone 'America/Argentina/Buenos_Aires')::date between v_desde and v_hasta
      group by c.id, c.nombre, c.tipo
    ) x), '[]'::jsonb),
    'conciliacion', jsonb_build_object(
      'por_acreditar_ledger', coalesce((select sum(m.importe) from public.movimientos_financieros m join public.cuentas_financieras c on c.id=m.cuenta_financiera_id where c.negocio_id=v_negocio and c.codigo='POR_ACREDITAR'),0),
      'por_acreditar_anterior', coalesce((select sum((x->>'neto')::numeric) from jsonb_array_elements(v_legacy->'por_acreditar') x),0)
    )
  );
end;
$$;
revoke all on function public.posicion_dinero_ledger(date, date, text) from public;
grant execute on function public.posicion_dinero_ledger(date, date, text) to authenticated;
commit;
