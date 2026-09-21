-- Rollback de 20260902190000_historial_precios_sin_fk.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- LEER ESTO ANTES DE CORRERLO. Volver a poner la FK no es gratis y puede
-- fallar:
--
--   1. `add constraint` VALIDA las filas existentes. Si desde que se aplicó la
--      migración se borró alguna variante que tenía historial, esas filas
--      tienen ahora un id colgado y el ALTER va a fallar con 23503. Para saber
--      cuántas son antes de intentar:
--
--        select count(*) from actualizaciones_precio_items i
--         where i.variante_id is not null
--           and not exists (select 1 from producto_variantes v where v.id = i.variante_id);
--
--      Si da > 0 hay que decidir qué hacer con ellas, y la única salida que
--      permite poner la FK es ponerles null — o sea, destruir el dato que esta
--      migración vino a conservar. Se deja comentado abajo, sin correr, porque
--      es una pérdida irreversible y tiene que ser una decisión explícita.
--
--   2. Con la FK de vuelta reaparece el bug de `revertirLote`: una variante
--      borrada le pasa su fila de historial a la rama de nivel producto y
--      pisa `productos.precio` con el precio viejo de la variante. Eran 66
--      productos al momento de la migración.

begin;

-- Descomentar SOLO si el chequeo del punto 1 da > 0 y se acepta perder el dato:
--
-- update public.actualizaciones_precio_items i
--    set variante_id = null
--  where i.variante_id is not null
--    and not exists (select 1 from public.producto_variantes v where v.id = i.variante_id);

alter table public.actualizaciones_precio_items
  add constraint actualizaciones_precio_items_variante_id_fkey
    foreign key (variante_id)
    references public.producto_variantes(id)
    on delete set null;

commit;
