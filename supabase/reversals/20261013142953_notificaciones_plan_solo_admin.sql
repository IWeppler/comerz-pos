-- Reversión de 20261013142953_notificaciones_plan_solo_admin.sql (correr a mano).
-- Desde el cuerpo vivo, los dos reemplazos al revés.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public._rol_recibe_notificacion(uuid,text,text)'::regprocedure);
  execute replace(v_def, E'p_categoria <> ''PLAN'' or p_rol = ''ADMIN'')', 'true)');
  v_def := pg_get_functiondef('public._estados_notificaciones(uuid)'::regprocedure);
  execute replace(v_def, $q$ and coalesce(ng.precio_acordado, -1) <> 0$q$, '');
end $$;
