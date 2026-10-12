-- Test de 20261012162839_tienda_cobrar_orden.sql (necesita 20261012162746
-- aplicada o corrida antes en la misma transacción). Termina en
-- `raise exception 'DRY_RUN_OK'`: no deja nada. Usa el negocio `tienda-demo`.
--
-- Cubre: confirmar una transferencia crea venta + cobro + renglones (envío
-- como renglón libre, descuento prorrateado) y mueve el ledger a la cuenta de
-- MP de la tienda, sin turno, sin vendedor y SIN tocar stock; la segunda
-- confirmación es un no-op; el método de la tienda nace inactivo y no se puede
-- activar; sin `ventas.cobrar` no se confirma; cancelar devuelve el stock una
-- vez; una orden vencida no se cobra; anon lee la orden por token.

do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid;
  v record; r jsonb; c jsonb; c2 jsonb; s_antes numeric; s numeric; cnt int; venta record; mf numeric;
  r_cancel jsonb; pub jsonb;
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;

  update public.negocios set pagos_online_habilitado = true where id = n;
  update public.configuracion_pos set cobro_online_transferencia = true, alias_mercadopago_tienda = 'tienda.demo.mp',
         transferencia_titular = 'Tienda Demo', envio_costo_local = 1500 where negocio_id = n;
  insert into public.mercadopago_conexiones (negocio_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, expira_en)
  values (n, '1', 'v1:a:b:c', 'v1:a:b:c', now() + interval '100 days')
  on conflict (negocio_id) do update set estado = 'ACTIVA';

  select vv.id, vv.producto_id, vv.nombre_display, vv.stock into v
    from public.producto_variantes vv join public.productos p on p.id = vv.producto_id
   where vv.negocio_id = n and vv.activa and p.publicado and vv.stock >= 4
   order by vv.id limit 1;
  s_antes := v.stock;

  -- Orden: 2 unidades a $1000, descuento 200, envío 1500 → total 3300.
  r := public.crear_orden_tienda(n,
    jsonb_build_object('medio','TRANSFERENCIA','cliente_nombre','Prueba','cliente_telefono','5491155550000',
      'modalidad_entrega','ENVIO','localidad','Centro','direccion','Calle 1',
      'subtotal',2000,'descuento',200,'recargo',0,'envio',1500,'total',3300,
      'promociones_aplicadas', jsonb_build_array(jsonb_build_object('id', null, 'nombre', 'Promo de prueba', 'monto', 200))),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X',
      'variante',v.nombre_display,'precio_unitario',1000,'cantidad',2,'subtotal',2000)));
  select stock into s from public.producto_variantes where id = v.id;
  if s <> s_antes - 2 then raise exception 'FALLA stock al crear'; end if;

  -- anon lee la orden por token, con los datos para transferir.
  perform set_config('request.headers', json_build_object('x-negocio-slug','tienda-demo')::text, true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  pub := public.orden_tienda_publica(r->>'token_publico');
  if pub->>'estado' <> 'PENDIENTE_PAGO' or pub->>'alias' <> 'tienda.demo.mp' or (pub->>'total')::numeric <> 3300
     or jsonb_array_length(pub->'items') <> 1 then
    raise exception 'FALLA lectura pública %', pub;
  end if;
  if public.orden_tienda_publica(repeat('0', 48)) is not null then raise exception 'FALLA token inventado'; end if;
  begin
    perform public._registrar_venta_orden_tienda(n, (r->>'id')::uuid, 'MANUAL', null, '{}'::jsonb);
    raise exception 'FALLA: anon registró una venta';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Confirmar como ADMIN del negocio (sesión real).
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;
  c := public.confirmar_transferencia_orden((r->>'id')::uuid);
  c2 := public.confirmar_transferencia_orden((r->>'id')::uuid);
  reset role;
  if (c->>'ya_registrada')::boolean or not (c2->>'ya_registrada')::boolean or c->>'venta_id' <> c2->>'venta_id' then
    raise exception 'FALLA idempotencia de la confirmación % %', c, c2;
  end if;

  select * into venta from public.ventas where id = (c->>'venta_id')::uuid;
  if venta.total <> 3300 or venta.monto_cobrado <> 3300 or venta.monto_pendiente <> 0 or venta.estado_pago <> 'PAGADA'
     or venta.turno_caja_id is not null or venta.vendedor_id is not null or venta.negocio_id <> n
     or venta.metodo_pago <> 'TRANSFERENCIA' or venta.cantidad <> 2 then
    raise exception 'FALLA cabecera %', row_to_json(venta);
  end if;
  -- Renglones: mercadería con descuento prorrateado + envío libre; cierran contra el total.
  select count(*), sum(precio_final * cantidad) into cnt, mf from public.ventas_items where venta_id = venta.id;
  if cnt <> 2 or round(mf, 2) <> 3300 then raise exception 'FALLA renglones % %', cnt, mf; end if;
  if not exists (select 1 from public.ventas_items where venta_id = venta.id and es_venta_libre and variante = 'Envío' and precio_final = 1500) then
    raise exception 'FALLA renglón de envío';
  end if;
  if (select descuento_monto from public.ventas_items where venta_id = venta.id and not es_venta_libre) <> 100 then
    raise exception 'FALLA prorrateo del descuento';
  end if;
  -- Cobro con el método de la tienda (inactivo) y ledger a su cuenta.
  select count(*) into cnt from public.venta_pagos vp join public.metodos_pago m on m.id = vp.metodo_pago_id
   where vp.venta_id = venta.id and m.uso_tienda = 'TRANSFERENCIA_MP' and not m.activo
     and vp.monto_bruto = 3300 and vp.turno_caja_id is null and vp.tipo_movimiento = 'PAGO_VENTA';
  if cnt <> 1 then raise exception 'FALLA venta_pagos'; end if;
  select count(*) into cnt from public.movimientos_financieros mf2
    join public.venta_pagos vp on vp.id = mf2.origen_id
    join public.metodos_pago m on m.id = vp.metodo_pago_id
   where vp.venta_id = venta.id and mf2.cuenta_financiera_id = m.cuenta_destino_id and mf2.importe = 3300;
  if cnt <> 1 then raise exception 'FALLA ledger: %', cnt; end if;
  -- Stock: no se movió al cobrar.
  if (select stock from public.producto_variantes where id = v.id) <> s then raise exception 'FALLA: cobrar movió stock'; end if;
  if (select estado from public.ordenes_tienda where id = (r->>'id')::uuid) <> 'PAGADA' then raise exception 'FALLA estado orden'; end if;
  select count(*) into cnt from public.eventos_pago where orden_id = (r->>'id')::uuid and resultado = 'APLICADO' and origen = 'MANUAL';
  if cnt <> 1 then raise exception 'FALLA eventos aplicados: %', cnt; end if;

  -- El método de la tienda no se puede activar.
  begin
    update public.metodos_pago set activo = true where negocio_id = n and uso_tienda = 'TRANSFERENCIA_MP';
    raise exception 'FALLA: se activó el método de la tienda';
  exception when check_violation then null; end;

  -- Cancelar: otra orden, se cancela, el stock vuelve una vez.
  r_cancel := public.crear_orden_tienda(n,
    jsonb_build_object('medio','TRANSFERENCIA','cliente_nombre','Otra','cliente_telefono','5491155550001',
      'modalidad_entrega','RETIRO','subtotal',1000,'descuento',0,'recargo',0,'envio',0,'total',1000),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X',
      'variante',v.nombre_display,'precio_unitario',1000,'cantidad',1,'subtotal',1000)));
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.cancelar_orden_tienda((r_cancel->>'id')::uuid) then raise exception 'FALLA: no canceló'; end if;
  if public.cancelar_orden_tienda((r_cancel->>'id')::uuid) then raise exception 'FALLA: canceló dos veces'; end if;
  -- Una cancelada no se cobra.
  begin
    perform public.confirmar_transferencia_orden((r_cancel->>'id')::uuid);
    raise exception 'FALLA: cobró una cancelada';
  exception when others then if sqlerrm <> 'ORDEN_NO_COBRABLE' then raise; end if; end;
  reset role;
  if (select stock from public.producto_variantes where id = v.id) <> s then raise exception 'FALLA stock tras cancelar'; end if;

  -- Turno de conciliación: el primero gana, el segundo dentro de la ventana no.
  if not public.tomar_turno_conciliacion_mp(n, 30) then raise exception 'FALLA turno 1'; end if;
  if public.tomar_turno_conciliacion_mp(n, 30) then raise exception 'FALLA turno 2'; end if;

  raise exception 'DRY_RUN_OK';
end $$;
