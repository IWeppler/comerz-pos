-- Reversa de 20260918120000_producto_presentaciones.
--
-- Deja `ventas_items` sin las columnas nuevas. Si ya hay renglones vendidos
-- por presentación, `cantidad` sigue en unidad base y no se pierde nada del
-- stock ni de los totales: lo que se pierde es saber QUÉ presentación fue.

alter table public.ventas_items
  drop constraint if exists ventas_items_serie_sin_presentacion,
  drop constraint if exists ventas_items_presentacion_coherente,
  drop constraint if exists ventas_items_factor_positivo;

alter table public.ventas_items
  drop column if exists precio_presentacion,
  drop column if exists cantidad_presentacion,
  drop column if exists factor,
  drop column if exists presentacion_nombre,
  drop column if exists presentacion_id;

drop function if exists public.cantidad_base(numeric, numeric);

drop trigger if exists trg_producto_presentaciones_tocar_producto on public.producto_presentaciones;
drop function if exists public.producto_presentaciones_tocar_producto();
drop trigger if exists trg_producto_presentaciones_validar on public.producto_presentaciones;
drop function if exists public.producto_presentaciones_validar();

drop table if exists public.producto_presentaciones;
