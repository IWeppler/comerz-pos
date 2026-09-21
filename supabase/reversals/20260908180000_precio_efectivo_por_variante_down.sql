-- Revierte 20260908180000. La vista es solo lectura y no la escribe nadie:
-- borrarla no puede perder un dato. Lo que sí rompe es la conciliación, que
-- pasa a leerla — bajar esta migración exige bajar también el código.
drop view if exists public.productos_precio_efectivo;
