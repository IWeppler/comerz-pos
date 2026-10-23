-- Reversión de 20261022221000_rls_escritura_directa_alta_variantes.sql.
-- NO aplicar sin antes cerrar el alta de `productos`: volver a poner estas
-- policies rompe el alta de producto de las vendedoras sin
-- `stock.editar_producto` (Librería Colores lo hace a diario).

begin;

create policy producto_variantes_alta_directa_permiso on public.producto_variantes
  as restrictive for insert to authenticated
  with check (not (select security.es_escritura_directa()) or (select public.tiene_permiso('stock.editar_producto')));
create policy producto_variante_valores_alta_directa_permiso on public.producto_variante_valores
  as restrictive for insert to authenticated
  with check (not (select security.es_escritura_directa()) or (select public.tiene_permiso('stock.editar_producto')));

do $$
declare
  v_cond text := '(not (select security.es_escritura_directa()) or (select public.tiene_permiso(''stock.editar_producto'')) or (select public.tiene_permiso(''stock.dar_baja'')))';
begin
  execute format('create policy productos_stock_alta_directa_permiso on public.productos_stock as restrictive for insert to authenticated with check %s', v_cond);
  execute format('create policy productos_stock_edicion_directa_permiso on public.productos_stock as restrictive for update to authenticated using %s with check %s', v_cond, v_cond);
  execute format('create policy productos_stock_baja_directa_permiso on public.productos_stock as restrictive for delete to authenticated using %s', v_cond);
end $$;

commit;
