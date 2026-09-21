-- Rollback de 20260902100000_fusionar_variantes_duplicadas.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
-- Reinserta cada variante eliminada tal cual estaba (incluido su id, que es lo
-- que hace que el repunte de referencias se pueda deshacer), le devuelve el
-- stock a la sobreviviente y vacía el registro.
--
-- LO QUE NO SE PUEDE DESHACER, y hay que saberlo antes de correrlo: el repunte
-- de `ventas_items`, `movimientos_stock` y las demás NO se revierte. Guardamos
-- qué id reemplazó a cuál, pero no qué filas se tocaron, así que devolverlas
-- exigiría adivinar cuáles de las que hoy apuntan a la sobreviviente eran
-- originalmente de la eliminada. Volver atrás deja el historial consolidado en
-- la sobreviviente — que es el estado correcto de todos modos; lo que se
-- recupera es la fila y su stock.
--
-- Si hace falta el detalle fila por fila hay que sacarlo de un backup de
-- Postgres, no de acá.

begin;

-- 1. La fila vuelve con su id original.
select set_config('comerz.omitir_movimiento', 'on', true);

insert into public.producto_variantes (
  id, negocio_id, producto_id, sku, nombre_display, atributos,
  precio, costo, stock, stock_minimo, activa, created_at, updated_at
)
select
  (f.fila_eliminada->>'id')::uuid,
  (f.fila_eliminada->>'negocio_id')::uuid,
  (f.fila_eliminada->>'producto_id')::uuid,
  f.fila_eliminada->>'sku',
  f.fila_eliminada->>'nombre_display',
  coalesce(f.fila_eliminada->'atributos', '{}'::jsonb),
  nullif(f.fila_eliminada->>'precio', '')::numeric,
  nullif(f.fila_eliminada->>'costo', '')::numeric,
  nullif(f.fila_eliminada->>'stock', '')::numeric,
  coalesce(nullif(f.fila_eliminada->>'stock_minimo', '')::numeric, 0),
  coalesce((f.fila_eliminada->>'activa')::boolean, true),
  (f.fila_eliminada->>'created_at')::timestamptz,
  (f.fila_eliminada->>'updated_at')::timestamptz
from public.variantes_fusionadas f
where not exists (
  select 1 from public.producto_variantes v
   where v.id = (f.fila_eliminada->>'id')::uuid
);

-- 2. La sobreviviente vuelve al stock que tenía antes de la fusión.
update public.producto_variantes v
   set stock      = f.stock_antes_sobrevive,
       updated_at = now()
  from public.variantes_fusionadas f
 where v.id = f.variante_id_sobrevive;

select set_config('comerz.omitir_movimiento', '', true);

-- 3. El registro se vacía, no se dropea la tabla: si se vuelve a aplicar la
--    migración, el `create table if not exists` la encuentra y sigue.
delete from public.variantes_fusionadas;

commit;
