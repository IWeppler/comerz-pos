-- Rollback de 20260902150000_unidades_serie_no_cascade.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- Devuelve `unidades_serie.producto_variante_id` a ON DELETE CASCADE, o sea que
-- borrar un producto vuelve a borrar en silencio el registro de garantía de sus
-- equipos con IMEI. Solo tiene sentido si el RESTRICT está bloqueando un
-- borrado legítimo y hay que destrabarlo YA; la salida buena para ese caso es
-- dar de baja las unidades primero, no aflojar la constraint.

alter table public.unidades_serie
  drop constraint unidades_serie_producto_variante_id_fkey;

alter table public.unidades_serie
  add constraint unidades_serie_producto_variante_id_fkey
    foreign key (producto_variante_id)
    references public.producto_variantes(id)
    on delete cascade;
