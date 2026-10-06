-- Reversión de 20261006140000_ordenes_rls_por_permiso.sql: vuelve a las
-- policies abiertas (cualquier autenticado del negocio escribe) y saca el
-- chequeo de permiso de las dos RPC. Ojo: reabre la escritura de remitos a
-- las vendedoras por API.

drop policy if exists ordenes_compra_leer on public.ordenes_compra;
drop policy if exists ordenes_compra_insertar on public.ordenes_compra;
drop policy if exists ordenes_compra_editar on public.ordenes_compra;
drop policy if exists ordenes_compra_borrar on public.ordenes_compra;
drop policy if exists ordenes_items_leer on public.ordenes_items;
drop policy if exists ordenes_items_insertar on public.ordenes_items;
drop policy if exists ordenes_items_editar on public.ordenes_items;
drop policy if exists ordenes_items_borrar on public.ordenes_items;
drop policy if exists ordenes_borradores_con_permiso on public.ordenes_borradores;
drop policy if exists diccionario_alias_con_permiso on public.diccionario_alias;

create policy "Manejo ordenes_compra" on public.ordenes_compra
  for all to public using (auth.role() = 'authenticated');
create policy "Permitir gestion de ordenes a staff" on public.ordenes_compra
  for all to authenticated using (true) with check (true);
create policy "Manejo ordenes_items" on public.ordenes_items
  for all to public using (auth.role() = 'authenticated');
create policy "Permitir gestion de items a staff" on public.ordenes_items
  for all to authenticated using (true) with check (true);
create policy "Manejo diccionario" on public.diccionario_alias
  for all to public using (auth.role() = 'authenticated');
create policy "Permitir gestion de diccionario a staff" on public.diccionario_alias
  for all to authenticated using (true) with check (true);
create policy ordenes_borradores_select on public.ordenes_borradores
  for select to authenticated using (true);
create policy ordenes_borradores_insert on public.ordenes_borradores
  for insert to authenticated with check (true);
create policy ordenes_borradores_update on public.ordenes_borradores
  for update to authenticated using (true) with check (true);
create policy ordenes_borradores_delete on public.ordenes_borradores
  for delete to authenticated using (true);

do $rev$
declare
  v_def text;
  v_bloque constant text := '
  -- Permiso de entrada (20261006140000): con RLS sola, un llamado sin permiso
  -- terminaba en un resultado engañoso en vez de en un error.
  if not (select public.tiene_permiso(''stock.ingresar_remito'')) then
    raise exception ''SIN_PERMISO: hace falta el permiso stock.ingresar_remito para ingresar mercaderia''
      using errcode = ''42501'';
  end if;
';
begin
  select pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure) into v_def;
  if position(v_bloque in v_def) = 0 then
    raise exception 'aprobar_orden_compra_impl no tiene el bloque de permiso esperado';
  end if;
  execute replace(v_def, v_bloque, '');

  select pg_get_functiondef('public.crear_productos_desde_remito(uuid,jsonb)'::regprocedure) into v_def;
  if position(v_bloque in v_def) = 0 then
    raise exception 'crear_productos_desde_remito no tiene el bloque de permiso esperado';
  end if;
  execute replace(v_def, v_bloque, '');
end
$rev$;
