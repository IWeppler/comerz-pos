-- Revertir código antes. Quita SOLO asociaciones, nunca productos o ventas.
begin;
do $patch$
declare vivo text; anterior text := $anterior$
  with negocio as materialized (select security.negocio_publico() id),
  carrito as materialized (select distinct x.id from unnest(coalesce(p_producto_ids,'{}'::uuid[])) x(id) where x.id is not null limit 100),
  compras as materialized (select c.* from negocio n cross join lateral security.compras_catalogo_180d(n.id) c),
  relacionadas as (select distinct c.venta_id from compras c join carrito k on k.id=c.producto_id),
  ranking as (
    select c.producto_id,count(*) filter(where r.venta_id is not null) juntos,count(*) vendido
    from compras c left join relacionadas r on r.venta_id=c.venta_id group by c.producto_id
  ), categorias as (
    select distinct p.categoria_id,coalesce(cat.parent_id,cat.id) raiz
    from negocio n join public.productos p on p.negocio_id=n.id join carrito k on k.id=p.id
    join public.categorias cat on cat.negocio_id=n.id and cat.id=p.categoria_id
  ), manuales as (
    select case when c.producto_a_id=k.id then c.producto_b_id else c.producto_a_id end producto_id
    from negocio n join public.productos_complementarios_catalogo c on c.negocio_id=n.id
    join carrito k on k.id in (c.producto_a_id,c.producto_b_id)
  ), candidatos as (
    select p.id,p.creado_en,coalesce(r.juntos,0) juntos,coalesce(r.vendido,0) vendido,
      exists(select 1 from manuales m where m.producto_id=p.id) manual,
      case when exists(select 1 from categorias c where c.categoria_id=p.categoria_id) then 2
        when exists(select 1 from categorias c where c.raiz=coalesce(cat.parent_id,cat.id)) then 1 else 0 end afinidad
    from negocio n join public.productos p on p.negocio_id=n.id
    left join public.categorias cat on cat.id=p.categoria_id and cat.negocio_id=n.id
    left join ranking r on r.producto_id=p.id
    where p.publicado and p.slug is not null and not exists(select 1 from carrito k where k.id=p.id)
      and exists(select 1 from public.configuracion_pos cp where cp.negocio_id=n.id and (
        cp.mostrar_sin_stock or exists(select 1 from public.producto_variantes pv where pv.negocio_id=n.id and pv.producto_id=p.id and pv.activa and pv.stock>0)))
  )
  select c.id from candidatos c
  where not exists(select 1 from carrito) or c.manual or c.juntos>0 or c.afinidad>0
  order by c.manual desc,c.juntos desc,c.afinidad desc,c.vendido desc,c.creado_en desc,c.id
  limit greatest(0,least(coalesce(p_limite,6),6));
$anterior$; nuevo text := $nuevo$
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
$nuevo$;
begin
  vivo := replace(pg_get_functiondef('public.sugerencias_carrito(uuid[],integer)'::regprocedure), E'\r\n', E'\n');
  if (length(vivo)-length(replace(vivo,anterior,'')))/length(anterior) <> 1 then raise exception 'CUERPO_SUGERENCIAS_INESPERADO'; end if;
  if not exists(select 1 from pg_proc where oid='public.sugerencias_carrito(uuid[],integer)'::regprocedure and prosecdef and prorettype='uuid'::regtype) then raise exception 'FIRMA_SUGERENCIAS_INCORRECTA'; end if;
  execute replace(vivo,anterior,nuevo);
  if not has_function_privilege('anon','public.sugerencias_carrito(uuid[],integer)','execute') then raise exception 'FALTA_EXECUTE_PUBLICO'; end if;
end $patch$;
drop function public.analisis_complementos_catalogo();
drop function public.configurar_complemento_catalogo(uuid,uuid,boolean);
drop function security.compras_catalogo_180d(uuid);
drop table public.productos_complementarios_catalogo;
notify pgrst,'reload schema';
commit;
