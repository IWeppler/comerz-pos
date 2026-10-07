-- Asociaciones explícitas y análisis observado. No activa asociaciones al migrar.
begin;
set local lock_timeout = '5s';
create table public.productos_complementarios_catalogo (
  negocio_id uuid not null default security.current_negocio_id() references public.negocios(id),
  producto_a_id uuid not null references public.productos(id) on delete cascade,
  producto_b_id uuid not null references public.productos(id) on delete cascade,
  primary key (negocio_id, producto_a_id, producto_b_id),
  check (producto_a_id < producto_b_id)
);
create index on public.productos_complementarios_catalogo (negocio_id, producto_b_id);
alter table public.productos_complementarios_catalogo enable row level security;
create policy aislamiento_negocio on public.productos_complementarios_catalogo
  as restrictive to authenticated using (negocio_id = (select security.current_negocio_id()));
create policy leer_complementos on public.productos_complementarios_catalogo
  for select to authenticated using ((select public.tiene_permiso('caja.ver_gerencial')));
revoke all on public.productos_complementarios_catalogo from public, anon, authenticated;
grant select on public.productos_complementarios_catalogo to authenticated;

-- Fuente única para recomendaciones y análisis; no es un endpoint público.
create function security.compras_catalogo_180d(p_negocio uuid)
returns table (venta_id uuid, producto_id uuid)
language sql stable security invoker set search_path = '' as $$
  select distinct v.id, vi.producto_id
  from public.ventas v join public.ventas_items vi on vi.venta_id = v.id and vi.negocio_id = p_negocio
  where v.negocio_id = p_negocio and v.estado_operacion <> 'ANULADA'
    and v.fecha_venta >= now() - interval '180 days'
    and vi.producto_id is not null and vi.cantidad > vi.cantidad_devuelta;
$$;
revoke all on function security.compras_catalogo_180d(uuid) from public, anon, authenticated;

create function public.configurar_complemento_catalogo(p_producto_a uuid, p_producto_b uuid, p_activo boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n uuid := security.current_negocio_id(); a uuid := least(p_producto_a,p_producto_b); b uuid := greatest(p_producto_a,p_producto_b);
begin
  if n is null or not coalesce(public.is_admin(), false) then raise exception 'SIN_PERMISO' using errcode = '42501'; end if;
  if p_producto_a is null or p_producto_b is null or a = b or p_activo is null then raise exception 'PRODUCTOS_INVALIDOS'; end if;
  if (select count(*) from public.productos p where p.negocio_id = n and p.id in (a,b)) <> 2 then raise exception 'PRODUCTOS_INVALIDOS'; end if;
  if p_activo then
    insert into public.productos_complementarios_catalogo(negocio_id,producto_a_id,producto_b_id) values(n,a,b) on conflict do nothing;
  else
    delete from public.productos_complementarios_catalogo c where c.negocio_id = n and c.producto_a_id = a and c.producto_b_id = b;
  end if;
  if exists(select 1 from public.productos_complementarios_catalogo c where c.negocio_id = n and c.producto_a_id = a and c.producto_b_id = b) <> p_activo then raise exception 'NO_SE_GUARDO'; end if;
  return p_activo;
end $$;
revoke all on function public.configurar_complemento_catalogo(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.configurar_complemento_catalogo(uuid,uuid,boolean) to authenticated;

create function public.analisis_complementos_catalogo()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare n uuid := security.current_negocio_id(); resultado jsonb;
begin
  if n is null or not coalesce(public.tiene_permiso('caja.ver_gerencial'), false) then raise exception 'SIN_PERMISO' using errcode='42501'; end if;
  with compras as materialized (select * from security.compras_catalogo_180d(n)),
  frecuencias as (select producto_id,count(*) ventas from compras group by producto_id),
  pares as (
    select a.producto_id a, b.producto_id b, count(*) juntos
    from compras a join compras b on b.venta_id = a.venta_id and a.producto_id < b.producto_id
    group by a.producto_id,b.producto_id having count(*) >= 2
  ), elegidos as (
    select a,b,juntos from pares
    union all
    select c.producto_a_id,c.producto_b_id,coalesce(p.juntos,0) from public.productos_complementarios_catalogo c
    left join pares p on p.a=c.producto_a_id and p.b=c.producto_b_id
    where c.negocio_id=n and p.a is null
  ), detalle as (
    select pa.id producto_a_id,pa.nombre producto_a,pb.id producto_b_id,pb.nombre producto_b,
      e.juntos ventas_juntas,coalesce(fa.ventas,0) ventas_a,coalesce(fb.ventas,0) ventas_b,
      c.producto_a_id is not null activo,pa.publicado and pb.publicado publicables
    from elegidos e join public.productos pa on pa.id=e.a and pa.negocio_id=n
    join public.productos pb on pb.id=e.b and pb.negocio_id=n
    left join frecuencias fa on fa.producto_id=e.a left join frecuencias fb on fb.producto_id=e.b
    left join public.productos_complementarios_catalogo c on c.negocio_id=n and c.producto_a_id=e.a and c.producto_b_id=e.b
    order by (c.producto_a_id is not null) desc,e.juntos desc,pa.id,pb.id limit 30
  ) select jsonb_build_object('dias',180,'puede_editar',coalesce(public.is_admin(),false),
    'pares',coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb)) into resultado from detalle d;
  return resultado;
end $$;
revoke all on function public.analisis_complementos_catalogo() from public,anon,authenticated;
grant execute on function public.analisis_complementos_catalogo() to authenticated;

-- Actualizar sugerencias preservando firma, propietario y permisos del cuerpo VIVO.
do $patch$
declare vivo text; anterior text := $anterior$
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
$anterior$; nuevo text := $nuevo$
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
$nuevo$;
begin
  vivo := replace(pg_get_functiondef('public.sugerencias_carrito(uuid[],integer)'::regprocedure), E'\r\n', E'\n');
  if (length(vivo)-length(replace(vivo,anterior,'')))/length(anterior) <> 1 then raise exception 'CUERPO_SUGERENCIAS_INESPERADO'; end if;
  if not exists(select 1 from pg_proc where oid='public.sugerencias_carrito(uuid[],integer)'::regprocedure and prosecdef and prorettype='uuid'::regtype) then raise exception 'FIRMA_SUGERENCIAS_INCORRECTA'; end if;
  execute replace(vivo,anterior,nuevo);
  if not has_function_privilege('anon','public.sugerencias_carrito(uuid[],integer)','execute') then raise exception 'FALTA_EXECUTE_PUBLICO'; end if;
end $patch$;

do $$ begin
  if has_table_privilege('anon','public.productos_complementarios_catalogo','select')
    or has_function_privilege('anon','security.compras_catalogo_180d(uuid)','execute')
    or has_function_privilege('anon','public.analisis_complementos_catalogo()','execute')
    or has_function_privilege('anon','public.configurar_complemento_catalogo(uuid,uuid,boolean)','execute') then raise exception 'ACCESO_PUBLICO_INCORRECTO'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='productos_complementarios_catalogo' and policyname='aislamiento_negocio' and permissive='RESTRICTIVE') then raise exception 'FALTA_AISLAMIENTO'; end if;
end $$;
notify pgrst,'reload schema';
commit;
