-- Test de 20261012171038_tienda_estados_pago_mp.sql (corre la migración antes,
-- en la misma transacción). Termina en `raise exception 'DRY_RUN_OK'`: no deja
-- nada. Usa el negocio `tienda-demo`.
--
-- Cubre: pending → EN_PROCESO (repetido = DUPLICADO); rejected lo devuelve a
-- PENDIENTE_PAGO; approved con otro monto → REVISAR; approved exacto → venta una
-- vez, el mismo aviso otra vez no hace nada, otro pago aprobado = PAGO_DUPLICADO;
-- refunded → REEMBOLSADA sin tocar venta ni stock; approved sobre una orden
-- vencida → PAGADA_SIN_STOCK sin re-descontar; la gracia de 30 min de MP;
-- authenticated no puede llamarla.

do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  v record; precio numeric; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; res text; s numeric; o record; cnt int;
  pago jsonb;
begin
  update public.negocios set pagos_online_habilitado = true where id = n;
  update public.configuracion_pos set cobro_online_mp = true where negocio_id = n;
  insert into public.mercadopago_conexiones (negocio_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, expira_en)
  values (n, '1', 'v1:a:b:c', 'v1:a:b:c', now() + interval '100 days')
  on conflict (negocio_id) do update set estado = 'ACTIVA';

  select vv.id, vv.producto_id, vv.nombre_display, vv.stock, coalesce(vv.precio, p.precio) as precio into v
    from public.producto_variantes vv join public.productos p on p.id = vv.producto_id
   where vv.negocio_id = n and vv.activa and p.publicado and vv.stock >= 5 and coalesce(vv.precio, p.precio) > 0
   order by vv.id limit 1;
  precio := v.precio;

  -- Cuatro órdenes de MP de una unidad.
  select x into r1 from public.crear_orden_tienda(n,
    jsonb_build_object('medio','MP_CHECKOUT','cliente_nombre','A','cliente_telefono','5491155550010',
      'modalidad_entrega','RETIRO','subtotal',precio,'descuento',0,'recargo',0,'envio',0,'total',precio),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X',
      'variante',v.nombre_display,'precio_unitario',precio,'cantidad',1,'subtotal',precio))) x;
  select x into r2 from public.crear_orden_tienda(n,
    jsonb_build_object('medio','MP_CREDITO','cliente_nombre','B','cliente_telefono','5491155550011',
      'modalidad_entrega','RETIRO','subtotal',precio,'descuento',0,'recargo',0,'envio',0,'total',precio),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X',
      'variante',v.nombre_display,'precio_unitario',precio,'cantidad',1,'subtotal',precio))) x;
  select x into r3 from public.crear_orden_tienda(n,
    jsonb_build_object('medio','MP_CHECKOUT','cliente_nombre','C','cliente_telefono','5491155550012',
      'modalidad_entrega','RETIRO','subtotal',precio,'descuento',0,'recargo',0,'envio',0,'total',precio),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X',
      'variante',v.nombre_display,'precio_unitario',precio,'cantidad',1,'subtotal',precio))) x;
  select x into r4 from public.crear_orden_tienda(n,
    jsonb_build_object('medio','MP_CHECKOUT','cliente_nombre','D','cliente_telefono','5491155550013',
      'modalidad_entrega','RETIRO','subtotal',precio,'descuento',0,'recargo',0,'envio',0,'total',precio),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X',
      'variante',v.nombre_display,'precio_unitario',precio,'cantidad',1,'subtotal',precio))) x;
  s := (select stock from public.producto_variantes where id = v.id);
  if s <> v.stock - 4 then raise exception 'FALLA stock al crear'; end if;

  -- ─── Orden 1: pending, rejected, approved con otro monto ───
  pago := jsonb_build_object('mp_payment_id','9001','estado_mp','pending','monto',precio,'moneda','ARS');
  res := public.aplicar_pago_mp_orden(n, (r1->>'id')::uuid, 'MP_WEBHOOK', pago);
  if res <> 'APLICADO' or (select estado from public.ordenes_tienda where id = (r1->>'id')::uuid) <> 'EN_PROCESO' then
    raise exception 'FALLA pending: %', res;
  end if;
  if public.aplicar_pago_mp_orden(n, (r1->>'id')::uuid, 'SISTEMA', pago) <> 'DUPLICADO' then raise exception 'FALLA pending x2'; end if;
  res := public.aplicar_pago_mp_orden(n, (r1->>'id')::uuid, 'MP_WEBHOOK', pago || '{"estado_mp":"rejected"}');
  select * into o from public.ordenes_tienda where id = (r1->>'id')::uuid;
  if res <> 'APLICADO' or o.estado <> 'PENDIENTE_PAGO' or o.mp_payment_id is not null then raise exception 'FALLA rejected: %', res; end if;
  res := public.aplicar_pago_mp_orden(n, (r1->>'id')::uuid, 'MP_WEBHOOK',
    jsonb_build_object('mp_payment_id','9002','estado_mp','approved','monto',precio - 1,'moneda','ARS'));
  select * into o from public.ordenes_tienda where id = (r1->>'id')::uuid;
  if res <> 'RECHAZADO_MONTO' or o.estado <> 'REVISAR' or o.venta_id is not null then raise exception 'FALLA monto distinto: %', res; end if;
  res := public.aplicar_pago_mp_orden(n, (r1->>'id')::uuid, 'MP_WEBHOOK',
    jsonb_build_object('mp_payment_id','9003','estado_mp','approved','monto',precio,'moneda','USD'));
  if res <> 'RECHAZADO_MONTO' then raise exception 'FALLA moneda: %', res; end if;

  -- ─── Orden 2: approved exacto, repetido, segundo pago, reembolso ───
  pago := jsonb_build_object('mp_payment_id','9101','estado_mp','approved','monto',precio,'moneda','ARS',
                             'comision_monto', round(precio * 0.0629, 2), 'resumen', '{"payment_type_id":"digital_currency"}'::jsonb);
  res := public.aplicar_pago_mp_orden(n, (r2->>'id')::uuid, 'MP_WEBHOOK', pago);
  select * into o from public.ordenes_tienda where id = (r2->>'id')::uuid;
  if res <> 'APLICADO' or o.estado <> 'PAGADA' or o.venta_id is null or o.mp_payment_id <> '9101' then
    raise exception 'FALLA approved: % %', res, o.estado;
  end if;
  if (select comision_total from public.ventas where id = o.venta_id) <> round(precio * 0.0629, 2) then
    raise exception 'FALLA comisión real';
  end if;
  if public.aplicar_pago_mp_orden(n, (r2->>'id')::uuid, 'SISTEMA', pago) <> 'DUPLICADO' then raise exception 'FALLA approved x2'; end if;
  perform public.aplicar_pago_mp_orden(n, (r2->>'id')::uuid, 'MP_WEBHOOK', pago || '{"mp_payment_id":"9102"}');
  select count(*) into cnt from public.ventas where id = o.venta_id;
  if cnt <> 1 or (select count(*) from public.eventos_pago where orden_id = o.id and resultado = 'PAGO_DUPLICADO') <> 1 then
    raise exception 'FALLA segundo pago';
  end if;
  res := public.aplicar_pago_mp_orden(n, (r2->>'id')::uuid, 'MP_WEBHOOK', pago || '{"estado_mp":"refunded"}');
  if res <> 'APLICADO' or (select estado from public.ordenes_tienda where id = o.id) <> 'REEMBOLSADA'
     or (select estado_operacion from public.ventas where id = o.venta_id) <> 'CONFIRMADA' then
    raise exception 'FALLA refunded: %', res;
  end if;
  -- El reembolso de OTRO pago no toca la orden.
  if public.aplicar_pago_mp_orden(n, (r2->>'id')::uuid, 'MP_WEBHOOK', pago || '{"mp_payment_id":"9102","estado_mp":"charged_back"}') <> 'IGNORADO' then
    raise exception 'FALLA contracargo ajeno';
  end if;
  if (select stock from public.producto_variantes where id = v.id) <> s then raise exception 'FALLA: pagar movió stock'; end if;

  -- ─── Orden 3: vence (pasada la gracia) y después llega el pago ───
  update public.ordenes_tienda set vence_en = now() - interval '31 minutes' where id = (r3->>'id')::uuid;
  -- ─── Orden 4: dentro de la gracia, no vence ───
  update public.ordenes_tienda set vence_en = now() - interval '10 minutes' where id = (r4->>'id')::uuid;
  perform public.liberar_ordenes_tienda_vencidas(n);
  if (select estado from public.ordenes_tienda where id = (r3->>'id')::uuid) <> 'VENCIDA'
     or (select estado from public.ordenes_tienda where id = (r4->>'id')::uuid) <> 'PENDIENTE_PAGO' then
    raise exception 'FALLA gracia';
  end if;
  s := s + 1;
  if (select stock from public.producto_variantes where id = v.id) <> s then raise exception 'FALLA stock al vencer'; end if;
  res := public.aplicar_pago_mp_orden(n, (r3->>'id')::uuid, 'MP_WEBHOOK',
    jsonb_build_object('mp_payment_id','9201','estado_mp','approved','monto',precio,'moneda','ARS'));
  select * into o from public.ordenes_tienda where id = (r3->>'id')::uuid;
  if res <> 'APLICADO' or o.estado <> 'PAGADA_SIN_STOCK' or o.venta_id is not null or o.mp_payment_id <> '9201' then
    raise exception 'FALLA pagada sin stock: % %', res, o.estado;
  end if;
  if (select stock from public.producto_variantes where id = v.id) <> s then raise exception 'FALLA: re-descontó stock'; end if;
  -- Un pending sobre una vencida no la revive.
  if public.aplicar_pago_mp_orden(n, (r4->>'id')::uuid, 'MP_WEBHOOK',
       jsonb_build_object('mp_payment_id','9301','estado_mp','pending')) <> 'APLICADO' then
    raise exception 'FALLA pending orden 4';
  end if;

  -- ─── Permisos ───
  set local role authenticated;
  begin
    perform public.aplicar_pago_mp_orden(n, (r4->>'id')::uuid, 'MP_WEBHOOK', pago);
    raise exception 'FALLA: authenticated aplicó un pago';
  exception when insufficient_privilege then null; end;
  reset role;

  raise exception 'DRY_RUN_OK';
end $$;
