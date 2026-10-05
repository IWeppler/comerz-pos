-- Repone las filas faltantes del espejo legacy `productos_stock` en Estilo Bonito.
--
-- 15 variantes de 9 productos, creadas en la carga inicial del 24-25/7/2026, no
-- tenían fila espejo. `create-sale.ts` buscaba el renglón en el espejo y sin fila
-- cortaba con "Error de stock en ...": esas variantes nunca se pudieron vender
-- (5/10/2026, "TALLE: s / COLOR: beige / Género: Mujer" de Campera Rustica).
-- Ningún otro negocio tiene variantes sin espejo.
--
-- La cantidad sale de `producto_variantes.stock`, que es la copia que manda.
-- Aditiva e idempotente: solo inserta lo que falta. En una base reconstruida
-- (sin esos datos) no inserta nada.

do $$
declare
  v_negocio constant uuid := '055a0286-a7ff-46f4-9910-ba4941140db6';
  v_insertadas int;
  v_faltantes int;
begin
  insert into public.productos_stock (producto_id, variante, cantidad, negocio_id)
  select v.producto_id, v.nombre_display, v.stock, v.negocio_id
    from public.producto_variantes v
   where v.negocio_id = v_negocio
     and not exists (
       select 1 from public.productos_stock ps
        where ps.producto_id = v.producto_id
          and ps.variante = v.nombre_display
     );
  get diagnostics v_insertadas = row_count;

  if v_insertadas > 15 then
    raise exception 'Se esperaban como mucho 15 filas espejo, se insertaron %', v_insertadas;
  end if;

  select count(*) into v_faltantes
    from public.producto_variantes v
   where v.negocio_id = v_negocio
     and not exists (
       select 1 from public.productos_stock ps
        where ps.producto_id = v.producto_id
          and ps.variante = v.nombre_display
     );

  if v_faltantes <> 0 then
    raise exception 'Quedan % variantes sin espejo', v_faltantes;
  end if;

  raise notice 'Filas espejo insertadas: %', v_insertadas;
end
$$;
