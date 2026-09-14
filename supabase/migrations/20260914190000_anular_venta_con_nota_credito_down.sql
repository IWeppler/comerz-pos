-- Vuelve a frenar la anulacion de ventas facturadas (cancel-sale.ts).
drop function if exists public.anular_venta_facturada(uuid, text, uuid, text, text, jsonb);
