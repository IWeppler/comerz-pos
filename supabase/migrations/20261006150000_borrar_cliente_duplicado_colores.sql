-- Librería Colores: borra el cliente duplicado AUGUSTO GOMEZ (6/10/2026, pedido
-- de Ignacio, opción "borrar directo" elegida a sabiendas).
--
-- Había dos AUGUSTO GOMEZ con el mismo teléfono (3491539127). Se borra el
-- creado el 15/9 (3054cea2…), que debía $11.550 en dos fiados reales:
--   * ticket 6d5573b9, 28/9, $10.800
--   * ticket 259404c0, 6/10, $750
-- Se ofreció combinarlo con el otro (2fd355db…, $53.500) para no perder la
-- deuda; se eligió borrar. Efecto, por las FK de `clientes`:
--   * cuenta_corriente_movimientos: los 2 débitos se borran (CASCADE). Esa
--     deuda deja de existir en el sistema.
--   * ventas y comprobantes: quedan, sin cliente (SET NULL). La plata vendida
--     y la caja no cambian.
--   * venta_pagos y reservas (CASCADE): verificado que no tenía ninguno, así
--     que el arqueo no se mueve. El guard de abajo lo exige.
--
-- No hay reversión automática: el cliente y sus movimientos se pueden
-- reconstruir desde este archivo (ids, montos, fechas) si hiciera falta.

do $mig$
declare
  v_cliente constant uuid := '3054cea2-80d8-4c82-acff-6e2ee84f6d64';
  v_ventas constant uuid[] := array[
    '6d5573b9-7269-4501-a59f-fd3ddd6dbee2',
    '259404c0-6b90-4527-8630-0509f22269db'
  ]::uuid[];
  v_filas int;
begin
  -- Es exactamente el cliente que se pidió borrar, y nada cambió desde que se
  -- revisó.
  if not exists (
    select 1
      from clientes c join negocios n on n.id = c.negocio_id
     where c.id = v_cliente
       and n.nombre = 'Librería Colores'
       and c.nombre = 'AUGUSTO GOMEZ'
       and c.saldo_pendiente = 11550
  ) then
    raise exception 'El cliente no es el esperado (otro nombre, negocio o saldo): no se borra nada';
  end if;

  -- Nada que borre plata en cascada.
  if exists (select 1 from venta_pagos where cliente_id = v_cliente)
     or exists (select 1 from reservas where cliente_id = v_cliente)
     or exists (select 1 from cobros_cc_correcciones where cliente_id = v_cliente) then
    raise exception 'El cliente tiene cobros, reservas o correcciones: borrarlo se los llevaría. No se borra.';
  end if;

  if (select count(*) from ventas where cliente_id = v_cliente) <> 2
     or (select count(*) from ventas where id = any (v_ventas) and cliente_id = v_cliente) <> 2 then
    raise exception 'Las ventas del cliente no son las dos revisadas: no se borra nada';
  end if;

  delete from clientes where id = v_cliente;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Se esperaba borrar 1 cliente y se borraron %', v_filas;
  end if;

  -- Las ventas siguen existiendo, ahora sin cliente.
  if (select count(*) from ventas where id = any (v_ventas) and cliente_id is null) <> 2 then
    raise exception 'Las dos ventas no quedaron intactas sin cliente';
  end if;
  if exists (select 1 from cuenta_corriente_movimientos where cliente_id = v_cliente) then
    raise exception 'Quedaron movimientos de cuenta corriente del cliente borrado';
  end if;
end
$mig$;
