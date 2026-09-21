-- Rollback de 20260902170000_updated_at_por_trigger.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- Saca los cinco triggers y la columna `productos.updated_at`.
--
-- OJO CON EL ORDEN Y CON LO QUE SE PIERDE:
--
--   * Los triggers se dropean primero. Dropear la columna con el trigger vivo
--     dejaría a `marcar_updated_at()` fallando en cada UPDATE de `productos`.
--   * `productos.updated_at` se va con la columna: el dato de cuándo se
--     modificó cada producto NO se puede reconstruir después. El backfill
--     original era `creado_en`, así que lo único irrecuperable son las
--     modificaciones ocurridas entre la migración y el rollback.
--   * Las escrituras manuales de `updated_at` que ya existen en
--     `ajustar_stock_variante`, `ajustar_stock_variantes`,
--     `guardar_variantes_producto_impl`, `aprobar_orden_compra`,
--     `update-prices.ts` y `edit-product.ts` NO se tocan: siguen manteniendo
--     `producto_variantes.updated_at` sin el trigger, aunque con los agujeros
--     que tenían antes (cualquier camino nuevo se olvida).
--   * `categorias`, `atributos` y `atributo_valores` vuelven a quedar con la
--     columna congelada en `created_at`, que es como estaban.
--
-- La función `marcar_updated_at()` se conserva: no molesta sin triggers, y
-- borrarla obligaría a reescribirla para volver a aplicar.

begin;

drop trigger if exists trg_productos_updated_at on public.productos;
drop trigger if exists trg_producto_variantes_updated_at on public.producto_variantes;
drop trigger if exists trg_categorias_updated_at on public.categorias;
drop trigger if exists trg_atributos_updated_at on public.atributos;
drop trigger if exists trg_atributo_valores_updated_at on public.atributo_valores;

alter table public.productos drop column if exists updated_at;

commit;
