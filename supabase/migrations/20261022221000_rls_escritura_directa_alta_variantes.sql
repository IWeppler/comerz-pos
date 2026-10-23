-- Corrige 20261022220000 (mismo día, aplicada minutos después): las policies de
-- ALTA directa sobre producto_variantes / producto_variante_valores /
-- productos_stock rompían el alta de producto de quien no tiene
-- `stock.editar_producto`.
--
-- La premisa equivocada: docs/seguridad.md decía que `productos` pedía
-- `stock.editar_producto`, pero la base viva deja insertar y editar a cualquier
-- rol del negocio (`productos_insert_auth` / `productos_update_auth`, con `true`),
-- y create-product.ts inserta las variantes DIRECTO. En Librería Colores las 4
-- vendedoras (sin ese permiso) dan de alta productos a diario (~900 en 90 días):
-- el producto entraba y su variante no. Se detectó revisando quién sube stock en
-- la práctica; en la ventana rota no quedó ningún producto sin variante (6 altas,
-- todas con su variante, fuera del horario de los locales).
--
-- Se sacan: las 3 de alta y las de edición/baja de `productos_stock` (espejo
-- legacy que la carga rápida de esas mismas vendedoras sincroniza directo).
-- Quedan: editar y borrar variantes y sus valores directo → stock.editar_producto
-- (ningún flujo de vendedora lo hace: la edición va por guardar_variantes_producto).
-- Verificado como la vendedora 2 de Librería Colores (transacción revertida):
-- alta de producto + variante + espejo pasa; editar la variante directo, 0 filas.
--
-- Reversión: supabase/reversals/20261022221000_rls_escritura_directa_alta_variantes.sql

begin;

drop policy producto_variantes_alta_directa_permiso on public.producto_variantes;
drop policy producto_variante_valores_alta_directa_permiso on public.producto_variante_valores;
drop policy productos_stock_alta_directa_permiso on public.productos_stock;
drop policy productos_stock_edicion_directa_permiso on public.productos_stock;
drop policy productos_stock_baja_directa_permiso on public.productos_stock;

do $guard$
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
              and policyname in ('producto_variantes_alta_directa_permiso',
                                 'producto_variante_valores_alta_directa_permiso',
                                 'productos_stock_alta_directa_permiso',
                                 'productos_stock_edicion_directa_permiso',
                                 'productos_stock_baja_directa_permiso')) then
    raise exception 'quedó alguna policy que había que sacar';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public'
       and policyname in ('producto_variantes_edicion_directa_permiso', 'producto_variantes_baja_directa_permiso',
                          'producto_variante_valores_edicion_directa_permiso', 'producto_variante_valores_baja_directa_permiso')) <> 4 then
    raise exception 'se perdió alguna policy de edición/baja de variantes';
  end if;
end $guard$;

commit;
