-- Vuelve a facturar siempre con modo ARCA.
delete from public.rol_permisos
 where permiso_id in (select id from public.permisos where clave = 'ventas.elegir_comprobante');
delete from public.permisos where clave = 'ventas.elegir_comprobante';
alter table public.configuracion_pos drop column if exists facturar_por_defecto;
