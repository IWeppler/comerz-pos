-- Editar y quitar empleados desde Empleados y Permisos.
--
-- Casos reales: le robaron el celular (hay que cerrarle la sesión y cambiar
-- la clave), se olvidó la contraseña, o el mail quedó puesto de apuro
-- ("vendedora1@gmail.com") y hay que corregirlo.
--
-- Dos funciones SECURITY DEFINER, acotadas igual que `alta_empleado_local`:
-- `is_admin()` sobre el negocio activo, y el usuario tiene que ser MIEMBRO
-- de ese negocio. Devuelven cuántas OTRAS membresías tiene el usuario,
-- porque de eso depende lo que el server puede tocar en Auth:
--
--   * Con otras membresías, la cuenta es compartida con otro negocio: acá
--     se edita nombre y rol, pero NO el mail ni la contraseña (sería
--     cambiarle la clave a alguien que también trabaja en otro lado).
--   * Sin otras, la cuenta existe solo para este negocio y el admin puede
--     cambiarle mail y clave.
--
-- QUITAR NO BORRA LA CUENTA. `ventas.vendedor_id` referencia `perfiles` con
-- ON DELETE SET NULL, y `perfiles` cae en cascada con `auth.users`: borrar la
-- cuenta dejaría todas sus ventas sin vendedora en el historial y en los
-- reportes. Se saca la membresía y se cierran sus sesiones; sin negocio no
-- puede entrar a nada, y su nombre sigue en cada venta que hizo.
--
-- Las sesiones se cierran desde acá (auth.sessions / auth.refresh_tokens)
-- porque el server no tiene una llamada de Auth para "cerrar todo de un
-- usuario". Es lo que hace útil el cambio de clave cuando el teléfono está
-- en otras manos: sin esto la sesión vieja seguiría andando hasta vencer.

create or replace function public.cerrar_sesiones_usuario(p_usuario_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_filas integer;
begin
  -- Solo la llaman las dos funciones de abajo, que ya validaron. No se
  -- concede a authenticated.
  delete from auth.refresh_tokens where user_id = p_usuario_id::text;
  delete from auth.sessions where user_id = p_usuario_id;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$function$;

revoke all on function public.cerrar_sesiones_usuario(uuid) from public, authenticated, anon;

create or replace function public.editar_empleado(
  p_usuario_id uuid,
  p_nombre text,
  p_email text,
  p_rol_id uuid,
  p_cerrar_sesiones boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_negocio   uuid := security.current_negocio_id();
  v_rol       text;
  v_rol_admin uuid;
  v_otras     integer;
  v_admins    integer;
  v_rol_actual uuid;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select rol_id into v_rol_actual
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id = v_negocio;
  if v_rol_actual is null then
    raise exception 'NO_ES_MIEMBRO';
  end if;

  select case when r.nombre = 'ENCARGADO' then 'VENDEDOR' else r.nombre end
    into v_rol
    from public.roles r
   where r.id = p_rol_id and r.negocio_id = v_negocio;
  if v_rol is null then
    raise exception 'ROL_INVALIDO';
  end if;

  -- Último admin: no se le puede bajar el rol.
  select id into v_rol_admin from public.roles where negocio_id = v_negocio and nombre = 'ADMIN';
  if v_rol_actual = v_rol_admin and p_rol_id <> v_rol_admin then
    select count(*) into v_admins
      from public.usuarios_negocios
     where negocio_id = v_negocio and rol_id = v_rol_admin;
    if v_admins <= 1 then
      raise exception 'ULTIMO_ADMIN';
    end if;
  end if;

  select count(*) into v_otras
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id <> v_negocio;

  update public.perfiles
     set nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
         -- El mail solo si la cuenta es de este negocio nada más.
         email  = case when v_otras = 0 and nullif(trim(p_email), '') is not null
                       then lower(trim(p_email)) else email end
   where id = p_usuario_id;

  update public.usuarios_negocios
     set rol_id = p_rol_id, rol = v_rol
   where usuario_id = p_usuario_id and negocio_id = v_negocio;

  if p_cerrar_sesiones and v_otras = 0 then
    perform public.cerrar_sesiones_usuario(p_usuario_id);
  end if;

  return jsonb_build_object('otras_membresias', v_otras);
end;
$function$;

grant execute on function public.editar_empleado(uuid, text, text, uuid, boolean) to authenticated;

create or replace function public.quitar_empleado(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_negocio   uuid := security.current_negocio_id();
  v_rol_admin uuid;
  v_rol_actual uuid;
  v_admins    integer;
  v_otras     integer;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'NO_A_SI_MISMO';
  end if;

  select rol_id into v_rol_actual
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id = v_negocio;
  if v_rol_actual is null then
    raise exception 'NO_ES_MIEMBRO';
  end if;

  select id into v_rol_admin from public.roles where negocio_id = v_negocio and nombre = 'ADMIN';
  if v_rol_actual = v_rol_admin then
    select count(*) into v_admins
      from public.usuarios_negocios
     where negocio_id = v_negocio and rol_id = v_rol_admin;
    if v_admins <= 1 then
      raise exception 'ULTIMO_ADMIN';
    end if;
  end if;

  select count(*) into v_otras
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id <> v_negocio;

  -- Las sesiones se cierran solo si la cuenta era de este negocio nada más:
  -- si trabaja en otro, ese otro no tiene por qué perder la sesión.
  if v_otras = 0 then
    perform public.cerrar_sesiones_usuario(p_usuario_id);
  end if;

  delete from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id = v_negocio;

  return jsonb_build_object('otras_membresias', v_otras);
end;
$function$;

grant execute on function public.quitar_empleado(uuid) to authenticated;

comment on function public.quitar_empleado(uuid) is
  'Saca la membresia del negocio activo y cierra sesiones si era su unico negocio. NO borra la cuenta: perfiles cae en cascada con auth.users y ventas.vendedor_id quedaria en null.';
