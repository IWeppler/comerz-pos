-- Clientes e historial para la tienda DEMO de kiosco (`kiosco-demo`).
--
-- Corre DESPUÉS de seed-demo-kiosco.sql.
--
-- Mismo motor que seed-demo-historial.sql (las fórmulas salen de
-- create-sale.ts y están explicadas allá), con la diferencia que define al
-- rubro: acá el volumen está en la CANTIDAD de tickets, no en su tamaño. Un
-- kiosco hace decenas de ventas chicas por día, casi todas en efectivo y casi
-- todas SIN identificar al cliente — por eso el 70% de las ventas de este
-- historial no tiene `cliente_id`.
--
-- Ese detalle no es decorativo: es exactamente el sesgo que documenta
-- AGENTS.md ("al cliente solo se lo identifica cuando se le fía"), y una demo
-- que muestre 100% de ventas identificadas enseñaría un dato que el POS no
-- produce en la realidad.
--
-- Diferencias con el historial de indumentaria, todas del rubro:
--   * sin descuentos de mostrador — en un kiosco el precio es el precio;
--   * sin recargo por fiar (`cc_recargo_default` queda en 0): el fiado del
--     barrio no se recarga, y ese 0 es un DATO (distinto de null, que sería
--     "no se sabe");
--   * sin tarjeta de crédito: se cobra en efectivo, débito o billetera.
--
-- El guion se GENERA en vez de escribirse a mano: 110 tickets escritos uno por
-- uno serían 110 líneas imposibles de revisar. Todo sale de `hashtext` sobre
-- el número de venta, así que es pseudoaleatorio pero DETERMINÍSTICO: dos
-- corridas producen el mismo historial.
--
-- Se planta si el negocio ya tiene ventas: no hay clave natural que evite
-- duplicar un ticket.

do $$
declare
  v_negocio   uuid;
  v_vendedor  uuid;
  v_slug      text := 'kiosco-demo';
  v_ventas    int  := 110;
  v_dias      int  := 44;
  v_plazo     int  := 30;
  v           record;
  r_dia       record;
  v_venta_id  uuid;
  v_turno     uuid;
  v_subtotal  numeric;
  v_costo     numeric;
  v_unidades  numeric;
  v_base_ef   numeric;
  v_base_otro numeric;
  v_recargo_metodo numeric;
  v_comision  numeric;
  v_bruto     numeric;
  v_total     numeric;
  v_cobrado   numeric;
  v_pendiente numeric;
  v_metodo    record;
  v_metodo_ef uuid;
  v_numero    bigint;
  v_metodo_txt text;
  v_cliente   uuid;
begin
  select id into v_negocio from public.negocios where slug = v_slug;
  if v_negocio is null then
    raise exception 'No existe el negocio con slug %', v_slug;
  end if;

  select usuario_id into v_vendedor
  from public.usuarios_negocios
  where negocio_id = v_negocio and es_owner
  limit 1;

  if exists (select 1 from public.ventas where negocio_id = v_negocio) then
    raise notice 'El kiosco demo ya tiene ventas: no se vuelve a cargar.';
    return;
  end if;

  ---------------------------------------------------------------------------
  -- 1. Métodos de pago
  ---------------------------------------------------------------------------
  -- Sin tarjeta de crédito a propósito: en un kiosco no se financia una
  -- compra de $4.000. Débito y billetera con sus comisiones reales, que es lo
  -- que hace que `rentabilidad_por_metodo` tenga algo que comparar.
  insert into public.metodos_pago (negocio_id, nombre, tipo, comision, recargo_porcentaje, acreditacion_dias, activo)
  select v_negocio, t.nombre, t.tipo, t.comision, 0, t.dias, true
  from (values
      ('Efectivo',      'EFECTIVO',          0.0, 0),
      ('Débito',        'TARJETA',           1.2, 1),
      ('Mercado Pago',  'BILLETERA_VIRTUAL', 2.9, 2),
      ('Transferencia', 'TRANSFERENCIA',     0.0, 0)
    ) as t(nombre, tipo, comision, dias)
  where not exists (
    select 1 from public.metodos_pago m
    where m.negocio_id = v_negocio and m.nombre = t.nombre
  );

  select id into v_metodo_ef from public.metodos_pago
  where negocio_id = v_negocio and tipo = 'EFECTIVO' limit 1;

  ---------------------------------------------------------------------------
  -- 2. Clientes
  ---------------------------------------------------------------------------
  -- Los cinco del barrio, con el perfil que tiene sentido en un kiosco: dos
  -- vecinos que llevan fiado, una remisería que compra bebidas y cigarrillos
  -- todos los días, la cooperadora de la escuela (única fiscal, Exenta) y una
  -- clienta de paso que igual quedó cargada.
  create temp table _cli (idx int, nombre text, telefono text, dni text, email text,
                          direccion_comercial text, cuit text, razon_social text,
                          condicion_iva text, direccion text, localidad text,
                          provincia text, notas text) on commit drop;
  insert into _cli values
    (1,'Norma Beltrán','3415551201','11223344',null,'Ayacucho 3420',null,null,null,null,'Rosario','Santa Fe','Vecina. Lleva el diario y la leche, paga los viernes.'),
    (2,'Remisería La Estrella','3415551202',null,'remiseria.laestrella@example.com','Ayacucho 3510',null,null,null,null,'Rosario','Santa Fe','Cuenta corriente. Bebidas y cigarrillos para los choferes.'),
    (3,'Coop. Escuela N° 12','3415551203',null,'cooperadora12@example.com','Ayacucho 3600','30701234568','Asociación Cooperadora Escuela N° 12','Exento','Ayacucho 3600','Rosario','Santa Fe','Compra para actos y kermeses. Pide comprobante.'),
    (4,'Julián Rossi','3415551204','38445566',null,'Mendoza 4180',null,null,null,null,'Rosario','Santa Fe','Vecino del edificio de enfrente.'),
    (5,'Sofía Medina','3415551205','40112233',null,'Ayacucho 3388',null,null,null,null,'Rosario','Santa Fe','Pasa a la mañana camino al trabajo.');

  insert into public.clientes (negocio_id, nombre, telefono, dni, email, direccion_comercial,
                               cuit, razon_social, condicion_iva, direccion, localidad, provincia,
                               notas, activo, saldo_pendiente)
  select v_negocio, c.nombre, c.telefono, c.dni, c.email, c.direccion_comercial,
         c.cuit, c.razon_social, c.condicion_iva, c.direccion, c.localidad, c.provincia,
         c.notas, true, 0
  from _cli c
  where not exists (
    select 1 from public.clientes ex
    where ex.negocio_id = v_negocio and ex.nombre = c.nombre
  );

  ---------------------------------------------------------------------------
  -- 3. Guion generado
  ---------------------------------------------------------------------------
  -- `s` es la semilla de cada ticket. Todo lo que decide la venta —día, hora,
  -- si hay cliente, con qué se paga, qué se lleva— sale de ella, así que el
  -- historial es reproducible y no depende de random().
  create temp table _guion on commit drop as
  select
    i as v_num,
    abs(hashtext('kiosco-venta-' || i)) as s,
    v_dias - ((i * v_dias) / v_ventas) as dias,
    -- 60% de los tickets con UN renglón, 30% con dos, 10% con tres. No es
    -- 1-a-3 parejo: en un kiosco el ticket típico es una cosa sola, y un
    -- reparto uniforme infla el ticket promedio hasta un número que ningún
    -- kiosquero reconoce como propio.
    case
      when abs(hashtext('kiosco-items-' || i)) % 10 < 6 then 1
      when abs(hashtext('kiosco-items-' || i)) % 10 < 9 then 2
      else 3
    end as n_items
  from generate_series(1, v_ventas) as i;

  -- 30% de los tickets con cliente. El resto es la venta de mostrador que no
  -- pregunta el nombre, que es como funciona el rubro.
  create temp table _guion2 on commit drop as
  select
    g.v_num, g.s, g.dias, g.n_items,
    make_interval(hours => 9 + ((g.s / 3) % 13), mins => (g.s / 5) % 60) as hora,
    g.cli_calc as cli,
    case
      when (g.s / 11) % 100 < 72 then 'EF'
      when (g.s / 11) % 100 < 86 then 'DEB'
      when (g.s / 11) % 100 < 95 then 'MP'
      else 'CC'
    end as forma_cruda,
    -- El fiado NO sale del sorteo general. Con 30% de tickets identificados y
    -- un 5% de cuenta corriente, la probabilidad conjunta es 1,5%: sobre 110
    -- ventas eso da cero o una, y un kiosco de barrio sin libreta no existe.
    -- Fían los DOS clientes que fían: la vecina de la vuelta y la remisería.
    (g.cli_calc in (1, 2) and (g.s / 13) % 100 < 40) as fia
  from (
    select g0.*, case when g0.s % 100 < 30 then 1 + ((g0.s / 7) % 5) else null end as cli_calc
    from _guion g0
  ) g;

  -- Fiar sin cliente identificado no existe: sin nombre no hay a quién
  -- cobrarle. Cuando el sorteo da CC y el ticket es anónimo, se cobra.
  -- Fiar sin cliente identificado no existe: sin nombre no hay a quién
  -- cobrarle. Por eso `fia` ya viene condicionado al cliente, y una 'CC' del
  -- sorteo general que cayó en un ticket anónimo se cobra.
  create temp table _guion3 on commit drop as
  select v_num, s, dias, n_items, hora, cli,
         case
           when fia then 'CC'
           when forma_cruda = 'CC' and cli is null then 'EF'
           else forma_cruda
         end as forma
  from _guion2;

  -- Los renglones: 1 a 3 productos por ticket, elegidos por hash, con la
  -- variante de más stock de cada uno. Precio y costo salen de la VARIANTE si
  -- los tiene (los sueltos por peso) y del producto si no.
  create temp table _items on commit drop as
  select
    g.v_num,
    pr.id as producto_id,
    pv.id as variante_id,
    pv.nombre_display as variante,
    -- La cantidad depende de CÓMO se vende ese producto, no del rubro.
    -- Fraccionable (el fiambre, el queso, los caramelos a granel): un peso de
    -- balanza, con tres decimales. Por unidad: de a UNA el 75% de las veces —
    -- se lleva un alfajor, no tres.
    (case
      when pr.unidad_medida in ('KG','GRAMO','LITRO','METRO') then
        (array[0.100,0.150,0.200,0.250,0.300,0.400,0.500,0.750,1.000])[
          1 + abs(hashtext('kg-' || g.v_num || '-' || pr.slug)) % 9]
      when abs(hashtext('q-' || g.v_num || '-' || pr.slug)) % 20 < 15 then 1
      when abs(hashtext('q-' || g.v_num || '-' || pr.slug)) % 20 < 19 then 2
      else 3
    end)::numeric as cantidad,
    coalesce(pv.precio, pr.precio) as precio_unitario,
    coalesce(pv.costo, pr.precio_costo) as precio_costo,
    0::numeric as descuento_monto,
    coalesce(pv.precio, pr.precio) as precio_final
  from _guion3 g
  cross join lateral (
    select p.id, p.slug, p.precio, p.precio_costo, p.unidad_medida
    from public.productos p
    where p.negocio_id = v_negocio
    order by hashtext(p.slug || '-' || g.v_num)
    limit g.n_items
  ) pr
  join lateral (
    select id, nombre_display, precio, costo
    from public.producto_variantes
    where producto_id = pr.id
    order by stock desc, nombre_display
    limit 1
  ) pv on true;

  -- Reposición previa, igual que en el otro demo: el catálogo se cargó con el
  -- stock de una semana y el historial consume 45 días.
  perform set_config('comerz.origen_movimiento', 'IMPORTACION', true);

  -- El colchón de reposición va en la unidad del producto: 12 unidades de
  -- alfajores es media caja, pero 12 KILOS de salame es un despropósito. Para
  -- lo fraccionable alcanza con 2 kg de sobra.
  update public.producto_variantes pv
     set stock = d.necesario + case when pr.unidad_medida in ('KG','GRAMO','LITRO','METRO') then 2 else 12 end
    from (select variante_id, sum(cantidad) as necesario from _items group by variante_id) d,
         public.productos pr
   where pv.id = d.variante_id
     and pr.id = pv.producto_id
     and pv.stock < d.necesario + case when pr.unidad_medida in ('KG','GRAMO','LITRO','METRO') then 2 else 12 end;

  update public.productos_stock ps
     set cantidad = pv.stock
    from public.producto_variantes pv
   where pv.negocio_id = v_negocio
     and ps.producto_id = pv.producto_id
     and ps.variante = pv.nombre_display
     and ps.cantidad <> pv.stock;

  ---------------------------------------------------------------------------
  -- 4. Las ventas
  ---------------------------------------------------------------------------
  for v in select * from _guion3 order by v_num loop
    select coalesce(sum(precio_final * cantidad), 0),
           coalesce(sum(precio_costo  * cantidad), 0),
           coalesce(sum(cantidad), 0)
      into v_subtotal, v_costo, v_unidades
    from _items where v_num = v.v_num;

    -- El total se redondea al peso y el costo a dos decimales: con renglones
    -- por peso el subtotal sale con centavos (0,150 kg × $16.500 = $2.475,
    -- pero 0,300 × $7.200 = $2.160 y 0,750 × $9.800 = $7.350 no siempre caen
    -- redondos). El POS cobra en pesos enteros, así que la cabecera también.
    v_subtotal := round(v_subtotal);
    v_costo    := round(v_costo, 2);

    v_cliente := null;
    if v.cli is not null then
      select c.id into v_cliente from public.clientes c
      where c.negocio_id = v_negocio and c.nombre = (select nombre from _cli where idx = v.cli);
    end if;

    -- Sin recargo por fiar y sin descuentos: el total del ticket es la
    -- mercadería y nada más.
    v_base_ef   := case when v.forma = 'EF' then v_subtotal else 0 end;
    v_base_otro := case when v.forma in ('DEB','MP') then v_subtotal else 0 end;

    v_metodo_txt := case v.forma
      when 'EF'  then 'EFECTIVO'
      when 'DEB' then 'TARJETA'
      when 'MP'  then 'TARJETA'
      else 'CUENTA_CORRIENTE' end;

    select * into v_metodo from public.metodos_pago
    where negocio_id = v_negocio
      and nombre = case v.forma when 'DEB' then 'Débito' when 'MP' then 'Mercado Pago' else 'Efectivo' end
    limit 1;

    v_recargo_metodo := 0;
    v_total     := v_subtotal;
    v_cobrado   := v_base_ef + v_base_otro;
    v_pendiente := v_subtotal - v_cobrado;

    insert into public.ventas (
      negocio_id, vendedor_id, cliente_id, turno_caja_id, fecha_venta, estado_operacion,
      metodo_pago, total, precio_costo, cantidad, total_bruto, recargo_metodo_total,
      comision_total, total_neto, es_pago_mixto, monto_cobrado, monto_pendiente,
      estado_pago, recargo_cc_porcentaje, recargo_cc_monto, fecha_vencimiento
    )
    values (
      v_negocio, v_vendedor, v_cliente, null,
      date_trunc('day', now()) - (v.dias || ' days')::interval + v.hora,
      'CONFIRMADA', v_metodo_txt, v_total, v_costo, v_unidades, v_total, 0,
      0, 0, false, v_cobrado, greatest(v_pendiente, 0),
      case when v_pendiente > 0.05 then 'PARCIAL' else 'PAGADA' end,
      0, 0,
      case when v_pendiente > 0.05
        then (date_trunc('day', now()) - (v.dias || ' days')::interval)::date + v_plazo
        else null end
    )
    returning id into v_venta_id;

    insert into public.ventas_items (
      negocio_id, venta_id, producto_id, variante, variante_id, cantidad,
      precio_unitario, precio_costo, descuento_monto, precio_final
    )
    select v_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.cantidad,
           i.precio_unitario, i.precio_costo, i.descuento_monto, i.precio_final
    from _items i where i.v_num = v.v_num;

    if v_base_ef > 0 then
      insert into public.venta_pagos (
        negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
        monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
        comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
        turno_caja_id, creado_en
      )
      select v_negocio, v_venta_id, v_metodo_ef, 'Efectivo', 'EFECTIVO',
             v_base_ef, 0, 0, v_base_ef, 0, 0, v_base_ef, 0, null, ve.fecha_venta
      from public.ventas ve where ve.id = v_venta_id;
    end if;

    if v_base_otro > 0 then
      v_bruto    := v_base_otro;
      v_comision := round(v_bruto * coalesce(v_metodo.comision, 0) / 100);

      insert into public.venta_pagos (
        negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
        monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
        comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
        turno_caja_id, creado_en
      )
      select v_negocio, v_venta_id, v_metodo.id, v_metodo.nombre, v_metodo.tipo,
             v_base_otro, 0, 0, v_bruto,
             v_metodo.comision, v_comision, v_bruto - v_comision, v_metodo.acreditacion_dias,
             null, ve.fecha_venta
      from public.ventas ve where ve.id = v_venta_id;

      update public.ventas
         set comision_total = v_comision, total_neto = v_bruto - v_comision
       where id = v_venta_id;
    else
      update public.ventas set comision_total = 0, total_neto = v_base_ef where id = v_venta_id;
    end if;

    if v_pendiente > 0.05 then
      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
        monto_recargo, recargo_porcentaje, creado_en
      )
      select v_negocio, v_cliente, v_venta_id, 'DEBITO', v_pendiente,
             'Venta a cuenta corriente', v_vendedor, 0, 0, ve.fecha_venta
      from public.ventas ve where ve.id = v_venta_id;

      update public.clientes c
         set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + v_pendiente,
             fecha_vencimiento_deuda = ve.fecha_vencimiento
        from public.ventas ve
       where ve.id = v_venta_id and c.id = v_cliente;
    end if;

    perform set_config('comerz.origen_movimiento', 'VENTA', true);
    perform set_config('comerz.referencia_movimiento', v_venta_id::text, true);

    update public.producto_variantes pv
       set stock = pv.stock - i.cantidad
      from _items i
     where i.v_num = v.v_num and pv.id = i.variante_id;

    update public.productos_stock ps
       set cantidad = ps.cantidad - i.cantidad
      from _items i
     where i.v_num = v.v_num and ps.producto_id = i.producto_id and ps.variante = i.variante;

    v_numero := null;
    update public.comprobante_numeracion
       set ultimo_numero = ultimo_numero + 1, actualizado_en = now()
     where negocio_id = v_negocio and punto_venta = 1 and tipo = 'TICKET'
    returning ultimo_numero into v_numero;

    if v_numero is null then
      insert into public.comprobante_numeracion (negocio_id, punto_venta, tipo, ultimo_numero, actualizado_en)
      values (v_negocio, 1, 'TICKET', 1, now())
      returning ultimo_numero into v_numero;
    end if;

    -- El receptor va congelado y puede ser NULL: la mayoría de los tickets de
    -- un kiosco no tienen a quién nombrar, y eso es correcto, no un dato que
    -- falte.
    insert into public.comprobantes (
      negocio_id, venta_id, tipo, punto_venta, numero, cliente_id,
      receptor_razon_social, receptor_cuit, receptor_condicion_iva,
      neto, iva_monto, total, emitido_por, emitido_en
    )
    select v_negocio, v_venta_id, 'TICKET', 1, v_numero, ve.cliente_id,
           coalesce(c.razon_social, c.nombre), c.cuit, c.condicion_iva,
           0, 0, v_total, v_vendedor, ve.fecha_venta
    from public.ventas ve
    left join public.clientes c on c.id = ve.cliente_id
    where ve.id = v_venta_id;
  end loop;

  ---------------------------------------------------------------------------
  -- 5. Pagos de cuenta corriente
  ---------------------------------------------------------------------------
  -- La remisería paga a fin de mes y Norma los viernes: dos cobros a cuenta,
  -- sin imputar a un ticket (la base no sabe cuál saldaron).
  declare
    v_cli_pago uuid;
    v_pago_id  uuid;
    v_fecha_p  timestamptz;
    r          record;
  begin
    for r in
      select * from (values
        ('Remisería La Estrella', 4),
        ('Norma Beltrán',         9)
      ) as t(cliente, dias)
    loop
      select id into v_cli_pago from public.clientes
      where negocio_id = v_negocio and nombre = r.cliente;

      -- Se paga la MITAD del saldo, redondeada al peso: un pago a cuenta que
      -- cancela todo dejaría la demo sin deuda viva que mostrar.
      select round(coalesce(saldo_pendiente, 0) / 2) into v_pendiente
      from public.clientes where id = v_cli_pago;

      continue when coalesce(v_pendiente, 0) <= 0;

      v_fecha_p := date_trunc('day', now()) - (r.dias || ' days')::interval + interval '19 hours';

      insert into public.venta_pagos (
        negocio_id, venta_id, cliente_id, metodo_pago_id, metodo_nombre, metodo_tipo,
        monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
        comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
        tipo_movimiento, turno_caja_id, creado_en
      )
      values (v_negocio, null, v_cli_pago, v_metodo_ef, 'Efectivo', 'EFECTIVO',
              v_pendiente, 0, 0, v_pendiente, 0, 0, v_pendiente, 0,
              'PAGO_CUENTA_CORRIENTE', null, v_fecha_p)
      returning id into v_pago_id;

      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, pago_id, tipo, monto, descripcion, creado_por, creado_en
      )
      values (v_negocio, v_cli_pago, v_pago_id, 'CREDITO', v_pendiente,
              'Pago a cuenta - Efectivo', v_vendedor, v_fecha_p);

      update public.clientes
         set saldo_pendiente = greatest(coalesce(saldo_pendiente, 0) - v_pendiente, 0)
       where id = v_cli_pago;
    end loop;
  end;

  ---------------------------------------------------------------------------
  -- 6. Turnos de caja
  ---------------------------------------------------------------------------
  -- Se insertan al final y ya cerrados, por los dos frenos de la base: solo
  -- puede haber UN turno abierto por vendedor, y un turno cerrado es
  -- inmutable. Ver el comentario largo en seed-demo-historial.sql.
  for r_dia in
    select (p.creado_en at time zone 'UTC')::date as dia,
           coalesce(sum(p.monto_bruto) filter (where p.metodo_tipo = 'EFECTIVO'), 0) as efectivo
    from public.venta_pagos p
    where p.negocio_id = v_negocio and p.turno_caja_id is null
    group by 1 order by 1
  loop
    insert into public.turnos_caja (
      negocio_id, vendedor_id, usuario_id, abierta_por, cerrada_por,
      fecha_apertura, fecha_cierre, monto_inicial,
      efectivo_esperado, monto_final, monto_declarado, diferencia, estado, modo
    )
    values (
      v_negocio, v_vendedor, v_vendedor, v_vendedor, v_vendedor,
      r_dia.dia + interval '8 hours', r_dia.dia + interval '22 hours', 20000,
      20000 + r_dia.efectivo, 20000 + r_dia.efectivo, 20000 + r_dia.efectivo, 0,
      'CERRADO', 'UNICA'
    )
    returning id into v_turno;

    update public.ventas set turno_caja_id = v_turno
     where negocio_id = v_negocio and turno_caja_id is null
       and (fecha_venta at time zone 'UTC')::date = r_dia.dia;

    update public.venta_pagos set turno_caja_id = v_turno
     where negocio_id = v_negocio and turno_caja_id is null
       and (creado_en at time zone 'UTC')::date = r_dia.dia;
  end loop;

  raise notice 'Historial de kiosco cargado en %', v_slug;
end $$;
