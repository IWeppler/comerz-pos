-- Reversa de 20260904120000_conciliacion_carga_inicial.
--
-- Borrar `ordenes_borradores` pierde el progreso sin confirmar de las
-- conciliaciones abiertas — nada definitivo, pero sí trabajo tipeado. Los
-- productos ya creados y el producto_id escrito en ordenes_items NO se tocan:
-- son datos reales, no estado de la pantalla.

drop function if exists public.crear_productos_desde_remito(uuid, jsonb);
drop table if exists public.ordenes_borradores;
