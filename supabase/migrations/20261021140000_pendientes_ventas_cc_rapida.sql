-- pendientes_ventas_cc, versión en una pasada (reemplaza el cuerpo de 20261021130000).
--
-- Antes llamaba `cc_deudas_vivas_detalle` una vez por cliente (lateral). Ahora
-- resuelve el FIFO de todos los clientes de las ventas pedidas en una sola
-- consulta. Misma regla: los débitos se cancelan por orden de vencimiento
-- (vence_el, o el que corresponda por la configuración), e incluye la mora
-- cargada al ticket.
--
-- Verificación (Evens y El Nono Cacho, dentro de una transacción revertida):
-- 946 ventas comparadas contra la versión anterior: 0 diferencias.
-- Costo en Evens para las 145 ventas de 30 días: de 698 ms a 208 ms.
--
-- Cambios respecto de la versión anterior:
--  - `IN (select … from tickets)` pasó a joins y NOT EXISTS (evita subconsultas
--    que se reevalúan por fila).
--  - Las ventanas se particionan por cliente, en vez de correr sobre toda la lista.
--
-- Misma firma, mismo permiso (invoker, sin acceso a anon).

begin;

do $guard$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'pendientes_ventas_cc'
       and pg_get_function_arguments(p.oid) = 'p_venta_ids uuid[]'
  ) then
    raise exception 'pendientes_ventas_cc (uuid[]) no existe: aplicar 20261021130000 primero';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cc_vence_el'
  ) then
    raise exception 'falta cc_vence_el';
  end if;
end
$guard$;

create or replace function public.pendientes_ventas_cc(p_venta_ids uuid[])
returns table (venta_id uuid, pendiente numeric)
language sql
stable
set search_path = ''
as $$
  with ventas_c as (
    select v.id, v.cliente_id
      from public.ventas v
     where v.id = any(p_venta_ids)
       and v.cliente_id is not null
  ),
  clientes_c as (
    select distinct c.id as cliente_id, c.negocio_id,
           coalesce(cp.cc_plazo_mora, 30) as dias,
           cp.cc_vencimiento_modo as modo,
           cp.cc_dia_cierre as dia_cierre,
           cp.cc_dia_vencimiento as dia_vencimiento
      from public.clientes c
      join ventas_c vc on vc.cliente_id = c.id
      left join public.configuracion_pos cp on cp.negocio_id = c.negocio_id
  ),
  movs as (
    select m.id, m.cliente_id, m.venta_id, m.tipo, m.monto, m.pago_id,
           m.debito_origen_id, m.creado_en, m.vence_el,
           cc.dias, cc.modo, cc.dia_cierre, cc.dia_vencimiento,
           coalesce(m.fecha_origen, (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date) as dia
      from public.cuenta_corriente_movimientos m
      join clientes_c cc on cc.cliente_id = m.cliente_id and cc.negocio_id = m.negocio_id
     where m.anulado = false
  ),
  tickets as (
    select * from movs where tipo = 'DEBITO' and pago_id is null
  ),
  mora_por_ticket as (
    select t.id as ticket_id, sum(m.monto) as mora
      from tickets t
      join movs m on m.debito_origen_id = t.id
     where m.tipo = 'DEBITO'
       and m.pago_id is not null
     group by t.id
  ),
  unidades as (
    select t.cliente_id, t.id, t.venta_id, t.creado_en,
           t.monto + coalesce(mt.mora, 0) as total,
           coalesce(t.vence_el, public.cc_vence_el(t.dia, t.modo, t.dias, t.dia_cierre, t.dia_vencimiento)) as orden,
           t.dia as fecha
      from tickets t
      left join mora_por_ticket mt on mt.ticket_id = t.id
    union all
    select m.cliente_id, m.id, null::uuid, m.creado_en,
           m.monto,
           public.cc_vence_el(m.dia, m.modo, m.dias, m.dia_cierre, m.dia_vencimiento),
           m.dia
      from movs m
     where m.tipo = 'DEBITO'
       and m.pago_id is not null
       and not exists (select 1 from tickets t where t.id = m.debito_origen_id)
  ),
  ordenadas as (
    select u.*,
           sum(u.total) over (
             partition by u.cliente_id
             order by u.orden, u.fecha, u.creado_en, u.id
             rows unbounded preceding
           ) as acumulado
      from unidades u
  ),
  pagado as (
    select m.cliente_id, coalesce(sum(m.monto), 0) as total
      from movs m
     where m.tipo = 'CREDITO'
     group by m.cliente_id
  ),
  vivos as (
    select o.venta_id,
           greatest(0, least(o.total, o.acumulado - coalesce(pg.total, 0))) as vivo
      from ordenadas o
      left join pagado pg on pg.cliente_id = o.cliente_id
     where o.venta_id is not null
  )
  select vc.id, coalesce(sum(vv.vivo), 0)
    from ventas_c vc
    left join vivos vv on vv.venta_id = vc.id
   group by vc.id;
$$;

-- Permisos: la función ya existe con la firma; se reafirman por claridad.
revoke all on function public.pendientes_ventas_cc(uuid[]) from public, anon;
grant execute on function public.pendientes_ventas_cc(uuid[]) to authenticated, service_role;

do $verif$
begin
  if has_function_privilege('anon', 'public.pendientes_ventas_cc(uuid[])', 'EXECUTE') then
    raise exception 'anon no debe poder ejecutar pendientes_ventas_cc';
  end if;
end
$verif$;

commit;
