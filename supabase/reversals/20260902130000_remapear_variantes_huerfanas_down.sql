-- Rollback de 20260902130000_remapear_variantes_huerfanas.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- A diferencia del rollback del paso 0, este SÍ es exacto fila por fila:
-- `variantes_remapeo_aplicado` guarda qué fila de qué tabla se tocó y qué
-- `variante_id` tenía antes. Se hizo así porque una de las dos tablas es
-- `ventas_items`, y ahí una reconstrucción aproximada no alcanza.
--
-- Devuelve las referencias a los UUID muertos que tenían — o sea que restaura
-- el bug, no lo arregla de otra forma. Es un rollback de emergencia.
--
-- El mapa (`variantes_remapeo`) se conserva a propósito: es la única copia de
-- una cadena que ya no se puede reconstruir desde la auditoría, porque el
-- upsert de 20260902110000 dejó de producir pares viejo->nuevo. Borrarlo sería
-- tirar el dato que haría falta para volver a intentar el backfill.

begin;

update public.movimientos_stock m
   set variante_id = a.variante_id_viejo
  from public.variantes_remapeo_aplicado a
 where a.tabla = 'movimientos_stock'
   and a.fila_id = m.id
   and m.variante_id = a.variante_id_nuevo;

update public.ventas_items i
   set variante_id = a.variante_id_viejo
  from public.variantes_remapeo_aplicado a
 where a.tabla = 'ventas_items'
   and a.fila_id = i.id
   and i.variante_id = a.variante_id_nuevo;

-- Solo el registro de aplicación se vacía. El mapa se queda (ver encabezado).
delete from public.variantes_remapeo_aplicado;

commit;
