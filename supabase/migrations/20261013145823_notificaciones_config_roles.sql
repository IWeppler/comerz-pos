-- Notificaciones, N6: Configuración › Notificaciones (docs/notificaciones.md). El ADMIN
-- elige qué categoría de aviso de "Tu negocio" recibe cada rol (ADMIN, ENCARGADO). Las
-- vendedoras no reciben avisos del negocio (no es configurable) y las Novedades son
-- para todos.
--
--   1. `notificaciones_roles_efectivos()`: la matriz categoría × rol tal como se aplica,
--      con los defaults ya resueltos. La calcula `_rol_recibe_notificacion`, la MISMA
--      función que decide quién recibe: no hay un segundo lugar que conozca los defaults.
--   2. `guardar_notificaciones_roles(jsonb)`: escribe `configuracion_pos.notificaciones_roles`.
--      Exige las cuatro categorías y solo ADMIN / ENCARGADO como valores; falla con nombre
--      si la forma no es esa, en vez de guardar a medias.
--   Las dos: solo ADMIN, negocio filtrado a mano (SECURITY DEFINER).
-- Reversión: supabase/reversals/20261013145823_notificaciones_config_roles.sql

create or replace function public.notificaciones_roles_efectivos()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null or public.rol_actual() is distinct from 'ADMIN' then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return (
    select jsonb_object_agg(c, jsonb_build_object(
             'ADMIN', public._rol_recibe_notificacion(v_negocio, 'ADMIN', c),
             'ENCARGADO', public._rol_recibe_notificacion(v_negocio, 'ENCARGADO', c)))
      from unnest(array['STOCK', 'TIENDA', 'PLAN', 'PLATA']) c);
end $$;

create or replace function public.guardar_notificaciones_roles(p_roles jsonb)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_filas int;
begin
  if v_negocio is null or public.rol_actual() is distinct from 'ADMIN' then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if jsonb_typeof(p_roles) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_roles) k)
          is distinct from array['PLAN', 'PLATA', 'STOCK', 'TIENDA']
     or exists (select 1 from jsonb_each(p_roles) e where jsonb_typeof(e.value) <> 'array')
     or exists (select 1 from jsonb_each(p_roles) e, jsonb_array_elements(e.value) r
                 where jsonb_typeof(r) <> 'string' or r #>> '{}' not in ('ADMIN', 'ENCARGADO')) then
    raise exception 'NOTIFICACIONES_ROLES_INVALIDOS: %', p_roles;
  end if;

  update public.configuracion_pos
     set notificaciones_roles = p_roles
   where negocio_id = v_negocio;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'NOTIFICACIONES_SIN_CONFIGURACION';
  end if;
end $$;

revoke all on function public.notificaciones_roles_efectivos() from public, anon;
revoke all on function public.guardar_notificaciones_roles(jsonb) from public, anon;
grant execute on function public.notificaciones_roles_efectivos() to authenticated;
grant execute on function public.guardar_notificaciones_roles(jsonb) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.guardar_notificaciones_roles(jsonb)', 'EXECUTE')
    or not (select prosecdef from pg_proc where oid = 'public.guardar_notificaciones_roles(jsonb)'::regprocedure) then
    raise exception 'NOTIFICACIONES_N6_GUARD';
  end if;
end $$;
