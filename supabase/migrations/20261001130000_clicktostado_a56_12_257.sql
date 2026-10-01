-- ClickTostado: el Samsung A56 Rosado entró con una variante "12/257" que es
-- un error de tipeo de "12/256".
--
-- Remito "Importación Electro" del 30/9/2026 (orden a9a123d0): dos filas del
-- mismo aparato, una decía Memoria 12/256 y la otra 12/257. Como la identidad
-- de la variante son sus atributos, nacieron DOS variantes, cada una con su
-- IMEI. El 1/10 se vendió la 12/256 (IMEI …548846); la que queda en stock
-- (IMEI …138267) está colgada de la 12/257.
--
-- Desde la edición no se puede corregir: renombrar un atributo es para
-- guardar_variantes_producto "variante nueva + borrar la vieja", y el borrado
-- choca con el FK RESTRICT de unidades_serie (que existe para no perder
-- garantías, 18/8/2026). Se corrige acá, en una transacción:
--
--   1. La unidad …138267 pasa a la variante 12/256.
--   2. El stock (1) pasa de la 12/257 a la 12/256, con origen
--      EDICION_VARIANTES en movimientos_stock (el trigger deja las dos patas).
--   3. Se borra la variante 12/257 (catalogo_borrados la anota y los celulares
--      la reciben por delta) y su fila del espejo productos_stock.
--   4. Se borra el valor "12/257" del catálogo de atributos para que no se
--      siga sugiriendo.
--   5. Rastro en producto_variantes_auditoria.
--
-- Nadie más referencia la 12/257: ni ventas_items, devoluciones, reservas,
-- presupuestos, presentaciones ni actualizaciones de precio (verificado el
-- 1/10/2026, y vuelto a verificar abajo por guard).

begin;

do $correccion$
declare
  v_neg     constant uuid := '1844badf-1a9a-457c-bfee-4d10122337e8';
  v_prod    constant uuid := 'b4440049-7249-4fc3-baad-c9705f2a1d4f';
  v_mala    constant uuid := '4310d4f7-cd4a-4872-a455-5adef38dbaec'; -- 12/257
  v_buena   constant uuid := 'e85006db-06bb-43dd-bd20-c5e9ac64f540'; -- 12/256
  v_imei    constant text := '353969252138267';
  v_valor   constant uuid := '531a0f94-7923-4562-85a2-dd03e1cd01c7'; -- "12/257"

  m record;
  b record;
  v_filas int;
  v_total_antes numeric;
  v_total_despues numeric;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20261001130000: ClickTostado no existe en esta base; nada que hacer';
    return;
  end if;

  -- Row lock sobre las dos variantes antes de leer nada.
  select * into m from public.producto_variantes
   where id = v_mala and producto_id = v_prod and negocio_id = v_neg
   for update;
  select * into b from public.producto_variantes
   where id = v_buena and producto_id = v_prod and negocio_id = v_neg
   for update;

  if m.id is null or b.id is null then
    raise exception 'GUARD: no están las dos variantes del A56';
  end if;
  if m.atributos <> '{"Color": "Rosado", "Memoria": "12/257"}'::jsonb
     or b.atributos <> '{"Color": "Rosado", "Memoria": "12/256"}'::jsonb then
    raise exception 'GUARD: los atributos cambiaron desde la auditoría (% / %)', m.atributos, b.atributos;
  end if;
  if m.stock <> 1 or b.stock <> 0 then
    raise exception 'GUARD: stock inesperado (12/257=%, 12/256=%)', m.stock, b.stock;
  end if;
  if m.precio is not null or b.precio is not null
     or m.costo is distinct from b.costo then
    raise exception 'GUARD: las variantes tienen precio propio o costo distinto; revisar a mano';
  end if;

  -- La única unidad de la 12/257 es el IMEI …138267, disponible.
  if (select count(*) from public.unidades_serie where producto_variante_id = v_mala) <> 1
     or not exists (
       select 1 from public.unidades_serie
        where producto_variante_id = v_mala and imei = v_imei
          and estado = 'disponible' and venta_id is null
     ) then
    raise exception 'GUARD: las unidades de la 12/257 no están como se auditó';
  end if;

  -- Nada más cuelga de la 12/257.
  if exists (select 1 from public.ventas_items where variante_id = v_mala)
     or exists (select 1 from public.devoluciones_items where variante_id = v_mala)
     or exists (select 1 from public.presupuestos_items where variante_id = v_mala)
     or exists (select 1 from public.reservas where variante_id = v_mala)
     or exists (select 1 from public.producto_presentaciones where variante_id = v_mala)
     or exists (select 1 from public.producto_variante_valores where variante_id = v_mala) then
    raise exception 'GUARD: la 12/257 tiene referencias que no estaban en la auditoría';
  end if;

  select sum(stock) into v_total_antes
    from public.producto_variantes where producto_id = v_prod;

  -- 1. La unidad pasa a la 12/256.
  update public.unidades_serie
     set producto_variante_id = v_buena
   where producto_variante_id = v_mala and imei = v_imei and estado = 'disponible';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'GUARD: se esperaba mover 1 unidad, se movieron %', v_filas;
  end if;

  -- 2. El stock: primero la baja (el trigger registra 1 → 0 en la 12/257),
  --    después el alta (0 → 1 en la 12/256). Origen transaction-local.
  perform set_config('comerz.origen_movimiento', 'EDICION_VARIANTES', true);

  update public.producto_variantes set stock = 0 where id = v_mala and stock = 1;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'GUARD: no se pudo bajar el stock de la 12/257'; end if;

  update public.producto_variantes set stock = stock + 1 where id = v_buena and stock = 0;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'GUARD: no se pudo subir el stock de la 12/256'; end if;

  -- 3. Borrar la variante (ya en stock 0: el trigger no registra nada más) y
  --    el espejo legacy.
  delete from public.producto_variantes where id = v_mala;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'GUARD: no se borró la 12/257'; end if;

  delete from public.productos_stock
   where producto_id = v_prod and variante = 'Color: Rosado / Memoria: 12/257';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'GUARD: el espejo de la 12/257 no estaba (% filas)', v_filas; end if;

  update public.productos_stock
     set cantidad = cantidad + 1
   where producto_id = v_prod and variante = 'Color: Rosado / Memoria: 12/256' and cantidad = 0;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'GUARD: el espejo de la 12/256 no está en 0'; end if;

  -- 4. El valor "12/257" del catálogo de atributos, solo si nadie más lo usa.
  if exists (
       select 1 from public.producto_variantes
        where negocio_id = v_neg and atributos->>'Memoria' = '12/257'
     )
     or exists (select 1 from public.producto_variante_valores where atributo_valor_id = v_valor) then
    raise notice '20261001130000: el valor 12/257 sigue en uso; no se borra';
  else
    delete from public.atributo_valores
     where id = v_valor and negocio_id = v_neg and valor = '12/257';
  end if;

  -- 5. Auditoría.
  insert into public.producto_variantes_auditoria (
    negocio_id, producto_id, variante_id_anterior, variante_id_nueva,
    atributos, nombre_display, accion, stock_anterior, stock_nuevo,
    precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, editado_por
  ) values
  (v_neg, v_prod, v_mala, v_buena, m.atributos, m.nombre_display, 'ELIMINADA',
   1, null, m.precio, null, m.costo, null, null),
  (v_neg, v_prod, v_buena, v_buena, b.atributos, b.nombre_display, 'ACTUALIZADA',
   0, 1, b.precio, b.precio, b.costo, b.costo, null);

  -- Invariantes finales.
  select sum(stock) into v_total_despues
    from public.producto_variantes where producto_id = v_prod;
  if v_total_despues <> v_total_antes then
    raise exception 'GUARD: el stock total del producto cambió (% → %)', v_total_antes, v_total_despues;
  end if;
  if (select count(*) from public.producto_variantes where producto_id = v_prod) <> 1 then
    raise exception 'GUARD: el producto no quedó con una sola variante';
  end if;
  if (select count(*) from public.unidades_serie
       where producto_variante_id = v_buena and estado = 'disponible') <> 1 then
    raise exception 'GUARD: la 12/256 no quedó con 1 unidad disponible';
  end if;
end;
$correccion$;

commit;
