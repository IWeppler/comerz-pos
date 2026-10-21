-- Pendiente real de varias ventas en UNA sola llamada.
--
-- Contexto: `ventas.monto_pendiente` se congela al vender y no baja cuando el
-- cliente paga después (Evens: 346 ventas "pendientes" por $12,8 M, contra $5,1 M
-- de deuda real). El pendiente real sale de la cuenta corriente, con imputación
-- FIFO, en `cc_deudas_vivas_detalle` (una función por cliente). Esta función la
-- aplica a un conjunto de ventas y devuelve el resultado en una sola consulta,
-- en vez de una llamada por cliente desde la pantalla.
--
-- Qué devuelve: una fila por venta pedida que tenga cliente. `pendiente` es lo
-- que el cliente debe por esa venta, incluida la mora del ticket.
--
-- Seguridad: SECURITY INVOKER (el default). La consulta sobre `ventas` y la
-- función por cliente corren con los permisos de quien llama, así que RLS
-- aplica igual que en el resto de la app: no devuelve ventas de otro negocio.
--
-- Medición (Evens, solo lectura, dentro de una transacción revertida):
-- 362 ventas con cliente y pendiente congelado -> $4.733.869 de pendiente real.
-- Y la deuda de clientes con ventas más el saldo sin venta da exacto el saldo
-- de cuenta corriente: $4.733.869 + $306.415 = $5.040.284.

begin;

do $guard$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'pendientes_ventas_cc'
  ) then
    raise exception 'pendientes_ventas_cc ya existe: revisar antes de reemplazarla';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cc_deudas_vivas_detalle'
  ) then
    raise exception 'falta cc_deudas_vivas_detalle: la función depende de ella';
  end if;
end
$guard$;

create function public.pendientes_ventas_cc(p_venta_ids uuid[])
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
  clientes as (
    select distinct cliente_id from ventas_c
  ),
  vivos as (
    select d.venta_id, sum(d.vivo) as pendiente
      from clientes c
     cross join lateral public.cc_deudas_vivas_detalle(c.cliente_id) d
     where d.venta_id is not null
     group by d.venta_id
  )
  select vc.id, coalesce(vv.pendiente, 0)
    from ventas_c vc
    left join vivos vv on vv.venta_id = vc.id;
$$;

revoke all on function public.pendientes_ventas_cc(uuid[]) from public, anon;
grant execute on function public.pendientes_ventas_cc(uuid[]) to authenticated, service_role;

-- Guard: la función quedó instalada con su firma y sin permiso para anon.
do $verif$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'pendientes_ventas_cc'
  ) then
    raise exception 'pendientes_ventas_cc no quedó instalada';
  end if;
  if has_function_privilege('anon', 'public.pendientes_ventas_cc(uuid[])', 'EXECUTE') then
    raise exception 'anon no debe poder ejecutar pendientes_ventas_cc';
  end if;
end
$verif$;

commit;
