-- Reversión de 20261008180000_deuda_cc_vencida_por_ticket.sql
-- Vuelve al cuerpo vivo anterior (pg_get_functiondef del 8/10/2026): FIFO
-- propio con la mora como deuda aparte, sin `ventas_vencidas_nuevas`.
-- El código que lee `ventas_vencidas_nuevas` cae al comportamiento viejo del
-- monto fijo (uno por cobro) si la columna no viene.

drop function public.deuda_cc_vencida(uuid);

CREATE FUNCTION public.deuda_cc_vencida(p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(cliente_id uuid, saldo_vivo numeric, vencido numeric, fecha_mas_antigua date, mora_viva numeric, capital_vivo numeric, debito_capital_mas_antiguo_id uuid, capital_vencido numeric, recargado_saldo numeric, recargado_vencido numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'security', 'pg_temp'
AS $function$
  with plazos as (
    select c.id as cliente_id, coalesce(cp.cc_plazo_mora, 30) as dias,
           cp.cc_vencimiento_modo as modo,
           cp.cc_dia_cierre as dia_cierre,
           cp.cc_dia_vencimiento as dia_vencimiento
    from public.clientes c
    left join public.configuracion_pos cp on cp.negocio_id = c.negocio_id
    where p_cliente_id is null or c.id = p_cliente_id
  ),
  debitos as (
    select
      m.cliente_id,
      m.id as debito_id,
      coalesce(m.fecha_origen, (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date) as fecha,
      m.monto,
      m.creado_en,
      m.pago_id is not null as es_mora,
      sum(m.monto) over (
        partition by m.cliente_id
        order by coalesce(m.fecha_origen, (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date), m.creado_en
        rows unbounded preceding
      ) as acumulado
    from public.cuenta_corriente_movimientos m
    join plazos p on p.cliente_id = m.cliente_id
    where m.tipo = 'DEBITO'
      and m.anulado = false
  ),
  pagado as (
    select m.cliente_id, coalesce(sum(m.monto), 0) as total
    from public.cuenta_corriente_movimientos m
    join plazos p on p.cliente_id = m.cliente_id
    where m.tipo = 'CREDITO'
      and m.anulado = false
    group by m.cliente_id
  ),
  vivos as (
    select
      d.cliente_id,
      d.debito_id,
      d.fecha,
      d.creado_en,
      d.es_mora,
      greatest(0, least(d.monto, d.acumulado - coalesce(pg.total, 0))) as vivo,
      pl.dias,
      public.cc_vence_el(d.fecha, pl.modo, pl.dias, pl.dia_cierre, pl.dia_vencimiento) as vence_el
    from debitos d
    join plazos pl on pl.cliente_id = d.cliente_id
    left join pagado pg on pg.cliente_id = d.cliente_id
  ),
  moras as (
    select m.cliente_id,
           m.creado_en,
           (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date as dia
    from public.cuenta_corriente_movimientos m
    join plazos p on p.cliente_id = m.cliente_id
    where m.tipo = 'DEBITO'
      and m.pago_id is not null
      and m.anulado = false
  ),
  vivos_r as (
    select v.*,
           exists (
             select 1 from moras mo
             where mo.cliente_id = v.cliente_id
               and mo.creado_en > v.creado_en
           ) as recargado_saldo,
           exists (
             select 1 from moras mo
             where mo.cliente_id = v.cliente_id
               and mo.creado_en > v.creado_en
               and v.vence_el < mo.dia
           ) as recargado_vencido
    from vivos v
  ),
  ancla as (
    select distinct on (v.cliente_id) v.cliente_id, v.debito_id
    from vivos v
    where v.vivo > 0 and not v.es_mora
    order by v.cliente_id, v.fecha, v.creado_en
  )
  select
    v.cliente_id,
    round(sum(v.vivo), 2) as saldo_vivo,
    round(sum(v.vivo) filter (
      where v.vivo > 0 and v.vence_el < (now() at time zone 'America/Argentina/Buenos_Aires')::date
    ), 2) as vencido,
    min(v.fecha) filter (where v.vivo > 0) as fecha_mas_antigua,
    round(coalesce(sum(v.vivo) filter (where v.es_mora), 0), 2) as mora_viva,
    round(coalesce(sum(v.vivo) filter (where not v.es_mora), 0), 2) as capital_vivo,
    a.debito_id as debito_capital_mas_antiguo_id,
    round(coalesce(sum(v.vivo) filter (
      where v.vivo > 0 and not v.es_mora
        and v.vence_el < (now() at time zone 'America/Argentina/Buenos_Aires')::date
    ), 0), 2) as capital_vencido,
    round(coalesce(sum(v.vivo) filter (
      where v.vivo > 0 and not v.es_mora and v.recargado_saldo
    ), 0), 2) as recargado_saldo,
    round(coalesce(sum(v.vivo) filter (
      where v.vivo > 0 and not v.es_mora and v.recargado_vencido
        and v.vence_el < (now() at time zone 'America/Argentina/Buenos_Aires')::date
    ), 0), 2) as recargado_vencido
  from vivos_r v
  left join ancla a on a.cliente_id = v.cliente_id
  group by v.cliente_id, a.debito_id
  having sum(v.vivo) > 0;
$function$;

grant execute on function public.deuda_cc_vencida(uuid) to anon, authenticated, service_role;
