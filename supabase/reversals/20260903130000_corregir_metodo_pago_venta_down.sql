-- Rollback de 20260903130000_corregir_metodo_pago_venta.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- LO QUE SE PIERDE: el historial de correcciones. Si hubo aunque sea una, esa
-- es la única evidencia de que la venta se cobró de otra forma antes — el
-- estado actual de `venta_pagos` no la conserva. Copiar antes de borrar:
--
--   create table ventas_correcciones_respaldo as select * from ventas_correcciones;
--
-- Lo que NO revierte, y hay que saberlo: las correcciones ya aplicadas quedan
-- como están. `venta_pagos` y `ventas` siguen con el método corregido, que es
-- el correcto — deshacerlas sería devolverle a la venta un medio de pago que
-- la vendedora ya dijo que estaba mal.
--
-- La función se dropea primero: si quedara viva sin la tabla, cualquier
-- corrección fallaría al insertar la auditoría, y con la transacción abierta
-- eso deja la venta sin corregir pero con el error a la vista.

begin;

drop function if exists public.corregir_metodo_pago_venta(uuid, uuid, text);

drop table if exists public.ventas_correcciones;

-- El permiso se saca de los roles y del catálogo. `rol_permisos` cae solo por
-- la FK, pero se borra explícito para no depender de cómo esté declarada.
delete from public.rol_permisos
 where permiso_id in (select id from public.permisos where clave = 'ventas.corregir_pago');

delete from public.permisos where clave = 'ventas.corregir_pago';

commit;
