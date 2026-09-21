-- Rollback de 20260902180000_catalogo_borrados.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- Saca los tres triggers y la tabla.
--
-- LO QUE SE PIERDE, y no vuelve: los avisos de baja acumulados. Un tombstone
-- no se puede reconstruir después — es la única evidencia de que una fila
-- existió, y de eso se trataba. Si hay alguna chance de querer los datos,
-- copiar la tabla antes:
--
--   create table catalogo_borrados_respaldo as select * from catalogo_borrados;
--
-- Los triggers se dropean primero: con la tabla ya borrada,
-- `registrar_borrado_catalogo()` haría fallar CUALQUIER borrado de producto,
-- variante o categoría.
--
-- La función se conserva: no molesta sin triggers, y borrarla obligaría a
-- reescribirla para volver a aplicar.

begin;

drop trigger if exists trg_productos_borrado on public.productos;
drop trigger if exists trg_producto_variantes_borrado on public.producto_variantes;
drop trigger if exists trg_categorias_borrado on public.categorias;

drop table if exists public.catalogo_borrados;

commit;
