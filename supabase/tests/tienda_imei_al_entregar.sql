-- Test de 20261012194147_tienda_imei_al_entregar.sql (correr la migración antes,
-- en la misma transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
--
-- Cubre: 2 celulares iguales se graban en 2 renglones de 1 (sumando lo mismo);
-- entregar sin IMEI frena; con un IMEI que estaba en stock (disponible → vendido)
-- y otro que no estaba cargado (nace vendido) entrega y no mueve stock; un IMEI ya
-- vendido frena; un IMEI de más frena.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid; v record; r jsonb; r2 jsonb; o record; s numeric; items uuid[]; cnt int; tot numeric;
  disp uuid; item3 uuid;
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;
  update public.configuracion_pos set cobro_online_mp = true where negocio_id = n;
  insert into public.mercadopago_conexiones (negocio_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, expira_en)
  values (n, '1', 'v1:a:b:c', 'v1:a:b:c', now() + interval '100 days') on conflict (negocio_id) do update set estado = 'ACTIVA';

  select vv.id, vv.producto_id, vv.nombre_display, coalesce(vv.precio, p.precio) as precio into v
    from public.producto_variantes vv join public.productos p on p.id = vv.producto_id
   where vv.negocio_id = n and vv.activa and p.publicado and vv.stock >= 4 and coalesce(vv.precio, p.precio) > 0
   order by vv.id limit 1;
  update public.productos set lleva_serie = true where id = v.producto_id;
  insert into public.unidades_serie (negocio_id, producto_variante_id, imei, estado)
  values (n, v.id, 'TESTIMEI0001', 'disponible') returning id into disp;

  r := public.crear_orden_tienda(n,
    jsonb_build_object('medio','MP_CHECKOUT','cliente_nombre','I','cliente_telefono','5491155550077',
      'modalidad_entrega','RETIRO','subtotal',v.precio*2,'descuento',0,'recargo',0,'envio',0,'total',v.precio*2),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','Cel',
      'variante',v.nombre_display,'precio_unitario',v.precio,'cantidad',2,'subtotal',v.precio*2)));
  perform public.aplicar_pago_mp_orden(n, (r->>'id')::uuid, 'MP_WEBHOOK',
    jsonb_build_object('mp_payment_id','98001','estado_mp','approved','monto',v.precio*2,'moneda','ARS'));
  select * into o from public.ordenes_tienda where id = (r->>'id')::uuid;
  if o.estado <> 'PAGADA' then raise exception 'FALLA pago %', o.estado; end if;

  select count(*), sum(precio_final * cantidad), array_agg(id order by id) into cnt, tot, items
    from public.ventas_items where venta_id = o.venta_id and variante_id = v.id and cantidad = 1;
  if cnt <> 2 or tot <> v.precio * 2 then raise exception 'FALLA renglones por aparato: % %', cnt, tot; end if;
  if exists (select 1 from public.ventas_items where venta_id = o.venta_id and motivo_sin_imei is null and variante_id = v.id) then
    raise exception 'FALLA motivo sin IMEI';
  end if;
  s := (select stock from public.producto_variantes where id = v.id);

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;
  begin
    perform public.marcar_orden_entregada(o.id);
    raise exception 'FALLA: entregó sin IMEI';
  exception when others then if sqlerrm <> 'IMEI_FALTANTES' then raise; end if; end;
  begin
    perform public.marcar_orden_entregada(o.id, true, jsonb_build_array(
      jsonb_build_object('item_id', items[1], 'imei', 'testimei0001'),
      jsonb_build_object('item_id', items[2], 'imei', 'TESTIMEI0002'),
      jsonb_build_object('item_id', gen_random_uuid(), 'imei', 'TESTIMEI0003')));
    raise exception 'FALLA: aceptó un IMEI de más';
  exception when others then if sqlerrm <> 'IMEI_DE_MAS' then raise; end if; end;
  if not public.marcar_orden_entregada(o.id, true, jsonb_build_array(
       jsonb_build_object('item_id', items[1], 'imei', 'testimei0001'),
       jsonb_build_object('item_id', items[2], 'imei', 'TESTIMEI0002'))) then
    raise exception 'FALLA entregar';
  end if;
  reset role;

  if (select estado from public.ordenes_tienda where id = o.id) <> 'ENTREGADA' then raise exception 'FALLA estado'; end if;
  if (select estado || ':' || venta_id::text from public.unidades_serie where id = disp) <> 'vendido:' || o.venta_id::text then
    raise exception 'FALLA unidad disponible no pasó a vendida';
  end if;
  if not exists (select 1 from public.unidades_serie where negocio_id = n and imei = 'TESTIMEI0002' and estado = 'vendido' and venta_id = o.venta_id) then
    raise exception 'FALLA unidad nueva';
  end if;
  if (select count(*) from public.ventas_items where venta_id = o.venta_id and unidad_serie_id is not null) <> 2 then
    raise exception 'FALLA renglones sin unidad';
  end if;
  if (select stock from public.producto_variantes where id = v.id) <> s then raise exception 'FALLA: entregar movió stock'; end if;

  -- Otra orden con un IMEI ya vendido: frena.
  r2 := public.crear_orden_tienda(n,
    jsonb_build_object('medio','MP_CHECKOUT','cliente_nombre','J','cliente_telefono','5491155550078',
      'modalidad_entrega','RETIRO','subtotal',v.precio,'descuento',0,'recargo',0,'envio',0,'total',v.precio),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','Cel',
      'variante',v.nombre_display,'precio_unitario',v.precio,'cantidad',1,'subtotal',v.precio)));
  perform public.aplicar_pago_mp_orden(n, (r2->>'id')::uuid, 'MP_WEBHOOK',
    jsonb_build_object('mp_payment_id','98002','estado_mp','approved','monto',v.precio,'moneda','ARS'));
  select id into item3 from public.ventas_items
   where venta_id = (select venta_id from public.ordenes_tienda where id = (r2->>'id')::uuid) and variante_id = v.id;
  set local role authenticated;
  begin
    perform public.marcar_orden_entregada((r2->>'id')::uuid, true,
      jsonb_build_array(jsonb_build_object('item_id', item3, 'imei', 'TESTIMEI0001')));
    raise exception 'FALLA: usó un IMEI vendido';
  exception when others then if sqlerrm <> 'IMEI_NO_DISPONIBLE' then raise; end if; end;
  reset role;

  raise exception 'DRY_RUN_OK';
end $$;
