-- Reversión de 20261012190806_tienda_marcar_entregada.sql.
-- Las órdenes ENTREGADA vuelven a PAGADA antes de borrar las columnas.
update public.ordenes_tienda set estado = 'PAGADA' where estado = 'ENTREGADA';
drop function if exists public.marcar_orden_entregada(uuid, boolean);
alter table public.ordenes_tienda drop column entregada_en, drop column entregada_por;
