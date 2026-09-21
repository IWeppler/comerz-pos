-- Deshace facturar una venta ya registrada desde el historial.
drop function if exists public.registrar_factura_de_venta(uuid, jsonb);
