-- Vuelve `deuda_cc_vencida` a su forma anterior, sin `mora_viva` ni
-- `capital_vivo`. Copiado del cuerpo vivo antes de reemplazarlo.
--
-- OJO: revertir esto reabre el interés compuesto — el recargo vuelve a
-- calcularse sobre un saldo que contiene los recargos anteriores. El código de
-- TypeScript que pasa `mora_previa` tiene que revertirse junto, o el campo
-- llega siempre en 0 y el efecto es el mismo.
drop function if exists public.deuda_cc_vencida(uuid);

create function public.deuda_cc_vencida(p_cliente_id uuid default null)
returns table (
  cliente_id uuid,
  saldo_vivo numeric,
  vencido numeric,
  fecha_mas_antigua date
)
language sql
stable
set search_path to 'public', 'security', 'pg_temp'
as $function$
  with plazos as (
    select c.id as cliente_id, coalesce(cp.cc_plazo_mora, 30) as dias
    from public.clientes c
    left join public.configuracion_pos cp on cp.negocio_id = c.negocio_id
    where p_cliente_id is null or c.id = p_cliente_id
  ),
  debitos as (
    select
      m.cliente_id,
      coalesce(m.fecha_origen, (m.creado_en at time zone 'UTC')::date) as fecha,
      m.monto,
      m.creado_en,
      sum(m.monto) over (
        partition by m.cliente_id
        order by coalesce(m.fecha_origen, (m.creado_en at time zone 'UTC')::date), m.creado_en
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
      d.fecha,
      greatest(0, least(d.monto, d.acumulado - coalesce(pg.total, 0))) as vivo,
      pl.dias
    from debitos d
    join plazos pl on pl.cliente_id = d.cliente_id
    left join pagado pg on pg.cliente_id = d.cliente_id
  )
  select
    v.cliente_id,
    round(sum(v.vivo), 2) as saldo_vivo,
    round(sum(v.vivo) filter (
      where v.vivo > 0 and v.fecha + v.dias < current_date
    ), 2) as vencido,
    min(v.fecha) filter (where v.vivo > 0) as fecha_mas_antigua
  from vivos v
  group by v.cliente_id
  having sum(v.vivo) > 0;
$function$;

grant execute on function public.deuda_cc_vencida(uuid) to authenticated;
