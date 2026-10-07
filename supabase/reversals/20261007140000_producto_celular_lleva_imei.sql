-- Reversión de 20261007140000_producto_celular_lleva_imei.sql. A MANO.
-- Los productos marcados por el backfill o por el trigger QUEDAN marcados:
-- apagarlos haría que el POS deje de pedir el IMEI de celulares reales.

drop trigger if exists productos_lleva_serie_por_categoria on public.productos;
drop function if exists public.productos_lleva_serie_por_categoria();
drop function if exists public.categoria_pide_imei_por_nombre(text);
