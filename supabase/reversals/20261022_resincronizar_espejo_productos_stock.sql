-- Resincroniza el espejo legacy productos_stock con producto_variantes
-- (aplicado el 22/10/2026, comercios activos y en prueba).
--
-- Auditoría del mismo día: el espejo está sano salvo 22 filas.
--  - 5 desfasadas (Evens): la fila del talle existe pero no coincide con la
--    variante. REMERA CARE "Celeste / U" en -1 y JEANS WID MIFIA "Celeste / 16"
--    con 0: una anulación y una devolución parcial devolvieron la unidad al
--    texto congelado del ticket (talle renombrado después) y ajustar_stock_legacy,
--    que hace upsert, creó una fila nueva en vez de fallar. Las otras 3 son
--    desfasajes viejos sin movimiento que los explique.
--  - 17 fantasmas: filas cuyo texto no es el nombre de ninguna variante del
--    producto. 2 de Evens (las dos de arriba) y 15 de Estilo Bonito con el formato
--    de nombres de julio ("MARCA: … / TALLE: …"), de variantes que ya no existen.
-- El código que las generaba se corrigió en cancel-sale.ts y
-- registrar-devolucion.ts (`nombreEspejoLegacy`): el espejo se devuelve al
-- nombre ACTUAL de la variante.
--
-- La fuente de verdad es la variante: las desfasadas se igualan a ella y las
-- fantasmas se borran (su variante no existe).

begin;

do $sync$
declare v_n int;
begin
  update public.productos_stock ps
     set cantidad = pv.stock
    from public.producto_variantes pv, public.negocios n
   where pv.producto_id = ps.producto_id and pv.nombre_display = ps.variante
     and pv.stock <> ps.cantidad
     and n.id = ps.negocio_id and n.estado in ('activo', 'prueba');
  get diagnostics v_n = row_count;
  if v_n <> 5 then raise exception 'desfasadas: se esperaban 5, hubo %', v_n; end if;

  delete from public.productos_stock ps
   using public.negocios n
   where n.id = ps.negocio_id and n.estado in ('activo', 'prueba')
     and not exists (select 1 from public.producto_variantes pv
                      where pv.producto_id = ps.producto_id and pv.nombre_display = ps.variante)
     and exists (select 1 from public.producto_variantes pv where pv.producto_id = ps.producto_id);
  get diagnostics v_n = row_count;
  if v_n <> 17 then raise exception 'fantasmas: se esperaban 17, hubo %', v_n; end if;

  select count(*) into v_n
    from public.producto_variantes pv
    join public.negocios n on n.id = pv.negocio_id and n.estado in ('activo', 'prueba')
    left join public.productos_stock ps on ps.producto_id = pv.producto_id and ps.variante = pv.nombre_display
   where ps.id is null or ps.cantidad <> pv.stock;
  if v_n <> 0 then raise exception 'FINAL: quedan % variantes sin espejo o desfasadas', v_n; end if;
end
$sync$;

commit;

-- Respaldo (estado ANTERIOR de las 22 filas) para revertir a mano:
-- id, negocio_id, producto_id, variante, cantidad
--   insert into public.productos_stock (id, negocio_id, producto_id, variante, cantidad)
--   values (...) on conflict (id) do update set cantidad = excluded.cantidad;
-- ('13b9c3ae-bf17-43e9-858c-0cfa4d255ee7', '055a0286-a7ff-46f4-9910-ba4941140db6', '901797ba-ac60-4891-b657-755c9cc9869a', 'MARCA: Bingo Fuel / TALLE: 4 / COLOR: gris / Género: Bebé', 1.000),
-- ('190252d3-6463-4384-9a9d-a208bf7c1d21', '055a0286-a7ff-46f4-9910-ba4941140db6', '901797ba-ac60-4891-b657-755c9cc9869a', 'MARCA: OCN / TALLE: xs / COLOR: gris / Género: Mujer', 1.000),
-- ('1d94fbe9-22bf-4ca7-a0c0-3b91c419dac1', '055a0286-a7ff-46f4-9910-ba4941140db6', '901797ba-ac60-4891-b657-755c9cc9869a', 'MARCA: Bingo Fuel / TALLE: 3 / COLOR: fresa / Género: BEBA', 1.000),
-- ('260923a4-7c26-42f8-b0c0-8f7381bc6c20', '055a0286-a7ff-46f4-9910-ba4941140db6', '916f19d3-1b41-4eec-9257-37d7037e132e', 'MARCA: LDE / TALLE: 1 / COLOR: estampado / Género: BEBA', 1.000),
-- ('27f3b3b3-dfa5-4b27-bbc8-519ba0412de6', '055a0286-a7ff-46f4-9910-ba4941140db6', '916f19d3-1b41-4eec-9257-37d7037e132e', 'MARCA: LDE / TALLE: 4 / COLOR: estampado / Género: BEBA', 1.000),
-- ('2ad0b876-87bf-4816-892b-2aaae20f575f', '055a0286-a7ff-46f4-9910-ba4941140db6', '901797ba-ac60-4891-b657-755c9cc9869a', 'MARCA: Bingo Fuel / TALLE: 3 / COLOR: negra / Género: Bebé', 1.000),
-- ('356eaf8a-e82b-4d01-a662-9776590e7ef4', '055a0286-a7ff-46f4-9910-ba4941140db6', 'b20f7f1e-e26a-4adb-a5d0-a229f3b12e9e', 'MARCA: Minet / TALLE: 10 / COLOR: azul / Género: Niña', 1.000),
-- ('3ef2b16c-8946-4467-99f0-6f6122b687bf', '44468525-8381-4c83-a558-eb7209e386b5', '38b8fe16-1fce-4fb8-bc67-faa1153241f5', 'Celeste / U', -1.000),
-- ('47c51011-148c-446e-a017-006cce15f5a2', '055a0286-a7ff-46f4-9910-ba4941140db6', '88565862-5347-4bb5-8741-a27344b7c38a', '2: 1 / MARCA: Luciras / TALLE: 12 / COLOR: beige / Género: Niña', 1.000),
-- ('47e6220e-5462-41cc-b260-784367cda78e', '055a0286-a7ff-46f4-9910-ba4941140db6', '901797ba-ac60-4891-b657-755c9cc9869a', 'MARCA: Bingo Fuel / TALLE: 5 / COLOR: naranja / Género: Bebé', 1.000),
-- ('5271269f-9d06-4a9a-8220-30ab4f0a079c', '44468525-8381-4c83-a558-eb7209e386b5', '38b8fe16-1fce-4fb8-bc67-faa1153241f5', 'TALLE: U / COLOR: CELESTE', 1.000),
-- ('59310c9a-e602-4b8c-bf35-63e2ba465d97', '055a0286-a7ff-46f4-9910-ba4941140db6', 'a4ae8e20-fe27-40d1-9910-9a939fd13017', 'MARCA: joselin / TALLE: 4 / COLOR: lila / Género: BEBA', 2.000),
-- ('6e803cd3-69d7-41c1-89b6-da4512a81238', '44468525-8381-4c83-a558-eb7209e386b5', '62b5f9b1-2eda-48af-af5e-5ec69644fd31', 'Celeste / 16', 0.000),
-- ('7636c420-a36d-4097-b775-32d30f9c192b', '44468525-8381-4c83-a558-eb7209e386b5', '781451f2-ff8c-4f91-9b24-cec73791927b', 'Azul / 42', 0.000),
-- ('8515f709-ffd6-44f5-94be-ddaa5763fd85', '44468525-8381-4c83-a558-eb7209e386b5', 'd54cad20-c18d-46f1-89c0-9407b8134a98', 'Chocolate / 2', 1.000),
-- ('95beda0f-3dc5-4e8d-8a7c-5783d2d0f5c8', '055a0286-a7ff-46f4-9910-ba4941140db6', '0cb7cec1-4fb2-4f8f-b73b-a871c77dbf94', 'MARCA: LDE / TALLE: 8 / COLOR: estampado / Género: Niña', 1.000),
-- ('98724c3e-e11d-47a3-a0c4-8e117342b0eb', '44468525-8381-4c83-a558-eb7209e386b5', '62b5f9b1-2eda-48af-af5e-5ec69644fd31', 'Talle: 16 / Color: CELESTE', 1.000),
-- ('c04bd81e-8dca-4eae-8813-c0951612a73a', '055a0286-a7ff-46f4-9910-ba4941140db6', '88565862-5347-4bb5-8741-a27344b7c38a', '2: 2 / MARCA: Luciras / TALLE: 6 / COLOR: negro / Género: Niña', 1.000),
-- ('c6807062-c5b0-4235-b626-19d987177ee7', '055a0286-a7ff-46f4-9910-ba4941140db6', '3404a258-0ac7-4b00-93a1-bff7a33a688d', 'MARCA: N/A / TALLE: surtido / COLOR: estampado / Género: Niña', 9.000),
-- ('d0f58ff7-25fd-4208-8662-c363d849fbab', '44468525-8381-4c83-a558-eb7209e386b5', '2e499b99-d1af-4595-a21a-7ba1218a60d6', 'Gris / 2', 0.000),
-- ('e9e9dfa2-f41c-44df-b663-d1af17f0e660', '055a0286-a7ff-46f4-9910-ba4941140db6', '901797ba-ac60-4891-b657-755c9cc9869a', 'MARCA: OCN / TALLE: s / COLOR: beige / Género: Mujer', 1.000),
-- ('eb3434a1-ed14-44f2-9363-2cc0cd09acbe', '055a0286-a7ff-46f4-9910-ba4941140db6', 'e946bf2d-8065-401f-bc24-65eeafe314b8', 'MARCA: Bingo Fuel / TALLE: 8 / COLOR: surtido / Género: Niña', 1.000)
