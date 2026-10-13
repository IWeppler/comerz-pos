-- Notificaciones: ajustes de plan decididos por Nacho el 13/10/2026.
--   1. Los avisos de PLAN (vencimiento, prueba, débito cobrado) llegan por default
--      SOLO al ADMIN: la facturación es de la dueña. Con configuración explícita
--      (`configuracion_pos.notificaciones_roles`, N6) manda lo configurado.
--   2. Un negocio con precio acordado $0 no recibe avisos de vencimiento: no hay
--      nada que pagar (Ninja Camisetas).
-- Reescritura desde el cuerpo VIVO (`pg_get_functiondef` + `replace`), cada
-- reemplazo con guard de que matchea exactamente una vez.
-- Reversión: supabase/reversals/20261013142953_notificaciones_plan_solo_admin.sql

do $$
declare
  v_def text;
  v_viejo text;
  v_nuevo text;
begin
  -- 1. Default por categoría: PLAN solo ADMIN.
  v_def := pg_get_functiondef('public._rol_recibe_notificacion(uuid,text,text)'::regprocedure);
  -- Sin el salto de línea entero: la N1 se aplicó a mano desde Windows y el cuerpo
  -- vivo tiene CRLF; "\n" + la indentación matchea igual (el \r queda antes).
  v_viejo := E'\n    true)';
  v_nuevo := E'\n    p_categoria <> ''PLAN'' or p_rol = ''ADMIN'')';
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'PLAN_SOLO_ADMIN: el default de _rol_recibe_notificacion no matchea una vez';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);

  -- 2. Sin avisos de vencimiento con precio acordado $0.
  v_def := pg_get_functiondef('public._estados_notificaciones(uuid)'::regprocedure);
  v_viejo := $q$and ng.estado in ('prueba', 'activo')$q$;
  v_nuevo := $q$and ng.estado in ('prueba', 'activo') and coalesce(ng.precio_acordado, -1) <> 0$q$;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'PLAN_SOLO_ADMIN: el filtro de estados no matchea una vez';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;

comment on column public.configuracion_pos.notificaciones_roles is
  'Qué categoría de aviso recibe cada rol: {"STOCK":["ADMIN","ENCARGADO"],"TIENDA":[...],"PLAN":[...],"PLATA":[...]}. Sin la categoría: ADMIN y ENCARGADO, salvo PLAN que es solo ADMIN.';

do $$
declare n uuid;
begin
  if not public._rol_recibe_notificacion(gen_random_uuid(), 'ADMIN', 'PLAN')
     or public._rol_recibe_notificacion(gen_random_uuid(), 'ENCARGADO', 'PLAN')
     or not public._rol_recibe_notificacion(gen_random_uuid(), 'ENCARGADO', 'STOCK')
     or public._rol_recibe_notificacion(gen_random_uuid(), 'VENDEDOR', 'STOCK')
     or not (select prosecdef from pg_proc where oid = 'public._rol_recibe_notificacion(uuid,text,text)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public._estados_notificaciones(uuid)'::regprocedure)
     or has_function_privilege('authenticated', 'public._estados_notificaciones(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._rol_recibe_notificacion(uuid,text,text)', 'EXECUTE') then
    raise exception 'PLAN_SOLO_ADMIN_GUARD';
  end if;
  -- Ninja Camisetas ($0) ya no tiene aviso de plan.
  select id into n from public.negocios where precio_acordado = 0 limit 1;
  if n is not null and exists (select 1 from public._estados_notificaciones(n) e where e.tipo like 'PLAN_%') then
    raise exception 'PLAN_SOLO_ADMIN_GUARD: precio $0 sigue avisando';
  end if;
end $$;
