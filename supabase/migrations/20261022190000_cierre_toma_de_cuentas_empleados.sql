-- Cierra la toma de cuentas por "Empleados y permisos" (auditoría de seguridad
-- del 22/10/2026, hallazgo 1, crítico).
--
-- El agujero, en dos pasos que por separado parecían razonables:
--  1. `alta_empleado_local(p_usuario_id, ...)` es SECURITY DEFINER y se puede
--     llamar directo por PostgREST. Solo exigía que quien llama fuera ADMIN y que
--     la cuenta destino no tuviera negocio: sumaba CUALQUIER cuenta existente al
--     negocio del atacante. Cualquiera es ADMIN de su propio comercio con el alta
--     self-service.
--  2. `editarEmpleadoAction` le cambia mail y contraseña con service_role a todo
--     miembro sin otras membresías (`otras_membresias = 0`).
-- El super admin no tiene membresías y su UUID figura en `movimientos_stock` y
-- `turnos_caja` de 4 comercios (lo que hizo con Modo Dios): el admin de
-- cualquiera de ellos podía ponerle contraseña y entrar como super admin.
-- Verificado en seco el 22/10 como ADMIN del Kiosco Demo (transacción revertida):
-- las dos RPC aceptaban al super admin y devolvían `otras_membresias = 0`.
-- La invitación era una segunda puerta: el ADMIN inserta una invitación al mail de
-- una cuenta sin negocio y el login la acepta solo (`aceptar_invitaciones_
-- pendientes`); después, el paso 2.
--
-- Qué cambia:
--  - `alta_empleado_local` solo acepta la cuenta que `crearEmpleadoLocalAction`
--    acaba de crear: creada hace menos de 10 minutos y sin ningún inicio de
--    sesión. Nunca al super admin. → USUARIO_NO_ELEGIBLE.
--  - `editar_empleado` devuelve `gestiona_acceso`: el negocio maneja mail y
--    contraseña SOLO de las cuentas que creó en el mostrador. Quedan afuera la
--    que trabaja en otro negocio (como antes), la del super admin, la de un dueño
--    (`es_owner`), la que se sumó por invitación (ACEPTADA a su mail: la cuenta es
--    de la persona) y la que tiene otro proveedor (Google). El mail del perfil y
--    el cierre de sesiones siguen el mismo criterio. `otras_membresias` se
--    mantiene para el código desplegado.
--    Impacto medido el 22/10: solo 2 cuentas invitadas del Kiosco Demo dejan de
--    ser gestionables; ninguna de un comercio real.
--  - `aceptar_invitacion` / `aceptar_invitaciones_pendientes` no suman al super
--    admin a ningún negocio.
--  - Las tres RPC de empleados dejan de ser ejecutables por `anon`.
--
-- Se reescribe desde el cuerpo VIVO (`pg_get_functiondef`) con reemplazos que
-- tienen que matchear exactamente una vez.
-- Reversión: supabase/reversals/20261022190000_cierre_toma_de_cuentas_empleados.sql

begin;

create function pg_temp.reemplazar_uno(p_def text, p_viejo text, p_nuevo text, p_donde text)
returns text
language plpgsql
as $$
declare
  v_veces int := (length(p_def) - length(replace(p_def, p_viejo, ''))) / length(p_viejo);
begin
  if v_veces <> 1 then
    raise exception '%: el fragmento aparece % veces (se esperaba 1): %', p_donde, v_veces, p_viejo;
  end if;
  return replace(p_def, p_viejo, p_nuevo);
end $$;

-- 1. alta_empleado_local: solo la cuenta recién creada por el alta del mostrador.
do $$
declare
  d text := pg_get_functiondef('public.alta_empleado_local(uuid, uuid, text, text)'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'    raise exception ''USUARIO_YA_TIENE_NEGOCIO'';\n  end if;\n',
    E'    raise exception ''USUARIO_YA_TIENE_NEGOCIO'';\n  end if;\n'
    || E'  -- Solo la cuenta que crearEmpleadoLocalAction acaba de crear con service_role:\n'
    || E'  -- reciente y sin ningún inicio de sesión. Una cuenta existente (o el super\n'
    || E'  -- admin, que no tiene membresías) no se suma desde acá: eso es invitar.\n'
    || E'  if security.es_super_admin(p_usuario_id) or not exists (\n'
    || E'    select 1 from auth.users u\n'
    || E'     where u.id = p_usuario_id\n'
    || E'       and u.created_at > now() - interval ''10 minutes''\n'
    || E'       and u.last_sign_in_at is null\n'
    || E'  ) then\n'
    || E'    raise exception ''USUARIO_NO_ELEGIBLE'' using errcode = ''42501'';\n'
    || E'  end if;\n',
    'alta_empleado_local');
  execute d;
end $$;

-- 2. editar_empleado: `gestiona_acceso` decide mail, contraseña y cierre de sesiones.
do $$
declare
  d text := pg_get_functiondef('public.editar_empleado(uuid, text, text, uuid, boolean)'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'  v_rol_actual uuid;\nbegin\n',
    E'  v_rol_actual uuid;\n  v_gestiona  boolean;\nbegin\n',
    'editar_empleado declare');
  d := pg_temp.reemplazar_uno(d,
    E'   where usuario_id = p_usuario_id and negocio_id <> v_negocio;\n',
    E'   where usuario_id = p_usuario_id and negocio_id <> v_negocio;\n'
    || E'\n'
    || E'  -- El negocio maneja mail y contraseña solo de las cuentas que creó en el\n'
    || E'  -- mostrador. La que se sumó por invitación, la de un dueño, la que entra\n'
    || E'  -- con Google o la del super admin es de la persona: cambiarle la clave\n'
    || E'  -- sería quedarse con su cuenta.\n'
    || E'  v_gestiona := v_otras = 0\n'
    || E'    and not security.es_super_admin(p_usuario_id)\n'
    || E'    and not exists (select 1 from public.usuarios_negocios o\n'
    || E'                     where o.usuario_id = p_usuario_id and o.es_owner)\n'
    || E'    and not exists (select 1 from auth.users u\n'
    || E'                      join public.invitaciones i on lower(i.email) = lower(u.email)\n'
    || E'                     where u.id = p_usuario_id and i.estado = ''ACEPTADA'')\n'
    || E'    and not exists (select 1 from auth.identities ai\n'
    || E'                     where ai.user_id = p_usuario_id and ai.provider <> ''email'');\n',
    'editar_empleado gestiona');
  d := pg_temp.reemplazar_uno(d,
    'case when v_otras = 0 and nullif',
    'case when v_gestiona and nullif',
    'editar_empleado mail del perfil');
  d := pg_temp.reemplazar_uno(d,
    'if p_cerrar_sesiones and v_otras = 0 then',
    'if p_cerrar_sesiones and v_gestiona then',
    'editar_empleado cerrar sesiones');
  d := pg_temp.reemplazar_uno(d,
    E'return jsonb_build_object(''otras_membresias'', v_otras);',
    E'return jsonb_build_object(''otras_membresias'', v_otras, ''gestiona_acceso'', v_gestiona);',
    'editar_empleado retorno');
  execute d;
end $$;

-- 3. Las invitaciones no suman al super admin a un negocio.
do $$
declare
  d text := pg_get_functiondef('public.aceptar_invitaciones_pendientes()'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'  if v_user is null then\n    return null;\n  end if;\n',
    E'  if v_user is null then\n    return null;\n  end if;\n'
    || E'\n'
    || E'  -- El super admin no pertenece a ningún negocio: entra con Modo Dios.\n'
    || E'  if security.es_super_admin(v_user) then\n'
    || E'    return null;\n'
    || E'  end if;\n',
    'aceptar_invitaciones_pendientes');
  execute d;
end $$;

do $$
declare
  d text := pg_get_functiondef('public.aceptar_invitacion(uuid)'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'        RAISE EXCEPTION ''Hay que iniciar sesión para aceptar una invitación'';\n    END IF;\n',
    E'        RAISE EXCEPTION ''Hay que iniciar sesión para aceptar una invitación'';\n    END IF;\n'
    || E'\n'
    || E'    -- El super admin no pertenece a ningún negocio: entra con Modo Dios.\n'
    || E'    IF security.es_super_admin(v_user) THEN\n'
    || E'        RAISE EXCEPTION ''Invitación inválida, vencida o de otro email'';\n'
    || E'    END IF;\n',
    'aceptar_invitacion');
  execute d;
end $$;

-- 4. Las RPC de empleados piden sesión: anon no las ejecuta.
revoke execute on function public.alta_empleado_local(uuid, uuid, text, text) from public, anon;
revoke execute on function public.editar_empleado(uuid, text, text, uuid, boolean) from public, anon;
revoke execute on function public.quitar_empleado(uuid) from public, anon;
grant execute on function public.alta_empleado_local(uuid, uuid, text, text) to authenticated;
grant execute on function public.editar_empleado(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.quitar_empleado(uuid) to authenticated;

do $guard$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('alta_empleado_local',             'public.alta_empleado_local(uuid, uuid, text, text)',             'USUARIO_NO_ELEGIBLE'),
      ('editar_empleado',                 'public.editar_empleado(uuid, text, text, uuid, boolean)',        'gestiona_acceso'),
      ('aceptar_invitaciones_pendientes', 'public.aceptar_invitaciones_pendientes()',                       'es_super_admin(v_user)'),
      ('aceptar_invitacion',              'public.aceptar_invitacion(uuid)',                                'es_super_admin(v_user)')
    ) as t(nombre, firma, marca)
  loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.nombre) <> 1 then
      raise exception '%: se esperaba una sola versión', r.nombre;
    end if;
    if not (select prosecdef from pg_proc where oid = r.firma::regprocedure) then
      raise exception '%: dejó de ser SECURITY DEFINER', r.nombre;
    end if;
    v_def := pg_get_functiondef(r.firma::regprocedure);
    if position(r.marca in v_def) = 0 then
      raise exception '%: falta el cambio (%)', r.nombre, r.marca;
    end if;
  end loop;

  -- Lo que ya protegía sigue ahí.
  if position('public.is_admin()' in pg_get_functiondef('public.alta_empleado_local(uuid, uuid, text, text)'::regprocedure)) = 0
     or position('public.is_admin()' in pg_get_functiondef('public.editar_empleado(uuid, text, text, uuid, boolean)'::regprocedure)) = 0 then
    raise exception 'alta/editar empleado perdieron el chequeo de ADMIN';
  end if;
  if position('lower(email) = lower(v_email)' in pg_get_functiondef('public.aceptar_invitacion(uuid)'::regprocedure)) = 0 then
    raise exception 'aceptar_invitacion perdió el chequeo de mail';
  end if;
  if position('v_otras = 0' in pg_get_functiondef('public.editar_empleado(uuid, text, text, uuid, boolean)'::regprocedure)) = 0 then
    raise exception 'editar_empleado perdió el corte por otras membresías';
  end if;

  if has_function_privilege('anon', 'public.alta_empleado_local(uuid, uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.editar_empleado(uuid, text, text, uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.quitar_empleado(uuid)', 'EXECUTE') then
    raise exception 'anon sigue ejecutando una RPC de empleados';
  end if;
  if not has_function_privilege('authenticated', 'public.alta_empleado_local(uuid, uuid, text, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.editar_empleado(uuid, text, text, uuid, boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.quitar_empleado(uuid)', 'EXECUTE') then
    raise exception 'authenticated perdió una RPC de empleados';
  end if;
  if has_function_privilege('authenticated', 'public.cerrar_sesiones_usuario(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cerrar_sesiones_usuario(uuid)', 'EXECUTE') then
    raise exception 'cerrar_sesiones_usuario es ejecutable desde la API';
  end if;
end $guard$;

commit;
