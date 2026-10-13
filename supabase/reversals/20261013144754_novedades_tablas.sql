-- Reversión de N5 (20261013144754_novedades_tablas + 20261013144814_novedades_lectura).
-- Correr a mano, en este orden y en UNA transacción:
--   1. Reponer mis_notificaciones, notificaciones_sin_leer y marcar_notificaciones_leidas
--      de N3 / N1 (supabase/migrations/20261013142607_notificaciones_estados.sql y
--      20261013100000_notificaciones_base.sql): sin eso fallan al no existir
--      _novedades_para / novedades_vistas.
--   2. Lo de abajo.
drop function if exists public.eliminar_novedad(uuid);
drop function if exists public.guardar_novedad(uuid, text, text, text, boolean);
drop function if exists public.novedades_admin();
drop function if exists public._novedades_para(uuid);
drop table if exists public.novedades_vistas;
drop table if exists public.novedades;
