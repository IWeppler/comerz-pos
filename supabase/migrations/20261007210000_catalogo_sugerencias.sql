-- M4: candidato de consulta. Antes de aplicar, medir con scripts/medir-sugerencias-carrito.mjs.
begin;
create function public.sugerencias_carrito(p_producto_ids uuid[], p_limite integer default 6)
returns table (producto_id uuid)
language sql stable security definer set search_path = '' as $$
  with negocio as materialized (
    select security.negocio_publico() id
  ), carrito as materialized (
    select distinct x.id from unnest(coalesce(p_producto_ids, '{}'::uuid[])) x(id)
    where x.id is not null limit 100
  ), compras as materialized (
    select distinct v.id venta_id, vi.producto_id
    from negocio n join public.ventas v on v.negocio_id = n.id
    join public.ventas_items vi on vi.venta_id = v.id and vi.negocio_id = n.id
    where v.estado_operacion <> 'ANULADA' and v.fecha_venta >= now() - interval '180 days'
      and vi.producto_id is not null and vi.cantidad > vi.cantidad_devuelta
  ), relacionadas as materialized (
    select distinct c.venta_id from compras c join carrito k on k.id = c.producto_id
  ), ranking as (
    select c.producto_id, count(*) filter (where r.venta_id is not null) juntos, count(*) vendido
    from compras c left join relacionadas r on r.venta_id = c.venta_id group by c.producto_id
  ), categorias as (
    select distinct p.categoria_id from negocio n join public.productos p on p.negocio_id = n.id
    join carrito c on c.id = p.id where p.categoria_id is not null
  )
  select p.id
  from negocio n join public.productos p on p.negocio_id = n.id
  left join ranking r on r.producto_id = p.id
  where p.publicado and p.slug is not null
    and not exists (select 1 from carrito c where c.id = p.id)
    and exists (select 1 from public.configuracion_pos cp where cp.negocio_id = n.id and (
      cp.mostrar_sin_stock or exists (select 1 from public.producto_variantes pv where pv.negocio_id = n.id and pv.producto_id = p.id and pv.activa and pv.stock > 0)))
  order by coalesce(r.juntos, 0) desc, coalesce(r.vendido, 0) desc,
    exists (select 1 from categorias c where c.categoria_id = p.categoria_id) desc,
    p.creado_en desc, p.id
  limit greatest(0, least(coalesce(p_limite, 6), 6));
$$;
revoke all on function public.sugerencias_carrito(uuid[],integer) from public, anon, authenticated;
grant execute on function public.sugerencias_carrito(uuid[],integer) to anon, authenticated;
do $$
begin
  if not has_function_privilege('anon', 'public.sugerencias_carrito(uuid[],integer)', 'execute') then raise exception 'Falta EXECUTE'; end if;
  if has_table_privilege('anon', 'public.ventas', 'select') or has_table_privilege('anon', 'public.ventas_items', 'select') then raise exception 'Anon no debe leer ventas'; end if;
  if not exists (select 1 from pg_proc where oid = 'public.sugerencias_carrito(uuid[],integer)'::regprocedure and prosecdef and prorettype = 'uuid'::regtype) then raise exception 'Sugerencias debe devolver solo IDs'; end if;
end $$;
commit;
