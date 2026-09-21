-- Revierte 20260908200000. NO SE PUEDE, y decirlo es más útil que fingirlo.
--
-- La migración borró la distinción entre "esta variante tenía guardado un
-- precio igual al del producto" y "esta variante siempre heredó", porque las
-- dos terminan en NULL — que es justamente el punto: eran el mismo estado
-- escrito de dos formas. Volver atrás sería copiarle el precio del producto a
-- las 5.857 variantes que hoy heredan, incluidas las 4.583 que nunca tuvieron
-- uno propio. Eso no es revertir: es aplicar el bug a todo el catálogo.
--
-- Y no hace falta: nulear una copia no cambió ningún precio efectivo (la
-- propia migración lo verifica variante por variante antes de terminar), así
-- que no hay nada que restaurar. Si el objetivo es que una variante puntual
-- vuelva a tener precio propio, se le pone desde la ficha del producto.
--
-- Este archivo existe para que el par up/down esté completo y para dejar
-- escrito el motivo, no para ejecutarse.
do $$
begin
  raise exception
    'La normalizacion de 20260908200000 no es reversible: restaurar las copias seria escribirle el precio del producto a 5.857 variantes que heredan. Ver el comentario de este archivo.';
end $$;
