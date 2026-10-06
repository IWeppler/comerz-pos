-- Remitos: escribir exige `stock.ingresar_remito` (ADMIN y ENCARGADO).
--
-- Hasta hoy `ordenes_compra`, `ordenes_items`, `ordenes_borradores` y
-- `diccionario_alias` tenían policies PERMISSIVE `true` para cualquier
-- autenticado: el único freno era la RESTRICTIVE de negocio. Una vendedora,
-- llamando a la API directo, podía editar renglones de un remito, cambiar su
-- estado, borrar órdenes o reescribir el diccionario de alias. El botón
-- escondido no es control de acceso.
--
-- El corte:
--   * `ordenes_compra` y `ordenes_items`: LEER sigue abierto al negocio. Lo usa
--     el modal de gasto de caja (pago a proveedor, `resumen_remitos_financiero`,
--     INVOKER), que operan las vendedoras. Escribir/editar/borrar pide permiso.
--   * `ordenes_borradores` y `diccionario_alias`: todo pide permiso. Solo los
--     tocan la conciliación y la fusión de productos (ADMIN).
--   * `aprobar_orden_compra_impl` y `crear_productos_desde_remito` (INVOKER)
--     piden el permiso de entrada: con RLS sola, un llamado sin permiso a la
--     aprobación terminaba en un `ya_aprobada` engañoso (el UPDATE de la orden
--     no ve filas). Se reescriben desde el cuerpo VIVO con replace().
--
-- Quién lo tiene hoy (6/10/2026): todos los ADMIN (y `is_admin()` pasa igual);
-- ENCARGADO en 4 negocios. "Ingresar mercadería" la UI la ofrece solo al ADMIN,
-- así que nadie pierde algo que hoy use.
--
-- Reversión: supabase/reversals/20261006140000_ordenes_rls_por_permiso.sql

-- ---------------------------------------------------------------- policies
drop policy if exists "Manejo ordenes_compra" on public.ordenes_compra;
drop policy if exists "Permitir gestion de ordenes a staff" on public.ordenes_compra;
drop policy if exists "Manejo ordenes_items" on public.ordenes_items;
drop policy if exists "Permitir gestion de items a staff" on public.ordenes_items;
drop policy if exists "Manejo diccionario" on public.diccionario_alias;
drop policy if exists "Permitir gestion de diccionario a staff" on public.diccionario_alias;
drop policy if exists ordenes_borradores_select on public.ordenes_borradores;
drop policy if exists ordenes_borradores_insert on public.ordenes_borradores;
drop policy if exists ordenes_borradores_update on public.ordenes_borradores;
drop policy if exists ordenes_borradores_delete on public.ordenes_borradores;

-- ordenes_compra
create policy ordenes_compra_leer on public.ordenes_compra
  for select to authenticated using (true);
create policy ordenes_compra_insertar on public.ordenes_compra
  for insert to authenticated
  with check ((select public.tiene_permiso('stock.ingresar_remito')));
create policy ordenes_compra_editar on public.ordenes_compra
  for update to authenticated
  using ((select public.tiene_permiso('stock.ingresar_remito')))
  with check ((select public.tiene_permiso('stock.ingresar_remito')));
create policy ordenes_compra_borrar on public.ordenes_compra
  for delete to authenticated
  using ((select public.tiene_permiso('stock.ingresar_remito')));

-- ordenes_items
create policy ordenes_items_leer on public.ordenes_items
  for select to authenticated using (true);
create policy ordenes_items_insertar on public.ordenes_items
  for insert to authenticated
  with check ((select public.tiene_permiso('stock.ingresar_remito')));
create policy ordenes_items_editar on public.ordenes_items
  for update to authenticated
  using ((select public.tiene_permiso('stock.ingresar_remito')))
  with check ((select public.tiene_permiso('stock.ingresar_remito')));
create policy ordenes_items_borrar on public.ordenes_items
  for delete to authenticated
  using ((select public.tiene_permiso('stock.ingresar_remito')));

-- ordenes_borradores y diccionario_alias: todo con permiso
create policy ordenes_borradores_con_permiso on public.ordenes_borradores
  for all to authenticated
  using ((select public.tiene_permiso('stock.ingresar_remito')))
  with check ((select public.tiene_permiso('stock.ingresar_remito')));
create policy diccionario_alias_con_permiso on public.diccionario_alias
  for all to authenticated
  using ((select public.tiene_permiso('stock.ingresar_remito')))
  with check ((select public.tiene_permiso('stock.ingresar_remito')));

-- ---------------------------------------------------------------- RPC
do $mig$
declare
  v_def text;
  v_viejo text;
  v_nuevo text;
  v_veces int;
  v_permiso constant text := '
  -- Permiso de entrada (20261006140000): con RLS sola, un llamado sin permiso
  -- terminaba en un resultado engañoso en vez de en un error.
  if not (select public.tiene_permiso(''stock.ingresar_remito'')) then
    raise exception ''SIN_PERMISO: hace falta el permiso stock.ingresar_remito para ingresar mercaderia''
      using errcode = ''42501'';
  end if;
';
begin
  -- aprobar_orden_compra_impl
  select pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure)
    into v_def;
  if v_def like '%stock.ingresar_remito%' then
    raise exception 'aprobar_orden_compra_impl ya pide el permiso: ¿se corrió dos veces?';
  end if;
  v_viejo := 'begin
  -- GUARD DE LINEAS EXACTAS (20261006130000)';
  v_nuevo := 'begin' || v_permiso || '
  -- GUARD DE LINEAS EXACTAS (20261006130000)';
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_veces <> 1 then
    raise exception 'aprobar_orden_compra_impl: el ancla matchea % veces', v_veces;
  end if;
  execute replace(v_def, v_viejo, v_nuevo);

  -- crear_productos_desde_remito
  select pg_get_functiondef('public.crear_productos_desde_remito(uuid,jsonb)'::regprocedure)
    into v_def;
  if v_def like '%stock.ingresar_remito%' then
    raise exception 'crear_productos_desde_remito ya pide el permiso: ¿se corrió dos veces?';
  end if;
  v_viejo := 'begin
  perform 1 from ordenes_compra where id = p_orden_id for update;';
  v_nuevo := 'begin' || v_permiso || '
  perform 1 from ordenes_compra where id = p_orden_id for update;';
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_veces <> 1 then
    raise exception 'crear_productos_desde_remito: el ancla matchea % veces', v_veces;
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end
$mig$;

-- ---------------------------------------------------------------- guards
do $guard$
declare
  v_abiertas text;
  v_def text;
begin
  -- Ninguna policy de escritura abierta en las cuatro tablas.
  select string_agg(tablename || '.' || policyname, ', ')
    into v_abiertas
  from pg_policies
  where schemaname = 'public'
    and tablename in ('ordenes_compra', 'ordenes_items', 'ordenes_borradores', 'diccionario_alias')
    and permissive = 'PERMISSIVE'
    and cmd <> 'SELECT'
    and coalesce(qual, '') not like '%stock.ingresar_remito%'
    and coalesce(with_check, '') not like '%stock.ingresar_remito%';
  if v_abiertas is not null then
    raise exception 'Quedaron policies de escritura sin permiso: %', v_abiertas;
  end if;

  -- La RESTRICTIVE de negocio sigue en las cuatro.
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename in ('ordenes_compra', 'ordenes_items', 'ordenes_borradores', 'diccionario_alias')
         and permissive = 'RESTRICTIVE'
         and qual like '%current_negocio_id%') <> 4 then
    raise exception 'Falta la RESTRICTIVE de negocio en alguna de las cuatro tablas';
  end if;

  -- Las dos RPC piden el permiso y conservan lo crítico.
  select pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure) into v_def;
  if v_def not like '%stock.ingresar_remito%'
     or v_def not like '%REMITO_LINEAS_FALTANTES%'
     or v_def not like '%and estado <> ''APROBADA''%'
     or v_def not like '%insert into unidades_serie%' then
    raise exception 'aprobar_orden_compra_impl quedó sin el permiso o sin una salvaguarda';
  end if;
  select pg_get_functiondef('public.crear_productos_desde_remito(uuid,jsonb)'::regprocedure) into v_def;
  if v_def not like '%stock.ingresar_remito%'
     or v_def not like '%for update%' then
    raise exception 'crear_productos_desde_remito quedó sin el permiso o sin el lock';
  end if;
  if (select count(*) from pg_proc where proname in ('aprobar_orden_compra_impl', 'crear_productos_desde_remito')) <> 2 then
    raise exception 'Quedaron sobrecargas';
  end if;

  -- Ningún ADMIN se queda sin el permiso.
  if exists (
    select 1 from roles r
     where r.nombre = 'ADMIN'
       and not exists (
         select 1 from rol_permisos rp join permisos p on p.id = rp.permiso_id
          where rp.rol_id = r.id and p.clave = 'stock.ingresar_remito'
       )
  ) then
    raise exception 'Hay un rol ADMIN sin stock.ingresar_remito';
  end if;
end
$guard$;
