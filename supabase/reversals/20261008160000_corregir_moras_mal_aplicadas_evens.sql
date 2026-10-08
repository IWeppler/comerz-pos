-- Reversión de 20261008160000_corregir_moras_mal_aplicadas_evens.sql
-- Devuelve las 8 moras a su monto y leyenda originales (re-crea las 2 borradas
-- con su id), sube los saldos lo mismo y re-cachea los vencimientos.
-- Valores tomados de producción el 8/10/2026, antes de aplicar.

do $$
declare
  v_n int;
begin
  insert into public.cuenta_corriente_movimientos
    (id, cliente_id, venta_id, pago_id, tipo, monto, descripcion, creado_por, creado_en,
     monto_recargo, fecha_origen, anulado, negocio_id, recargo_porcentaje,
     debito_origen_id, origen_reconstruido, es_saldo_a_favor)
  values
    ('4e8356a0-549e-4c82-baf2-bff81e72e30f', '42cd2e9d-0c0a-4db1-990e-477087a0e9ec', null,
     'a0b330af-f773-41b6-952a-906d411b58e0', 'DEBITO', 4980, 'Recargo por mora (15% sobre la deuda vencida)',
     'c92ee721-d666-4a44-b430-d92c3debfef1', '2026-09-14T19:12:09.795769+00:00', 0, null, false,
     '44468525-8381-4c83-a558-eb7209e386b5', null, 'ab281cf6-9c0d-45a5-8239-e36c86107720', false, false),
    ('ce7b34bc-ed09-441b-88f8-d53740f03870', 'dd053319-ad8f-49f4-882c-2f0631ca89bc', null,
     'e58b5fc7-e811-419e-8e36-a3bcca6471fd', 'DEBITO', 11235, 'Recargo por mora (15% sobre la deuda vencida)',
     'c92ee721-d666-4a44-b430-d92c3debfef1', '2026-09-14T19:13:16.232023+00:00', 0, null, false,
     '44468525-8381-4c83-a558-eb7209e386b5', null, 'fe2e5302-f58a-4291-a959-f38a174e828b', false, false);

  update public.cuenta_corriente_movimientos m
     set monto = v.monto, descripcion = v.descripcion
    from (values
      ('0bab67d4-0c51-4f44-8ef9-f89a26a12b19'::uuid, 18828.75, 'Recargo por mora (15% sobre la deuda vencida)'),
      ('6239b1d5-6cac-4131-a51c-c96614c808bb'::uuid,  6555.00, 'Recargo por mora (15% sobre el saldo adeudado)'),
      ('231a1eb8-1973-4b55-b55d-d4b31fd8e4bf'::uuid,  8985.00, 'Recargo por mora (15% sobre la deuda vencida)'),
      ('3621296a-a529-4fe4-a2c5-d4644093d9b2'::uuid, 14145.00, 'Recargo por mora (15% sobre la deuda vencida)'),
      ('a1cef5c9-b1ac-4f02-b4a6-656b6ed8eaee'::uuid,  5272.50, 'Recargo por mora (15% sobre el saldo adeudado)'),
      ('1106cba7-2844-4439-a613-259184a04996'::uuid,  6450.00, 'Recargo por mora (15% sobre la deuda vencida)')
    ) as v(id, monto, descripcion)
   where m.id = v.id;
  get diagnostics v_n = row_count;
  if v_n <> 6 then raise exception 'Se esperaban 6 moras restauradas, hay %', v_n; end if;

  update public.clientes c
     set saldo_pendiente = c.saldo_pendiente + v.delta
    from (values
      ('a4b795b2-c595-4d09-acfd-fe2f4d58babb'::uuid, 23278.84),
      ('dd053319-ad8f-49f4-882c-2f0631ca89bc'::uuid, 12082.50),
      ('2a119850-78bc-47d5-9305-f0aede5537eb'::uuid, 10177.50),
      ('42cd2e9d-0c0a-4db1-990e-477087a0e9ec'::uuid,  4980.00),
      ('3435aabc-8c83-4d8e-a882-bdddc4040638'::uuid,  1627.50),
      ('cd49b52c-a058-4fe1-939f-d874bed5fd1f'::uuid,  1110.00)
    ) as v(id, delta)
   where c.id = v.id;
  get diagnostics v_n = row_count;
  if v_n <> 6 then raise exception 'Se esperaban 6 saldos restaurados, hay %', v_n; end if;

  update public.clientes c
     set fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(c.id)
   where c.id in ('a4b795b2-c595-4d09-acfd-fe2f4d58babb', 'dd053319-ad8f-49f4-882c-2f0631ca89bc',
                  '2a119850-78bc-47d5-9305-f0aede5537eb', '42cd2e9d-0c0a-4db1-990e-477087a0e9ec',
                  '3435aabc-8c83-4d8e-a882-bdddc4040638', 'cd49b52c-a058-4fe1-939f-d874bed5fd1f');
end;
$$;
