-- ─────────────────────────────────────────────────────────────────────────────
-- Evens: los recargos por mora mal aplicados bajan al monto que correspondía.
--
-- Por qué (8/10/2026): auditoría de CELESTE SCHOFER. Con SALDO_COMPLETO la mora
-- se calculó sobre compras que todavía no vencían (26/9: $18.828,75 por $201,25
-- vencidos; 7/10: $6.555 sobre una compra de 40 segundos antes) y antes del 5/10
-- recargaba de nuevo, en cada cobro, capital que ya había recargado.
--
-- La regla que vale (Ignacio con Evelyn, 8/10/2026): cada venta vence en su
-- plazo; hay mora nueva SOLO cuando vence una venta nueva, y entonces el
-- porcentaje va sobre TODO el capital vencido vivo, sin la mora anterior. Sin
-- una venta nueva vencida, un cobro no recarga.
--
-- Decisión de la dueña: se corrige la parte de más SOLO a quien todavía debe, sin
-- dejar saldo a favor y sin rastro de "perdón": el recargo baja a lo que
-- correspondía y el que no correspondía se borra. Lo ya cobrado a quien hoy
-- tiene saldo cero queda como está (7 clientes, no se tocan).
--
-- Cómo se calculó lo correcto: reconstrucción del libro de cada cliente,
-- evaluando cada mora REALMENTE cobrada (no se inventan moras donde el sistema no
-- cobró), con el plazo vigente en cada fecha (30 días hasta el 28/8, 35 después)
-- y dejando en el libro la mora corregida para los cobros siguientes. Todas las
-- moras corregidas son posteriores al cambio de plazo.
--
-- Los recibos guardados (`cc_recibos`, `cc_imputaciones`) son fotos del momento y
-- no se tocan. No hay FK hacia estas filas.
-- Reversión: supabase/reversals/20261008160000_corregir_moras_mal_aplicadas_evens.sql
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_negocio constant uuid := '44468525-8381-4c83-a558-eb7209e386b5';
  v_fila record;
  v_n int;
  v_total numeric;
begin
  create temp table _moras (
    mora_id uuid primary key,
    cliente_id uuid not null,
    cobrada numeric not null,
    correcta numeric not null
  ) on commit drop;

  insert into _moras values
    ('0bab67d4-0c51-4f44-8ef9-f89a26a12b19', 'a4b795b2-c595-4d09-acfd-fe2f4d58babb', 18828.75,   30.19), -- CELESTE SCHOFER 26/9
    ('6239b1d5-6cac-4131-a51c-c96614c808bb', 'a4b795b2-c595-4d09-acfd-fe2f4d58babb',  6555.00, 2074.72), -- CELESTE SCHOFER 7/10
    ('ce7b34bc-ed09-441b-88f8-d53740f03870', 'dd053319-ad8f-49f4-882c-2f0631ca89bc', 11235.00,    0.00), -- MARA MANSILLA 14/9
    ('231a1eb8-1973-4b55-b55d-d4b31fd8e4bf', 'dd053319-ad8f-49f4-882c-2f0631ca89bc',  8985.00, 8137.50), -- MARA MANSILLA 26/9
    ('3621296a-a529-4fe4-a2c5-d4644093d9b2', '2a119850-78bc-47d5-9305-f0aede5537eb', 14145.00, 3967.50), -- MARIANA FERREYRA 14/9
    ('4e8356a0-549e-4c82-baf2-bff81e72e30f', '42cd2e9d-0c0a-4db1-990e-477087a0e9ec',  4980.00,    0.00), -- GIULIANA PEREZ 14/9
    ('a1cef5c9-b1ac-4f02-b4a6-656b6ed8eaee', '3435aabc-8c83-4d8e-a882-bdddc4040638',  5272.50, 3645.00), -- FABIAN BAGLIONE 7/10
    ('1106cba7-2844-4439-a613-259184a04996', 'cd49b52c-a058-4fe1-939f-d874bed5fd1f',  6450.00, 5340.00); -- Brisa maldonado 26/9

  create temp table _clientes (
    cliente_id uuid primary key,
    saldo_antes numeric not null
  ) on commit drop;

  insert into _clientes values
    ('a4b795b2-c595-4d09-acfd-fe2f4d58babb', 94635.00), -- CELESTE SCHOFER
    ('dd053319-ad8f-49f4-882c-2f0631ca89bc', 69370.00), -- MARA MANSILLA
    ('2a119850-78bc-47d5-9305-f0aede5537eb', 70995.00), -- MARIANA FERREYRA
    ('42cd2e9d-0c0a-4db1-990e-477087a0e9ec', 80050.00), -- GIULIANA PEREZ
    ('3435aabc-8c83-4d8e-a882-bdddc4040638', 12450.50), -- FABIAN BAGLIONE
    ('cd49b52c-a058-4fe1-939f-d874bed5fd1f', 31050.00); -- Brisa maldonado

  select round(sum(cobrada - correcta), 2) into v_total from _moras;
  if v_total <> 53256.34 then
    raise exception 'Total a corregir inesperado: %', v_total;
  end if;

  -- 1. Cada mora sigue siendo la que se auditó: misma fila, mismo monto, viva.
  select count(*) into v_n
    from _moras x
    join public.cuenta_corriente_movimientos m on m.id = x.mora_id
   where m.cliente_id = x.cliente_id
     and m.negocio_id = v_negocio
     and m.tipo = 'DEBITO'
     and m.pago_id is not null
     and m.anulado = false
     and m.monto = x.cobrada;
  if v_n <> 8 then
    raise exception 'Se esperaban 8 moras sin cambios desde la auditoría, hay %', v_n;
  end if;

  -- 2. Cada cliente tiene el saldo auditado y el libro cuadra al peso.
  for v_fila in
    select k.cliente_id, k.saldo_antes, c.saldo_pendiente,
           (select coalesce(sum(case when m.tipo = 'DEBITO' then m.monto else -m.monto end), 0)
              from public.cuenta_corriente_movimientos m
             where m.cliente_id = k.cliente_id and m.anulado = false) as libro
      from _clientes k
      join public.clientes c on c.id = k.cliente_id and c.negocio_id = v_negocio
  loop
    if v_fila.saldo_pendiente <> v_fila.saldo_antes or v_fila.libro <> v_fila.saldo_antes then
      raise exception 'Cliente % cambió desde la auditoría: saldo %, libro %, esperado %',
        v_fila.cliente_id, v_fila.saldo_pendiente, v_fila.libro, v_fila.saldo_antes;
    end if;
  end loop;

  -- 3. Las que no correspondían se borran; las demás bajan a lo correcto.
  delete from public.cuenta_corriente_movimientos m
   using _moras x
   where m.id = x.mora_id and x.correcta = 0;
  get diagnostics v_n = row_count;
  if v_n <> 2 then
    raise exception 'Se esperaban 2 moras borradas, se borraron %', v_n;
  end if;

  update public.cuenta_corriente_movimientos m
     set monto = x.correcta,
         descripcion = 'Recargo por mora (15% sobre la deuda vencida)'
    from _moras x
   where m.id = x.mora_id and x.correcta > 0;
  get diagnostics v_n = row_count;
  if v_n <> 6 then
    raise exception 'Se esperaban 6 moras corregidas, se corrigieron %', v_n;
  end if;

  -- 4. El saldo baja lo mismo (delta, condicionado al saldo auditado).
  update public.clientes c
     set saldo_pendiente = c.saldo_pendiente - d.exceso
    from (select cliente_id, sum(cobrada - correcta) as exceso from _moras group by cliente_id) d
    join _clientes k using (cliente_id)
   where c.id = d.cliente_id
     and c.negocio_id = v_negocio
     and c.saldo_pendiente = k.saldo_antes;
  get diagnostics v_n = row_count;
  if v_n <> 6 then
    raise exception 'Se esperaban 6 saldos actualizados, se actualizaron %', v_n;
  end if;

  update public.clientes c
     set fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(c.id)
   where c.id in (select cliente_id from _clientes);

  -- 5. Después: el libro sigue cuadrando, nadie queda con saldo a favor y la
  --    baja total es exactamente la auditada.
  for v_fila in
    select c.id, c.saldo_pendiente,
           (select coalesce(sum(case when m.tipo = 'DEBITO' then m.monto else -m.monto end), 0)
              from public.cuenta_corriente_movimientos m
             where m.cliente_id = c.id and m.anulado = false) as libro
      from public.clientes c
     where c.id in (select cliente_id from _clientes)
  loop
    if v_fila.saldo_pendiente <> v_fila.libro then
      raise exception 'Cliente % descuadrado: saldo %, libro %', v_fila.id, v_fila.saldo_pendiente, v_fila.libro;
    end if;
    if v_fila.saldo_pendiente < 0 then
      raise exception 'Cliente % quedaría con saldo a favor: %', v_fila.id, v_fila.saldo_pendiente;
    end if;
  end loop;

  select round(sum(k.saldo_antes) - sum(c.saldo_pendiente), 2) into v_total
    from _clientes k join public.clientes c on c.id = k.cliente_id;
  if v_total <> 53256.34 then
    raise exception 'La baja total de saldos es %, se esperaba 53256.34', v_total;
  end if;
end;
$$;
