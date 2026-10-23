-- Reversión de 20261022190000_cierre_toma_de_cuentas_empleados.sql.
--
-- OJO: deshacer esto REABRE la toma de cuentas (un ADMIN suma la cuenta del
-- super admin con `alta_empleado_local` y le pone contraseña desde Editar
-- empleado). Solo tiene sentido si la migración rompió el alta de empleados y
-- hay que volver mientras se corrige; en ese caso, revertir también
-- features/config/actions/editar-empleado.ts no hace falta (sin
-- `gestiona_acceso` el código no toca Auth: falla cerrado).
--
-- Mismo mecanismo que la migración: reemplazos sobre el cuerpo vivo que tienen
-- que matchear exactamente una vez.

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

do $$
declare
  d text := pg_get_functiondef('public.alta_empleado_local(uuid, uuid, text, text)'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'  -- Solo la cuenta que crearEmpleadoLocalAction acaba de crear con service_role:\n'
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
    '',
    'alta_empleado_local');
  execute d;
end $$;

do $$
declare
  d text := pg_get_functiondef('public.editar_empleado(uuid, text, text, uuid, boolean)'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'  v_rol_actual uuid;\n  v_gestiona  boolean;\nbegin\n',
    E'  v_rol_actual uuid;\nbegin\n',
    'editar_empleado declare');
  d := pg_temp.reemplazar_uno(d,
    E'\n'
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
    '',
    'editar_empleado gestiona');
  d := pg_temp.reemplazar_uno(d,
    'case when v_gestiona and nullif',
    'case when v_otras = 0 and nullif',
    'editar_empleado mail del perfil');
  d := pg_temp.reemplazar_uno(d,
    'if p_cerrar_sesiones and v_gestiona then',
    'if p_cerrar_sesiones and v_otras = 0 then',
    'editar_empleado cerrar sesiones');
  d := pg_temp.reemplazar_uno(d,
    E'return jsonb_build_object(''otras_membresias'', v_otras, ''gestiona_acceso'', v_gestiona);',
    E'return jsonb_build_object(''otras_membresias'', v_otras);',
    'editar_empleado retorno');
  execute d;
end $$;

do $$
declare
  d text := pg_get_functiondef('public.aceptar_invitaciones_pendientes()'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'\n'
    || E'  -- El super admin no pertenece a ningún negocio: entra con Modo Dios.\n'
    || E'  if security.es_super_admin(v_user) then\n'
    || E'    return null;\n'
    || E'  end if;\n',
    '',
    'aceptar_invitaciones_pendientes');
  execute d;
end $$;

do $$
declare
  d text := pg_get_functiondef('public.aceptar_invitacion(uuid)'::regprocedure);
begin
  d := pg_temp.reemplazar_uno(d,
    E'\n'
    || E'    -- El super admin no pertenece a ningún negocio: entra con Modo Dios.\n'
    || E'    IF security.es_super_admin(v_user) THEN\n'
    || E'        RAISE EXCEPTION ''Invitación inválida, vencida o de otro email'';\n'
    || E'    END IF;\n',
    '',
    'aceptar_invitacion');
  execute d;
end $$;

-- Los REVOKE a anon no se deshacen: las tres RPC exigen sesión y anon nunca
-- las pudo usar.

do $guard$
begin
  if position('USUARIO_NO_ELEGIBLE' in pg_get_functiondef('public.alta_empleado_local(uuid, uuid, text, text)'::regprocedure)) > 0
     or position('gestiona_acceso' in pg_get_functiondef('public.editar_empleado(uuid, text, text, uuid, boolean)'::regprocedure)) > 0
     or position('es_super_admin(v_user)' in pg_get_functiondef('public.aceptar_invitaciones_pendientes()'::regprocedure)) > 0
     or position('es_super_admin(v_user)' in pg_get_functiondef('public.aceptar_invitacion(uuid)'::regprocedure)) > 0 then
    raise exception 'la reversión no quedó completa';
  end if;
end $guard$;

commit;
