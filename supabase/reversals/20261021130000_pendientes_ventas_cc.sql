-- Reversión de 20261021130000_pendientes_ventas_cc.sql.
-- Quita la función de pendiente real por lote. Revertir JUNTO con el commit que
-- hace que `pendientesActualesDeVentas` la llame: sin ella, la pantalla de ventas
-- falla al cargar.

begin;

drop function if exists public.pendientes_ventas_cc(uuid[]);

commit;
