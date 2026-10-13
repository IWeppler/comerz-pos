-- Reversión de 20261013100000_notificaciones_base.sql.
-- Antes: sacar del código la campana (mis_notificaciones, notificaciones_sin_leer...).
drop trigger if exists trg_notificar_producto_agotado on public.movimientos_stock;
drop function if exists public._notificar_producto_agotado();
drop function if exists public.mis_notificaciones();
drop function if exists public.notificaciones_sin_leer();
drop function if exists public.marcar_notificaciones_leidas(text[]);
drop function if exists public.limpiar_notificaciones_leidas();
drop function if exists public._rol_recibe_notificacion(uuid, text, text);
drop function if exists public.categoria_notificacion(text);
drop table if exists public.notificaciones_leidas;
drop table if exists public.notificaciones;
alter table public.configuracion_pos drop column if exists notificaciones_roles;
