-- Clientes con historial para la tienda DEMO de indumentaria.
--
-- Corre DESPUÉS de seed-demo-indumentaria.sql: las ventas necesitan catálogo.
--
-- Por qué las ventas se escriben acá a mano en vez de llamar a
-- `registrar_venta`: la RPC toma la fecha de `now()` (es lo correcto para una
-- venta de verdad) y un historial necesita fechas repartidas en semanas. Lo
-- que SÍ se copia de la RPC, paso por paso, es qué tablas toca y con qué
-- números — cabecera, pagos, renglones, deuda de cuenta corriente, espejo
-- legacy y comprobante. Las fórmulas salen de create-sale.ts:
--
--   subtotal          = Σ (precio_final unitario × cantidad)
--   recargo_cc        = subtotal × pct/100        (solo cuenta corriente)
--   total_ticket      = subtotal + recargo_cc
--   por cada cobro    : bruto = base + base × recargo%, comisión sobre el
--                       BRUTO, neto = bruto − comisión
--   ventas.total      = total_ticket + Σ recargos de método
--   monto_cobrado     = Σ bases + Σ recargos de método
--   monto_pendiente   = total_ticket − Σ bases   (la deuda NO incluye el
--                       recargo del método: ese es plata del cobro)
--
-- Y las dos trampas de unidades que están documentadas en AGENTS.md:
--   * `ventas.cantidad` son UNIDADES (Σ cantidades), no renglones;
--   * `ventas.precio_costo` es el costo TOTAL, mientras que las columnas de
--     `ventas_items` son UNITARIAS.
--
-- Idempotente por un camino distinto al del catálogo: acá no hay una clave
-- natural que evite duplicar una venta, así que el script se planta si el
-- negocio ya tiene ventas con cliente. Para recargarlo hay que borrar antes.

do $$
declare
  v_negocio   uuid;
  v_vendedor  uuid;
  v_slug      text := 'nombre-de-prueba2';
  v_pct_cc    numeric := 10;   -- recargo por fiar, en línea con el 15% de Evens
  v_plazo     int := 30;
  v          record;
  v_venta_id uuid;
  v_turno    uuid;
  v_fecha    timestamptz;
  v_subtotal numeric;
  v_costo    numeric;
  v_unidades numeric;
  v_recargo_cc numeric;
  v_total_ticket numeric;
  v_base_ef  numeric;
  v_base_otro numeric;
  v_recargo_metodo numeric;
  v_comision numeric;
  v_neto     numeric;
  v_bruto    numeric;
  v_total    numeric;
  v_cobrado  numeric;
  v_pendiente numeric;
  v_metodo   record;
  v_metodo_ef uuid;
  v_numero   bigint;
  v_metodo_pago_txt text;
  r_dia      record;
begin
  select id into v_negocio from public.negocios where slug = v_slug;
  if v_negocio is null then
    raise exception 'No existe el negocio con slug %', v_slug;
  end if;

  select usuario_id into v_vendedor
  from public.usuarios_negocios
  where negocio_id = v_negocio and es_owner
  limit 1;

  if exists (select 1 from public.ventas where negocio_id = v_negocio and cliente_id is not null) then
    raise notice 'El demo ya tiene ventas con cliente: no se vuelve a cargar.';
    return;
  end if;

  -- Fiar tiene precio. Sin esto las ventas de cuenta corriente entran con
  -- recargo 0 y la demo no puede mostrar la comparación entre fiar y cobrar
  -- con tarjeta, que es el punto de `rentabilidad_por_metodo`.
  update public.configuracion_pos set cc_recargo_default = v_pct_cc where negocio_id = v_negocio;

  ---------------------------------------------------------------------------
  -- 1. Métodos de pago
  ---------------------------------------------------------------------------
  -- El demo tenía solo Efectivo, y con un solo método el módulo Dinero no
  -- tiene nada que mostrar: ni comisiones, ni plata por acreditar, ni el
  -- ranking por medio. Los porcentajes son de mercado, no inventados a ojo.
  -- Ojo con Crédito: 10% de recargo contra 3,5% de comisión. NO son la misma
  -- cuenta — la comisión se cobra sobre el bruto y el recargo se calcula sobre
  -- la base, así que empatar un 3,5% de comisión pide 3,63% de recargo.
  insert into public.metodos_pago (negocio_id, nombre, tipo, comision, recargo_porcentaje, acreditacion_dias, activo)
  select v_negocio, t.nombre, t.tipo, t.comision, t.recargo, t.dias, true
  from (values
      ('Débito',        'TARJETA',           1.2,  0.0,  1),
      ('Crédito',       'TARJETA',           3.5, 10.0, 18),
      ('Transferencia', 'TRANSFERENCIA',     0.0,  0.0,  0),
      ('Mercado Pago',  'BILLETERA_VIRTUAL', 2.9,  0.0,  2)
    ) as t(nombre, tipo, comision, recargo, dias)
  where not exists (
    select 1 from public.metodos_pago m
    where m.negocio_id = v_negocio and m.nombre = t.nombre
  );

  select id into v_metodo_ef from public.metodos_pago
  where negocio_id = v_negocio and tipo = 'EFECTIVO' limit 1;

  ---------------------------------------------------------------------------
  -- 2. Clientes
  ---------------------------------------------------------------------------
  -- Uno solo es fiscal (`es_fiscal` en la UI): razón social, CUIT y domicilio
  -- fiscal. El CUIT tiene el dígito verificador correcto — la app lo valida
  -- por módulo 11 en el form Y en la action, así que uno inventado no se
  -- podría ni editar desde la pantalla después.
  -- `direccion_comercial` (dónde se le entrega) es OTRA columna que
  -- `direccion` (el domicilio fiscal que va en la factura).
  create temp table _cli (idx int, nombre text, telefono text, dni text, email text,
                          direccion_comercial text, cuit text, razon_social text,
                          condicion_iva text, direccion text, localidad text,
                          provincia text, notas text) on commit drop;
  insert into _cli values
    (1,'Carla Giménez','3415550101','32456789','carla.gimenez@example.com','Mitre 1240, Rosario',null,null,null,null,'Rosario','Santa Fe','Compra para ella y para regalo. Talle 40.'),
    (2,'Marina Suárez','3415550102','28112233','marina.suarez@example.com','San Lorenzo 875, Rosario',null,null,null,null,'Rosario','Santa Fe','Cliente de cuenta corriente. Paga a fin de mes.'),
    (3,'Roxana Paredes','3415550103','35998877',null,'Córdoba 2310, Rosario',null,null,null,null,'Rosario','Santa Fe','Fía y paga en cuotas.'),
    (4,'Diego Ferreyra','3415550104','30554466','diego.ferreyra@example.com','Pellegrini 1502, Rosario',null,null,null,null,'Rosario','Santa Fe','Siempre paga con tarjeta.'),
    (5,'Estudio Vidal SRL','3415550105',null,'compras@estudiovidal.example','Santa Fe 1650, piso 3, Rosario','30712345671','Estudio Vidal S.R.L.','Responsable Inscripto','Santa Fe 1650, piso 3','Rosario','Santa Fe','Compra indumentaria para el equipo. Pide factura.');

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
  -- 3. Guion del historial
  ---------------------------------------------------------------------------
  -- `forma` decide con qué se cobró. 'CC' es fiado: entrega parcial en
  -- efectivo (o cero) y el resto a la cuenta.
  create temp table _guion (v_num int, dias int, hora interval, cli int, forma text, entrega numeric) on commit drop;
  insert into _guion values
    ( 1,42,'11:20','1','EF',   0),
    ( 2,40,'17:05','5','TRA',  0),
    ( 3,38,'12:40','2','DEB',  0),
    ( 4,35,'18:15','1','DEB',  0),
    ( 5,33,'10:50','3','EF',   0),
    ( 6,30,'19:30','4','CRE',  0),
    ( 7,28,'16:10','1','EF',   0),
    ( 8,24,'11:05','2','MIX',  0),
    ( 9,22,'15:45','5','TRA',  0),
    (10,21,'12:20','3','MP',   0),
    (11,19,'17:50','1','DEB',  0),
    (12,17,'13:30','4','TRA',  0),
    (13,15,'11:40','2','CC',   0),
    (14,12,'18:05','3','CC',   30000),
    (15,11,'16:25','1','EF',   0),
    (16, 9,'10:35','5','TRA',  0),
    (17, 8,'19:10','4','MP',   0),
    (18, 6,'12:15','2','CC',   0),
    (19, 5,'17:40','3','DEB',  0),
    (20, 3,'11:55','1','EF',   0);

  create temp table _guion_items (v_num int, producto_slug text, cantidad numeric, desc_pct numeric) on commit drop;
  insert into _guion_items values
    ( 1,'remera-basica-de-algodon',1,0),
    ( 1,'musculosa-morley',1,0),
    ( 2,'chomba-pique',4,10),
    ( 2,'camisa-de-lino',2,10),
    ( 3,'jean-mom-tiro-alto',1,0),
    ( 4,'vestido-midi-floreado',1,0),
    ( 4,'remera-basica-de-algodon',2,0),
    ( 5,'calza-de-nena-deportiva',2,0),
    ( 5,'remera-de-nene-estampada',1,0),
    ( 6,'campera-puffer-corta',1,0),
    ( 7,'musculosa-morley',1,10),
    ( 8,'saco-de-lana-oversize',1,0),
    ( 8,'palazo-de-lino',1,0),
    ( 9,'remera-lisa-cuello-redondo',6,10),
    (10,'vestido-de-nena-de-algodon',1,0),
    (10,'jogging-de-nene-de-frisa',1,0),
    (11,'blusa-de-saten-manga-larga',1,0),
    (12,'jean-recto-clasico',1,0),
    (12,'gorra-trucker',1,0),
    (13,'vestido-negro-de-fiesta',1,0),
    (13,'zapatilla-urbana-de-lona',1,0),
    (14,'campera-rompeviento',1,0),
    (14,'buzo-canguro-de-frisa',1,10),
    (15,'calza-deportiva-talle-alto',1,0),
    (16,'chomba-pique',3,0),
    (16,'pantalon-cargo-de-gabardina',2,10),
    (17,'mochila-urbana',1,0),
    (17,'zapatilla-urbana-de-lona',1,0),
    (18,'saco-de-lana-oversize',1,0),
    (18,'jogging-de-frisa-de-mujer',1,0),
    (19,'jogging-de-nene-de-frisa',1,0),
    (19,'vestido-de-nena-de-algodon',1,10),
    (20,'remera-basica-de-algodon',1,0),
    (20,'gorra-trucker',1,0);

  -- Los renglones ya resueltos contra el catálogo. La variante que se vende es
  -- la de MÁS stock del producto: es determinístico y evita dejar una en
  -- negativo. `descuento_monto` y `precio_final` son UNITARIOS, igual que los
  -- escribe el POS.
  create temp table _items on commit drop as
  select
    g.v_num,
    pr.id as producto_id,
    pv.id as variante_id,
    pv.nombre_display as variante,
    g.cantidad,
    pr.precio as precio_unitario,
    pr.precio_costo,
    round(pr.precio * g.desc_pct / 100) as descuento_monto,
    pr.precio - round(pr.precio * g.desc_pct / 100) as precio_final
  from _guion_items g
  join public.productos pr on pr.negocio_id = v_negocio and pr.slug = g.producto_slug
  join lateral (
    select id, nombre_display from public.producto_variantes
    where producto_id = pr.id
    order by stock desc, nombre_display
    limit 1
  ) pv on true;

  -- Reposición previa: el catálogo se sembró con 1 a 6 unidades por variante y
  -- el historial vende hasta 7 de una misma (la chomba entra en dos ventas del
  -- mismo cliente mayorista). Sin esto la demo arrancaría con variantes en
  -- negativo, que es un estado que el POS no puede producir. Va como
  -- IMPORTACION y ANTES de la primera venta, así el movimiento queda en orden.
  perform set_config('comerz.origen_movimiento', 'IMPORTACION', true);

  update public.producto_variantes pv
     set stock = d.necesario + 2
    from (
      select variante_id, sum(cantidad) as necesario
      from _items group by variante_id
    ) d
   where pv.id = d.variante_id and pv.stock < d.necesario + 2;

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
  for v in select * from _guion order by v_num loop
    v_fecha := date_trunc('day', now()) - (v.dias || ' days')::interval + v.hora;

    -- La venta nace SIN turno y se imputa al final (sección 6). Dos frenos de
    -- la base obligan a hacerlo en ese orden y no acá:
    --   * un índice único permite UN solo turno ABIERTO por vendedor y
    --     negocio, así que veinte días de historia no pueden pasar por ese
    --     estado ni por un instante;
    --   * un turno CERRADO es inmutable (trg_bloquear_edicion_turno_cerrado),
    --     o sea que tampoco se puede crear cerrado y corregirle los montos
    --     después.
    -- Queda una sola salida: calcular el efectivo del día primero e insertar
    -- el turno ya cerrado y ya cuadrado.
    v_turno := null;

    select coalesce(sum(precio_final * cantidad), 0),
           coalesce(sum(precio_costo  * cantidad), 0),
           coalesce(sum(cantidad), 0)
      into v_subtotal, v_costo, v_unidades
    from _items where v_num = v.v_num;

    v_recargo_cc := case when v.forma = 'CC' then round(v_subtotal * v_pct_cc / 100) else 0 end;
    v_total_ticket := v_subtotal + v_recargo_cc;

    -- Cuánto entra por cada medio. Las bases suman el ticket salvo en la
    -- venta fiada, donde lo que falta es justamente la deuda.
    v_base_ef := case
      when v.forma = 'EF'  then v_total_ticket
      when v.forma = 'MIX' then round(v_total_ticket * 0.4)
      when v.forma = 'CC'  then v.entrega
      else 0 end;
    v_base_otro := case
      when v.forma in ('DEB','CRE','TRA','MP') then v_total_ticket
      when v.forma = 'MIX' then v_total_ticket - round(v_total_ticket * 0.4)
      else 0 end;

    v_metodo_pago_txt := case v.forma
      when 'EF'  then 'EFECTIVO'
      when 'DEB' then 'TARJETA'
      when 'CRE' then 'TARJETA'
      when 'MP'  then 'TARJETA'
      when 'TRA' then 'TRANSFERENCIA'
      when 'MIX' then 'PAGO_MIXTO'
      else 'CUENTA_CORRIENTE' end;

    if v.forma = 'CC' and v.entrega > 0 then
      v_metodo_pago_txt := 'EFECTIVO';
    end if;

    select * into v_metodo from public.metodos_pago
    where negocio_id = v_negocio
      and nombre = case v.forma
            when 'DEB' then 'Débito'
            when 'CRE' then 'Crédito'
            when 'TRA' then 'Transferencia'
            when 'MP'  then 'Mercado Pago'
            when 'MIX' then 'Débito'
            else 'Efectivo' end
    limit 1;

    v_recargo_metodo := round(v_base_otro * coalesce(v_metodo.recargo_porcentaje, 0) / 100);
    v_total     := v_total_ticket + v_recargo_metodo;
    v_cobrado   := v_base_ef + v_base_otro + v_recargo_metodo;
    v_pendiente := v_total_ticket - (v_base_ef + v_base_otro);

    insert into public.ventas (
      negocio_id, vendedor_id, cliente_id, turno_caja_id, fecha_venta, estado_operacion,
      metodo_pago, total, precio_costo, cantidad, total_bruto, recargo_metodo_total,
      comision_total, total_neto, es_pago_mixto, monto_cobrado, monto_pendiente,
      estado_pago, recargo_cc_porcentaje, recargo_cc_monto,
      fecha_vencimiento
    )
    select
      v_negocio, v_vendedor, c.id, v_turno, v_fecha, 'CONFIRMADA',
      v_metodo_pago_txt, v_total, v_costo, v_unidades, v_total, v_recargo_metodo,
      0, 0, v.forma = 'MIX', v_cobrado, greatest(v_pendiente, 0),
      case when v_pendiente > 0.05 then 'PARCIAL' else 'PAGADA' end,
      case when v.forma = 'CC' then v_pct_cc else 0 end,
      v_recargo_cc,
      case when v_pendiente > 0.05 then (v_fecha at time zone 'UTC')::date + v_plazo else null end
    from public.clientes c
    where c.negocio_id = v_negocio and c.nombre = (select nombre from _cli where idx = v.cli)
    returning id into v_venta_id;

    insert into public.ventas_items (
      negocio_id, venta_id, producto_id, variante, variante_id, cantidad,
      precio_unitario, precio_costo, descuento_monto, precio_final
    )
    select v_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.cantidad,
           i.precio_unitario, i.precio_costo, i.descuento_monto, i.precio_final
    from _items i where i.v_num = v.v_num;

    -- Pagos. El efectivo nunca lleva recargo ni comisión; el resto sí, y la
    -- comisión se calcula SOBRE EL BRUTO (es lo que pasa por el posnet).
    if v_base_ef > 0 then
      insert into public.venta_pagos (
        negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
        monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
        comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
        turno_caja_id, creado_en
      )
      values (v_negocio, v_venta_id, v_metodo_ef, 'Efectivo', 'EFECTIVO',
              v_base_ef, 0, 0, v_base_ef, 0, 0, v_base_ef, 0, v_turno, v_fecha);
    end if;

    if v_base_otro > 0 then
      v_bruto    := v_base_otro + v_recargo_metodo;
      v_comision := round(v_bruto * coalesce(v_metodo.comision, 0) / 100);
      v_neto     := v_bruto - v_comision;

      insert into public.venta_pagos (
        negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
        monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
        comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
        turno_caja_id, creado_en
      )
      values (v_negocio, v_venta_id, v_metodo.id, v_metodo.nombre, v_metodo.tipo,
              v_base_otro, v_metodo.recargo_porcentaje, v_recargo_metodo, v_bruto,
              v_metodo.comision, v_comision, v_neto, v_metodo.acreditacion_dias,
              v_turno, v_fecha);

      update public.ventas
         set comision_total = v_comision, total_neto = v_bruto - v_comision + v_base_ef
       where id = v_venta_id;
    else
      update public.ventas
         set comision_total = 0, total_neto = v_base_ef
       where id = v_venta_id;
    end if;

    -- Deuda de cuenta corriente. El DEBITO va por lo que quedó pendiente, con
    -- el recargo por fiar guardado aparte: es lo que después permite contestar
    -- "cuánto de este fiado era mercadería y cuánto el precio de esperar".
    if v_pendiente > 0.05 then
      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
        monto_recargo, recargo_porcentaje, creado_en
      )
      select v_negocio, ve.cliente_id, v_venta_id, 'DEBITO', v_pendiente,
             'Venta a cuenta corriente', v_vendedor,
             least(v_recargo_cc, v_pendiente), v_pct_cc, v_fecha
      from public.ventas ve where ve.id = v_venta_id;

      update public.clientes c
         set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + v_pendiente,
             fecha_vencimiento_deuda = (v_fecha at time zone 'UTC')::date + v_plazo
        from public.ventas ve
       where ve.id = v_venta_id and c.id = ve.cliente_id;
    end if;

    -- Stock: la variante es la fuente canónica y `productos_stock` el espejo.
    -- El origen se declara por venta, así el movimiento queda atado a SU
    -- ticket y no al de la iteración anterior.
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

    -- Comprobante. TICKET interno: neto e iva en 0 (solo la Factura A
    -- discrimina IVA) y sin CAE, que es lo que el CHECK de la tabla exige.
    -- Los datos del receptor van CONGELADOS, no por join contra `clientes`.
    -- Se limpia antes: `returning ... into` deja el valor de la vuelta
    -- anterior si el UPDATE no toca ninguna fila, y ahí el `if` de abajo
    -- nunca entraría.
    v_numero := null;

    update public.comprobante_numeracion
       set ultimo_numero = ultimo_numero + 1, actualizado_en = v_fecha
     where negocio_id = v_negocio and punto_venta = 1 and tipo = 'TICKET'
    returning ultimo_numero into v_numero;

    if v_numero is null then
      insert into public.comprobante_numeracion (negocio_id, punto_venta, tipo, ultimo_numero, actualizado_en)
      values (v_negocio, 1, 'TICKET', 1, v_fecha)
      returning ultimo_numero into v_numero;
    end if;

    insert into public.comprobantes (
      negocio_id, venta_id, tipo, punto_venta, numero, cliente_id,
      receptor_razon_social, receptor_cuit, receptor_condicion_iva,
      neto, iva_monto, total, emitido_por, emitido_en
    )
    select v_negocio, v_venta_id, 'TICKET', 1, v_numero, c.id,
           coalesce(c.razon_social, c.nombre), c.cuit, c.condicion_iva,
           0, 0, v_total, v_vendedor, v_fecha
    from public.ventas ve
    join public.clientes c on c.id = ve.cliente_id
    where ve.id = v_venta_id;
  end loop;

  ---------------------------------------------------------------------------
  -- 5. Pagos de cuenta corriente
  ---------------------------------------------------------------------------
  -- Dos cobros a cuenta, para que la demo tenga deuda viva Y deuda que se
  -- viene pagando. No están imputados a una venta: la base no sabe qué ticket
  -- saldó cada pago, y por eso la antigüedad de saldo imputa FIFO y lo dice.
  declare
    v_cliente uuid;
    v_pago_id uuid;
    v_monto   numeric;
    v_fecha_p timestamptz;
    v_turno_p uuid;
    r         record;
  begin
    for r in
      select * from (values
        ('Roxana Paredes', 25000::numeric, 7),
        ('Marina Suárez',  40000::numeric, 2)
      ) as t(cliente, monto, dias)
    loop
      select id into v_cliente from public.clientes
      where negocio_id = v_negocio and nombre = r.cliente;

      v_fecha_p := date_trunc('day', now()) - (r.dias || ' days')::interval + interval '18 hours';
      v_monto := r.monto;

      -- Sin turno todavía, igual que las ventas: se imputa en la sección 6.
      -- El cobro de una deuda también entra al cajón, así que tiene que
      -- terminar en el turno de SU día o el arqueo de ese día queda corto.
      v_turno_p := null;

      insert into public.venta_pagos (
        negocio_id, venta_id, cliente_id, metodo_pago_id, metodo_nombre, metodo_tipo,
        monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
        comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
        tipo_movimiento, turno_caja_id, creado_en
      )
      values (v_negocio, null, v_cliente, v_metodo_ef, 'Efectivo', 'EFECTIVO',
              v_monto, 0, 0, v_monto, 0, 0, v_monto, 0,
              'PAGO_CUENTA_CORRIENTE', v_turno_p, v_fecha_p)
      returning id into v_pago_id;

      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, pago_id, tipo, monto, descripcion, creado_por, creado_en
      )
      values (v_negocio, v_cliente, v_pago_id, 'CREDITO', v_monto,
              'Pago a cuenta - Efectivo', v_vendedor, v_fecha_p);

      update public.clientes
         set saldo_pendiente = greatest(coalesce(saldo_pendiente, 0) - v_monto, 0)
       where id = v_cliente;
    end loop;
  end;

  ---------------------------------------------------------------------------
  -- 6. Cierre de los turnos
  ---------------------------------------------------------------------------
  -- El esperado se calcula con la misma fórmula del cierre real: lo que había
  -- al abrir más el EFECTIVO que entró. Lo cobrado con tarjeta no está en el
  -- cajón, así que no puede estar acá — contarlo es lo que hace cerrar un
  -- turno con faltante.
  -- Todos los turnos quedan CERRADOS salvo el de hoy, que es el que la demo
  -- necesita abierto para poder vender.
  -- Un turno por día, insertado YA cerrado y ya cuadrado, y recién después se
  -- le imputan las ventas y los cobros de ese día.
  --
  -- El esperado sale de la MISMA cuenta que el cierre real: lo que había al
  -- abrir más el EFECTIVO que entró. Lo cobrado con tarjeta no está en el
  -- cajón — sumarlo acá es exactamente lo que hace cerrar un turno con
  -- faltante. Un día de puras tarjetas cierra con el monto inicial y nada más,
  -- que es lo correcto.
  for r_dia in
    select (p.creado_en at time zone 'UTC')::date as dia,
           coalesce(sum(p.monto_bruto) filter (where p.metodo_tipo = 'EFECTIVO'), 0) as efectivo
    from public.venta_pagos p
    where p.negocio_id = v_negocio and p.turno_caja_id is null
    group by 1
    order by 1
  loop
    insert into public.turnos_caja (
      negocio_id, vendedor_id, usuario_id, abierta_por, cerrada_por,
      fecha_apertura, fecha_cierre, monto_inicial,
      efectivo_esperado, monto_final, monto_declarado, diferencia,
      estado, modo
    )
    values (
      v_negocio, v_vendedor, v_vendedor, v_vendedor, v_vendedor,
      r_dia.dia + interval '10 hours', r_dia.dia + interval '20 hours 30 minutes', 30000,
      30000 + r_dia.efectivo, 30000 + r_dia.efectivo, 30000 + r_dia.efectivo, 0,
      'CERRADO', 'UNICA'
    )
    returning id into v_turno;

    update public.ventas
       set turno_caja_id = v_turno
     where negocio_id = v_negocio and turno_caja_id is null
       and (fecha_venta at time zone 'UTC')::date = r_dia.dia;

    update public.venta_pagos
       set turno_caja_id = v_turno
     where negocio_id = v_negocio and turno_caja_id is null
       and (creado_en at time zone 'UTC')::date = r_dia.dia;
  end loop;

  -- El turno que quedó abierto de una prueba vieja se cierra: mientras exista,
  -- el índice único impide abrir caja hoy, que es lo primero que hace un
  -- vendedor cuando muestra el POS.
  update public.turnos_caja t
     set estado = 'CERRADO',
         fecha_cierre = date_trunc('day', t.fecha_apertura) + interval '20 hours 30 minutes',
         cerrada_por = v_vendedor,
         efectivo_esperado = t.monto_inicial + coalesce((
           select sum(p.monto_bruto) from public.venta_pagos p
           where p.turno_caja_id = t.id and p.metodo_tipo = 'EFECTIVO'
         ), 0),
         monto_final = t.monto_inicial + coalesce((
           select sum(p.monto_bruto) from public.venta_pagos p
           where p.turno_caja_id = t.id and p.metodo_tipo = 'EFECTIVO'
         ), 0),
         monto_declarado = t.monto_inicial + coalesce((
           select sum(p.monto_bruto) from public.venta_pagos p
           where p.turno_caja_id = t.id and p.metodo_tipo = 'EFECTIVO'
         ), 0),
         diferencia = 0,
         observacion_cierre = 'Cerrado al cargar el historial de la demo.'
   where t.negocio_id = v_negocio
     and t.estado = 'ABIERTO'
     and t.fecha_apertura::date < current_date;

  raise notice 'Historial demo cargado en %', v_slug;
end $$;
