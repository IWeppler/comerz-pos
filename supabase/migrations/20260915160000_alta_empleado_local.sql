-- Alta de empleado con contraseña, sin invitación por mail.
--
-- El flujo de invitar (mail + link + la persona crea su clave) es correcto
-- para quien tiene casilla y la mira. En un local, la dueña muchas veces
-- quiere dar de alta a la vendedora ahí mismo: nombre, correo, contraseña,
-- rol, listo. El usuario en Auth lo crea el server con service_role
-- (`auth.admin.createUser`); ESTA función hace lo que falta del lado de la
-- app: el perfil y la membresía en el negocio activo.
--
-- SECURITY DEFINER porque escribe el perfil de OTRO usuario (la RLS de
-- `perfiles` deja tocar solo el propio). Lo acota:
--   * `is_admin()` del que llama, sobre el negocio activo.
--   * Solo se puede dar de alta a un usuario que NO tenga ninguna membresía
--     todavía: es un usuario recién creado para este negocio. Si ya está en
--     algún negocio, es la cuenta de otra persona y acá no se toca — para
--     eso está invitar.
--   * El trigger `trg_limite_usuarios` corre igual (el tope del plan se
--     respeta), con `current_negocio_id()` del admin que llama.

create or replace function public.alta_empleado_local(
  p_usuario_id uuid,
  p_rol_id uuid,
  p_nombre text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_rol     text;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_usuario_id) then
    raise exception 'USUARIO_NO_EXISTE';
  end if;
  if exists (select 1 from public.usuarios_negocios where usuario_id = p_usuario_id) then
    raise exception 'USUARIO_YA_TIENE_NEGOCIO';
  end if;

  select case when r.nombre = 'ENCARGADO' then 'VENDEDOR' else r.nombre end
    into v_rol
    from public.roles r
   where r.id = p_rol_id and r.negocio_id = v_negocio;
  if v_rol is null then
    raise exception 'ROL_INVALIDO';
  end if;

  -- Si un trigger de auth ya creó el perfil, se le pone el nombre que cargó
  -- la dueña; si no, se crea. El nombre nunca queda vacío: cae al mail.
  insert into public.perfiles (id, email, nombre)
  values (
    p_usuario_id,
    lower(p_email),
    coalesce(nullif(trim(p_nombre), ''), split_part(lower(p_email), '@', 1))
  )
  on conflict (id) do update
    set nombre = coalesce(nullif(trim(p_nombre), ''), public.perfiles.nombre),
        email  = lower(p_email);

  insert into public.usuarios_negocios (usuario_id, negocio_id, rol_id, rol)
  values (p_usuario_id, v_negocio, p_rol_id, v_rol);

  return v_negocio;
end;
$function$;

comment on function public.alta_empleado_local(uuid, uuid, text, text) is
  'Perfil + membresia para un usuario recien creado por el admin con contrasena (sin invitacion). SECURITY DEFINER acotado: is_admin(), usuario sin ninguna membresia previa, rol del negocio activo. El tope del plan lo sigue aplicando el trigger.';

grant execute on function public.alta_empleado_local(uuid, uuid, text, text) to authenticated;
