-- Reversión de 20261013145823_notificaciones_config_roles.sql (correr a mano).
-- La configuración que hayan guardado los comercios queda en
-- configuracion_pos.notificaciones_roles y se sigue aplicando (N1); para volver a
-- los defaults: update public.configuracion_pos set notificaciones_roles = null;
drop function if exists public.guardar_notificaciones_roles(jsonb);
drop function if exists public.notificaciones_roles_efectivos();
