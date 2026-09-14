-- Saca el permiso caja.operar. configurar_pedidos_a_caja vuelve a la versión
-- de 20260915130000 (solo ventas.cobrar) reaplicando esa migración.
delete from public.rol_permisos
 where permiso_id in (select id from public.permisos where clave = 'caja.operar');
delete from public.permisos where clave = 'caja.operar';
