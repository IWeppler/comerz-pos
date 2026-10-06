-- Librería Colores: unifica el cliente duplicado de la escuela 405 de Pozo
-- Borrado (6/10/2026, pedido de Ignacio).
--
-- Había dos fichas con el mismo teléfono (3491416343):
--   * a0de0d74… "EESO 405 POZO BORRADO", alta 15/9, saldo $276.450 (QUEDA)
--   * 92798f01… "escuela n 405 pozo borrado", alta 26/9, saldo $21.860 (SE VA)
-- Los dos ledgers cuadraban con su saldo antes de unificar. El duplicado tenía
-- 5 ventas, 5 débitos de CC, 5 comprobantes y 5 pedidos; ningún cobro, reserva,
-- presupuesto ni corrección de cobro.
--
-- Todo lo del duplicado pasa al que queda (cliente_id), el saldo se suma con
-- delta (276.450 + 21.860 = 298.310) y el duplicado se borra ya vacío. No se
-- toca venta_pagos (no tenía), así que la caja y el arqueo no se mueven.
-- Los comprobantes conservan el receptor congelado: solo cambia el vínculo.
--
-- Reversión: los ids de las filas movidas se pueden reconstruir por fecha y
-- monto desde este archivo; no hay reversión automática.

do $mig$
declare
  v_queda constant uuid := 'a0de0d74-d5ae-4b7a-87d1-701ab71de369';
  v_sale  constant uuid := '92798f01-4af8-499a-8d74-0fa8a07b90fe';
  v_negocio uuid;
  v_saldo_sale numeric;
  v_filas int;
begin
  -- Son exactamente las dos fichas revisadas, en el mismo negocio, con los
  -- saldos de cuando se revisaron.
  select c.negocio_id into v_negocio
    from clientes c join negocios n on n.id = c.negocio_id
   where c.id = v_queda and n.nombre = 'Librería Colores'
     and c.nombre = 'EESO 405 POZO BORRADO' and c.saldo_pendiente = 276450;
  if v_negocio is null then
    raise exception 'El cliente que queda no es el esperado: no se unifica nada';
  end if;

  select c.saldo_pendiente into v_saldo_sale
    from clientes c
   where c.id = v_sale and c.negocio_id = v_negocio
     and c.nombre = 'escuela n 405 pozo borrado' and c.saldo_pendiente = 21860;
  if v_saldo_sale is null then
    raise exception 'El duplicado no es el esperado: no se unifica nada';
  end if;

  -- Lo que este script no sabe mover: si aparece, frena.
  if exists (select 1 from venta_pagos where cliente_id = v_sale)
     or exists (select 1 from reservas where cliente_id = v_sale)
     or exists (select 1 from cobros_cc_correcciones where cliente_id = v_sale)
     or exists (select 1 from presupuestos where cliente_id = v_sale) then
    raise exception 'El duplicado tiene cobros, reservas, correcciones o presupuestos: revisar a mano';
  end if;

  -- Ledger del duplicado = su saldo (lo que se suma es deuda real).
  if (select coalesce(sum(case tipo when 'DEBITO' then monto else -monto end), 0)
        from cuenta_corriente_movimientos where cliente_id = v_sale) <> v_saldo_sale then
    raise exception 'El ledger del duplicado no cuadra con su saldo';
  end if;

  update ventas set cliente_id = v_queda where cliente_id = v_sale;
  get diagnostics v_filas = row_count;
  if v_filas <> 5 then raise exception 'Ventas movidas: % (se esperaban 5)', v_filas; end if;

  update cuenta_corriente_movimientos set cliente_id = v_queda where cliente_id = v_sale;
  get diagnostics v_filas = row_count;
  if v_filas <> 5 then raise exception 'Movimientos CC movidos: % (se esperaban 5)', v_filas; end if;

  update comprobantes set cliente_id = v_queda where cliente_id = v_sale;
  get diagnostics v_filas = row_count;
  if v_filas <> 5 then raise exception 'Comprobantes movidos: % (se esperaban 5)', v_filas; end if;

  update pedidos set cliente_id = v_queda where cliente_id = v_sale;
  get diagnostics v_filas = row_count;
  if v_filas <> 5 then raise exception 'Pedidos movidos: % (se esperaban 5)', v_filas; end if;

  update clientes set saldo_pendiente = saldo_pendiente + v_saldo_sale
   where id = v_queda;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'No se actualizó el saldo del cliente que queda'; end if;

  delete from clientes where id = v_sale;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'Se esperaba borrar 1 cliente y se borraron %', v_filas; end if;

  -- Resultado: saldo sumado y ledger del unificado cuadrando.
  if (select saldo_pendiente from clientes where id = v_queda) <> 298310 then
    raise exception 'El saldo unificado no es 298.310';
  end if;
  if (select coalesce(sum(case tipo when 'DEBITO' then monto else -monto end), 0)
        from cuenta_corriente_movimientos where cliente_id = v_queda) <> 298310 then
    raise exception 'El ledger unificado no cuadra con el saldo';
  end if;
  if (select count(*) from ventas where cliente_id = v_queda) <> 9 then
    raise exception 'El cliente unificado no quedó con 9 ventas';
  end if;
end
$mig$;
