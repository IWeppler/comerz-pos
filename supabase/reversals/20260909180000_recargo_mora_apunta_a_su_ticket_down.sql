-- Saca el vínculo del recargo con su ticket y devuelve `deuda_cc_vencida` a la
-- forma de 20260909170000 (con capital_vivo y mora_viva, sin el id del ancla).
--
-- Las columnas se DROPEAN, así que el backfill se pierde: volver a aplicar la
-- migración lo rehace desde el ledger, que no cambia. Por eso se puede tirar
-- sin miedo — no es un dato que se cargó a mano, es una deducción reproducible.
drop function if exists public.deuda_cc_vencida(uuid);

create function public.deuda_cc_vencida(p_cliente_id uuid default null)
returns table (
  cliente_id uuid,
  saldo_vivo numeric,
  vencido numeric,
  fecha_mas_antigua date,
  mora_viva numeric,
  capital_vivo numeric
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
      m.pago_id is not null as es_mora,
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
      d.cliente_id, d.fecha, d.es_mora,
      greatest(0, least(d.monto, d.acumulado - coalesce(pg.total, 0))) as vivo,
      pl.dias
    from debitos d
    join plazos pl on pl.cliente_id = d.cliente_id
    left join pagado pg on pg.cliente_id = d.cliente_id
  )
  select
    v.cliente_id,
    round(sum(v.vivo), 2),
    round(sum(v.vivo) filter (where v.vivo > 0 and v.fecha + v.dias < current_date), 2),
    min(v.fecha) filter (where v.vivo > 0),
    round(coalesce(sum(v.vivo) filter (where v.es_mora), 0), 2),
    round(coalesce(sum(v.vivo) filter (where not v.es_mora), 0), 2)
  from vivos v
  group by v.cliente_id
  having sum(v.vivo) > 0;
$function$;

grant execute on function public.deuda_cc_vencida(uuid) to authenticated;

alter table public.cuenta_corriente_movimientos
  drop constraint if exists cc_mov_origen_solo_en_mora,
  drop constraint if exists cc_mov_origen_no_es_si_mismo;

drop index if exists public.idx_cc_mov_debito_origen;

alter table public.cuenta_corriente_movimientos
  drop column if exists debito_origen_id,
  drop column if exists origen_reconstruido;
