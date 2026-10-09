-- Sólo después de retirar el código que lee precios_por_cantidad.
-- No modifica ventas históricas. Exportar la configuración si se desea conservarla.
begin;
drop trigger productos_permiso_tramos_cantidad on public.productos;
drop function security.validar_permiso_tramos_cantidad();
alter table public.productos drop column precios_por_cantidad;
drop function public.precios_por_cantidad_validos(jsonb);
notify pgrst, 'reload schema';
commit;
