-- Corrección a mano: Encanto, venta #9BFCAC7A (clienta Mortara Meli), 22/10/2026.
--
-- QUÉ PASÓ (hora de Argentina):
--   09:41 Venta $172.700 a cuenta corriente con entrega de $70.000 en efectivo.
--         Deuda $102.700. Hasta acá, correcto.
--   09:45 Cobro de CC de $102.700 en efectivo, que NO ocurrió (la clienta pagó
--         solo los $70.000, confirmado por Ignacio el 22/10/2026).
--   09:51 Anulación de la venta: egreso DEVOLUCION de $70.000, cobro de $70.000
--         ANULADO, crédito de anulación de $102.700 (lo cobrado queda a favor) y
--         stock devuelto (2 prendas). Saldo de la clienta: -$102.700.
--
-- ESTADO BUSCADO: la venta confirmada a CC con entrega de $70.000. Deuda
-- $102.700, sin cobro de $102.700, sin devolución, y las 2 prendas vendidas.
--
-- No hay RPC para revertir una anulación ni para anular un cobro de CC: por
-- eso es SQL a mano, en una transacción, con guards.
--   - El egreso se BORRA (como anular_egreso; esa RPC frena los DEVOLUCION): el
--     trigger escribe ELIMINACION_REVERSA +70.000 en el ledger.
--   - El cobro de $102.700 se BORRA, no se marca ANULADO: el arqueo
--     (flujo_caja_turno) cuenta los cobros en efectivo anulados incluidos. El
--     trigger escribe ELIMINACION_REVERSA -102.700. Su imputación y su recibo se
--     borran; su crédito de CC queda anulado (no se borra).
--   - El cobro de $70.000 vuelve a CONFIRMADO SIN pasar por el trigger del
--     ledger: la anulación en efectivo había escrito una reversa de 0 (la plata
--     salía por el egreso), así que la REACTIVACION de +70.000 que escribiría el
--     trigger contaría esa plata dos veces. Se deja un CORRECCION_SIN_IMPACTO a
--     mano como rastro.
-- Efecto neto en el cajón del turno: -32.700 (+70.000 del egreso que no fue,
-- -102.700 del cobro que no fue).

begin;

do $fix$
declare
  c_negocio  constant uuid := '38c3d1e3-4684-4aef-8d7b-ac3989127874';
  c_venta    constant uuid := '9bfcac7a-25a6-4d00-80a6-72933d71da51';
  c_cliente  constant uuid := 'e572cca3-5ab6-409c-bc28-9906b0466c67';
  c_turno    constant uuid := '072e0730-4db9-4331-9b60-4fdfda40f2ec';
  c_pago_70  constant uuid := 'f0879c8e-f235-495c-988a-a4ebdc134a19';
  c_pago_cc  constant uuid := 'bd2a1284-d7c5-42a4-a8b7-d02250e65b08';
  c_egreso   constant uuid := '318fde81-3ffe-4095-b694-41f2059295e9';
  c_ccm_cobro constant uuid := '6459ce56-50b9-4d23-920f-8e1e06af2efa';
  c_ccm_anul  constant uuid := '18f9f520-eedc-42c8-9eeb-382bf38aeac9';
  c_var_a    constant uuid := 'acf2d6ce-a248-46e9-b3d4-db5e34de3247';
  c_var_b    constant uuid := 'f55e7074-ac0d-44a6-8c90-4a78410a5368';
  c_yo       constant uuid := '3fcd3bb4-24e3-4e91-b4ed-d9f889ffdc75'; -- Ignacio
  c_motivo   constant text := 'Corrección: la venta 9BFCAC7A se anuló por error y el cobro de CC de $102.700 no ocurrió (la clienta pagó solo la entrega de $70.000).';
  v_n int;
  v_flujo_antes numeric; v_flujo_despues numeric;
  v_ledger_antes numeric; v_ledger_despues numeric;
  v_saldo numeric;
  v_cuenta uuid;
  r record;
begin
  -- Que los triggers registren la corrección a nombre de Ignacio.
  perform set_config('request.jwt.claims', json_build_object('sub', c_yo, 'role', 'authenticated')::text, true);
  perform set_config('comerz.motivo_anulacion', c_motivo, true);

  -- ===== Guards de estado inicial (si algo cambió desde la auditoría, no se toca nada)
  select cuenta_financiera_id into v_cuenta from public.turnos_caja
   where id = c_turno and negocio_id = c_negocio and estado = 'ABIERTO' for update;
  if v_cuenta is null then raise exception 'TURNO no está ABIERTO'; end if;

  perform 1 from public.ventas where id = c_venta and negocio_id = c_negocio
     and estado_operacion = 'ANULADA' and monto_cobrado = 70000 and monto_pendiente = 102700 for update;
  if not found then raise exception 'VENTA no está en el estado esperado'; end if;

  perform 1 from public.venta_pagos where id = c_pago_70 and negocio_id = c_negocio
     and estado_pago_operacion = 'ANULADO' and metodo_tipo = 'EFECTIVO' and monto_bruto = 70000;
  if not found then raise exception 'PAGO 70.000 no está en el estado esperado'; end if;

  perform 1 from public.venta_pagos where id = c_pago_cc and negocio_id = c_negocio
     and estado_pago_operacion = 'CONFIRMADO' and tipo_movimiento = 'PAGO_CUENTA_CORRIENTE' and monto_bruto = 102700;
  if not found then raise exception 'COBRO CC 102.700 no está en el estado esperado'; end if;

  perform 1 from public.egresos where id = c_egreso and negocio_id = c_negocio and tipo = 'DEVOLUCION' and monto = 70000;
  if not found then raise exception 'EGRESO 70.000 no está'; end if;

  select saldo_pendiente into v_saldo from public.clientes where id = c_cliente and negocio_id = c_negocio for update;
  if v_saldo is distinct from -102700 then raise exception 'SALDO de la clienta es %, se esperaba -102700', v_saldo; end if;

  select count(*) into v_n from public.venta_pagos where cliente_id = c_cliente and id <> c_pago_cc;
  if v_n <> 0 then raise exception 'La clienta tiene otros cobros de CC: revisar a mano'; end if;

  -- Fotos para comparar al final.
  select coalesce(sum(vp.monto_bruto) filter (where vp.metodo_tipo = 'EFECTIVO'), 0) into v_flujo_antes
    from public.venta_pagos vp where vp.negocio_id = c_negocio and vp.turno_caja_id = c_turno;
  v_flujo_antes := v_flujo_antes - coalesce((select sum(e.monto) from public.egresos e
    where e.negocio_id = c_negocio and e.turno_caja_id = c_turno and e.cuenta_origen_id = v_cuenta), 0);
  select coalesce(sum(importe), 0) into v_ledger_antes from public.movimientos_financieros
   where negocio_id = c_negocio and cuenta_financiera_id = v_cuenta;

  -- ===== 1. El egreso de devolución no existió.
  delete from public.egresos where id = c_egreso and negocio_id = c_negocio;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'paso 1: egreso'; end if;

  -- ===== 2. El cobro de CC de $102.700 no existió.
  update public.cuenta_corriente_movimientos
     set anulado = true, anulado_en = now(), anulado_por = c_yo, pago_id = null,
         descripcion = descripcion || ' — anulado: cobro cargado por error (pago bd2a1284), ' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
   where id = c_ccm_cobro and negocio_id = c_negocio and pago_id = c_pago_cc and not anulado;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'paso 2: crédito del cobro'; end if;

  delete from public.cc_imputaciones where pago_id = c_pago_cc and negocio_id = c_negocio;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'paso 2: imputación (%)', v_n; end if;
  delete from public.cc_recibos where pago_id = c_pago_cc and negocio_id = c_negocio;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'paso 2: recibo (%)', v_n; end if;

  delete from public.venta_pagos where id = c_pago_cc and negocio_id = c_negocio;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'paso 2: cobro'; end if;

  -- ===== 3. La anulación no existió.
  update public.cuenta_corriente_movimientos
     set anulado = true, anulado_en = now(), anulado_por = c_yo,
         descripcion = descripcion || ' — anulado: la anulación de la venta se revirtió'
   where id = c_ccm_anul and negocio_id = c_negocio and venta_id = c_venta and tipo = 'CREDITO' and not anulado;
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'paso 3: crédito de anulación'; end if;

  -- Cobro de $70.000 a CONFIRMADO sin el trigger del ledger (ver cabecera).
  set local session_replication_role = replica;
  update public.venta_pagos set estado_pago_operacion = 'CONFIRMADO'
   where id = c_pago_70 and negocio_id = c_negocio and estado_pago_operacion = 'ANULADO';
  get diagnostics v_n = row_count;
  set local session_replication_role = origin;
  if v_n <> 1 then raise exception 'paso 3: cobro 70.000'; end if;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
  ) values (
    gen_random_uuid(), c_negocio, v_cuenta, 'VENTA_PAGO', c_pago_70, 'CORRECCION_SIN_IMPACTO',
    0, 0, c_turno, 'Cobro reactivado: se revirtió la anulación de la venta 9BFCAC7A',
    jsonb_build_object('motivo', c_motivo, 'estado_anterior', 'ANULADO', 'estado_nuevo', 'CONFIRMADO'),
    now(), c_yo
  );

  update public.ventas
     set estado_operacion = 'CONFIRMADA', estado_pago = 'PARCIAL',
         motivo_anulacion = null, destino_mercaderia = null, motivo_codigo = null,
         motivo_detalle = null, anulada_por = null, anulada_en = null
   where id = c_venta and negocio_id = c_negocio and estado_operacion = 'ANULADA';
  get diagnostics v_n = row_count; if v_n <> 1 then raise exception 'paso 3: venta'; end if;

  -- Sin fila en ventas_correcciones: su CHECK solo admite campo = 'METODO_PAGO'.
  -- El rastro queda en el CORRECCION_SIN_IMPACTO del ledger (con el motivo), en
  -- las descripciones de los dos créditos de CC anulados y en este archivo.

  -- Saldo: se van los dos créditos de $102.700.
  update public.clientes
     set saldo_pendiente = saldo_pendiente + 205400
   where id = c_cliente and negocio_id = c_negocio;
  update public.clientes
     set fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(c_cliente)
   where id = c_cliente and negocio_id = c_negocio;

  -- ===== 4. Las 2 prendas vuelven a estar vendidas.
  for r in select * from (values (c_var_a), (c_var_b)) x(v) loop
    perform 1 from public.ajustar_stock_variante(r.v, -1, false, 'VENTA', c_venta);
    if not found then raise exception 'paso 4: stock de % (sin stock para descontar)', r.v; end if;
  end loop;

  -- ===== Guards finales
  select saldo_pendiente into v_saldo from public.clientes where id = c_cliente;
  if v_saldo <> 102700 then raise exception 'FINAL: saldo %', v_saldo; end if;

  select coalesce(sum(case when tipo = 'DEBITO' then monto else -monto end), 0) into v_saldo
    from public.cuenta_corriente_movimientos where cliente_id = c_cliente and not anulado;
  if v_saldo <> 102700 then raise exception 'FINAL: movimientos CC suman %', v_saldo; end if;

  select coalesce(sum(vp.monto_bruto) filter (where vp.metodo_tipo = 'EFECTIVO'), 0) into v_flujo_despues
    from public.venta_pagos vp where vp.negocio_id = c_negocio and vp.turno_caja_id = c_turno;
  v_flujo_despues := v_flujo_despues - coalesce((select sum(e.monto) from public.egresos e
    where e.negocio_id = c_negocio and e.turno_caja_id = c_turno and e.cuenta_origen_id = v_cuenta), 0);
  if v_flujo_despues - v_flujo_antes <> -32700 then
    raise exception 'FINAL: el arqueo cambió % (se esperaba -32700)', v_flujo_despues - v_flujo_antes;
  end if;

  select coalesce(sum(importe), 0) into v_ledger_despues from public.movimientos_financieros
   where negocio_id = c_negocio and cuenta_financiera_id = v_cuenta;
  if v_ledger_despues - v_ledger_antes <> -32700 then
    raise exception 'FINAL: el ledger cambió % (se esperaba -32700)', v_ledger_despues - v_ledger_antes;
  end if;

  select count(*) into v_n from public.producto_variantes where id in (c_var_a, c_var_b) and stock = 0;
  if v_n <> 2 then raise exception 'FINAL: stock'; end if;

  -- ERROR de esta corrección (aplicada así el 22/10/2026): se supuso que la
  -- anulación no devolvía el espejo productos_stock porque anular_venta (SQL) no
  -- lo toca. Pero lo devuelve cancel-sale.ts (Node) con ajustar_stock_legacy
  -- después de la RPC. Resultado: las 2 variantes quedaron en 0 y su espejo en 1.
  -- Se arregló aparte el mismo día (ver el bloque al final del archivo).
  select count(*) into v_n from public.productos_stock ps
   where ps.id in ('7f48b584-b263-4a28-bfb9-8fc8d32809e3', 'ba913c9b-213b-4890-bac0-9fd4380b1c47')
     and ps.cantidad = 1;
  if v_n <> 2 then raise exception 'FINAL: el espejo productos_stock cambió'; end if;

  raise notice 'OK: saldo 102700, arqueo % -> %, ledger % -> %',
    v_flujo_antes, v_flujo_despues, v_ledger_antes, v_ledger_despues;
end
$fix$;

commit;

-- Arreglo del espejo (aplicado el 22/10/2026, después del bloque de arriba): las
-- 2 variantes vuelven a estar vendidas, así que su espejo baja 1, como lo
-- habría bajado la venta.
do $espejo$
declare v_n int;
begin
  update public.productos_stock ps
     set cantidad = ps.cantidad - 1
    from public.producto_variantes pv
   where ps.id in ('7f48b584-b263-4a28-bfb9-8fc8d32809e3', 'ba913c9b-213b-4890-bac0-9fd4380b1c47')
     and pv.producto_id = ps.producto_id and pv.nombre_display = ps.variante
     and ps.cantidad = 1 and pv.stock = 0
     and ps.negocio_id = '38c3d1e3-4684-4aef-8d7b-ac3989127874';
  get diagnostics v_n = row_count;
  if v_n <> 2 then raise exception 'se esperaban 2 filas, hubo %', v_n; end if;
end
$espejo$;
