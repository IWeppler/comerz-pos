-- Librería Colores: unifica el cliente duplicado de la escuela 842 (6/10/2026,
-- pedido de Ignacio).
--
-- Dos fichas con el mismo teléfono (3491504006):
--   * 0e7576b1… "ESCUELA N°842 GREGORIA PEREZ DE DENIS", alta 15/9, saldo
--     $136.530 (QUEDA)
--   * 49ab5f91… "escuela n842 el nochero", alta 19/9, saldo $0 (SE VA)
-- El duplicado solo tenía 1 pedido: ni ventas, ni cuenta corriente, ni cobros,
-- comprobantes, reservas, presupuestos ni correcciones. El pedido pasa al que
-- queda y el duplicado se borra vacío. Saldo, caja y ledger no se mueven.

do $mig$
declare
  v_queda constant uuid := '0e7576b1-7416-4e92-bda3-7dac9659ea4b';
  v_sale  constant uuid := '49ab5f91-962f-40f3-9e0f-c90f71c275b6';
  v_negocio uuid;
  v_filas int;
begin
  select c.negocio_id into v_negocio
    from clientes c join negocios n on n.id = c.negocio_id
   where c.id = v_queda and n.nombre = 'Librería Colores'
     and c.nombre = 'ESCUELA N°842 GREGORIA PEREZ DE DENIS';
  if v_negocio is null then
    raise exception 'El cliente que queda no es el esperado: no se unifica nada';
  end if;

  if not exists (select 1 from clientes
                  where id = v_sale and negocio_id = v_negocio
                    and nombre = 'escuela n842 el nochero' and saldo_pendiente = 0) then
    raise exception 'El duplicado no es el esperado: no se unifica nada';
  end if;

  -- Solo sabe mover el pedido: cualquier otra cosa frena.
  if exists (select 1 from ventas where cliente_id = v_sale)
     or exists (select 1 from venta_pagos where cliente_id = v_sale)
     or exists (select 1 from cuenta_corriente_movimientos where cliente_id = v_sale)
     or exists (select 1 from comprobantes where cliente_id = v_sale)
     or exists (select 1 from reservas where cliente_id = v_sale)
     or exists (select 1 from presupuestos where cliente_id = v_sale)
     or exists (select 1 from cobros_cc_correcciones where cliente_id = v_sale) then
    raise exception 'El duplicado tiene más que un pedido: revisar a mano';
  end if;

  update pedidos set cliente_id = v_queda where cliente_id = v_sale;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'Pedidos movidos: % (se esperaba 1)', v_filas; end if;

  delete from clientes where id = v_sale;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'Se esperaba borrar 1 cliente y se borraron %', v_filas; end if;

  if (select saldo_pendiente from clientes where id = v_queda) <> 136530
     or (select count(*) from pedidos where cliente_id = v_queda) <> 2 then
    raise exception 'El cliente unificado no quedó como se esperaba';
  end if;
end
$mig$;
