-- Vuelve al ancla por CICLO de deuda: el débito más viejo posterior al último
-- saldo cero, sin mirar los pagos. Es el cuerpo de `20260905190000`
-- (mora_por_ciclo_de_deuda), copiado del cuerpo vivo antes de reemplazarlo.
--
-- El backfill de `clientes.fecha_vencimiento_deuda` se rehace al final: si no,
-- las clientas quedan con la fecha calculada por la regla nueva y una función
-- que ya no la produce.
create or replace function public.recalcular_vencimiento_cc(p_cliente_id uuid)
returns date
language sql
stable
set search_path to 'public', 'security', 'pg_temp'
as $function$
  with plazo as (
    select coalesce(cp.cc_plazo_mora, 30) as dias
    from public.clientes c
    left join public.configuracion_pos cp on cp.negocio_id = c.negocio_id
    where c.id = p_cliente_id
  ),
  movimientos as (
    select
      coalesce(m.fecha_origen, (m.creado_en at time zone 'UTC')::date) as fecha,
      m.creado_en,
      m.tipo,
      sum(case when m.tipo = 'DEBITO' then m.monto else -m.monto end) over (
        order by coalesce(m.fecha_origen, (m.creado_en at time zone 'UTC')::date),
                 m.creado_en
        rows unbounded preceding
      ) as saldo_tras
    from public.cuenta_corriente_movimientos m
    where m.cliente_id = p_cliente_id
      and m.anulado = false
  ),
  ultimo_cero as (
    select max(mo.creado_en) as creado_en
    from movimientos mo
    where mo.saldo_tras <= 0
  ),
  ancla as (
    select min(mo.fecha) as fecha
    from movimientos mo, ultimo_cero uc
    where mo.tipo = 'DEBITO'
      and (uc.creado_en is null or mo.creado_en > uc.creado_en)
  )
  select case
           when a.fecha is null then null
           else a.fecha + pl.dias
         end
  from ancla a, plazo pl;
$function$;

comment on function public.recalcular_vencimiento_cc(uuid) is null;

update public.clientes c
set fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(c.id)
where c.saldo_pendiente > 0
  and c.fecha_vencimiento_deuda is distinct from public.recalcular_vencimiento_cc(c.id);
