-- Reversa de 20260908150000_listas_de_precios.
--
-- Es limpia MIENTRAS las tablas estén vacías, que es el estado en el que las
-- deja la migración de ida. Una vez que un comercio cargue listas y venda con
-- ellas, esto deja de ser reversible sin pérdida:
--
--   * `producto_precios` y `listas_precios` se pierden enteras.
--   * `clientes.lista_precio_id` pierde a qué segmento pertenecía cada cliente.
--   * `ventas.lista_precio_id` / `lista_precio_nombre` pierden CON QUÉ PRECIO
--     se vendió cada ticket, que es un dato histórico que no se puede
--     reconstruir: `ventas_items.precio_unitario` dice cuánto se cobró, pero no
--     por qué era ese número.
--
-- Lo que NO se toca, y es lo importante: ninguna venta cambia de total. El
-- precio efectivamente cobrado está congelado en `ventas_items` desde siempre
-- y no depende de estas tablas. Bajar esto no reescribe plata.

drop index if exists public.idx_clientes_lista_precio;

alter table public.ventas   drop column if exists lista_precio_nombre;
alter table public.ventas   drop column if exists lista_precio_id;
alter table public.clientes drop column if exists lista_precio_id;

-- El orden importa: `producto_precios` referencia `listas_precios`.
drop table if exists public.producto_precios;
drop table if exists public.listas_precios;
