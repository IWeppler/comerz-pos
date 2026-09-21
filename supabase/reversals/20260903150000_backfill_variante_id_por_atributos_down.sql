-- Rollback de 20260903150000_backfill_variante_id_por_atributos.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- Es reversible EXACTO porque el backfill dejó registro: cada renglón que tocó
-- quedó en `backfill_variante_id_20260903` con el valor que tenía antes. Se
-- restaura ese valor y no otro.
--
-- PENSALO DOS VECES ANTES DE CORRERLO. Volver atrás no arregla nada: deja 28
-- renglones que HOY pueden devolver stock a su variante otra vez sin poder
-- hacerlo. El único motivo válido sería descubrir que alguno de los matches por
-- atributos apuntó a la variante equivocada — y en ese caso conviene corregir
-- ESE renglón a mano, no revertir los 28.
--
-- La condición de abajo es la que hace que sea seguro: solo restaura donde el
-- renglón sigue teniendo el valor que puso el backfill. Si alguien lo cambió
-- después (a mano, o una venta corregida), ese renglón se deja como está.

begin;

update public.ventas_items i
   set variante_id = b.variante_id_anterior
  from public.backfill_variante_id_20260903 b
 where b.venta_item_id = i.id
   and i.variante_id = b.variante_id_nuevo;

drop table if exists public.backfill_variante_id_20260903;

commit;
