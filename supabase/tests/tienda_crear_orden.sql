-- Test de 20261012162746_tienda_crear_orden.sql contra la base real, SIN dejar
-- nada: termina en `raise exception 'DRY_RUN_OK'`, que revierte todo. Cualquier
-- otro error es una falla. Usa el negocio demo `tienda-demo`.
--
-- Cubre: crear descuenta stock y espejo y deja el movimiento ORDEN_TIENDA;
-- sin stock no queda nada escrito; medio apagado, total que no cuadra y
-- variante de otro negocio se rechazan; vencer devuelve el stock UNA vez con
-- movimiento ORDEN_TIENDA_LIBERADA; anon lee las opciones pero no crea.

do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  v record; r jsonb; r2 jsonb; stock_antes numeric; espejo_antes numeric; s numeric; e numeric; cnt int;
begin
  update public.negocios set pagos_online_habilitado = true where id = n;
  update public.configuracion_pos set cobro_online_transferencia = true, alias_mercadopago_tienda = 'tienda.demo.mp',
         minutos_vence_transferencia = 120 where negocio_id = n;
  insert into public.mercadopago_conexiones (negocio_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, expira_en)
  values (n, '1', 'v1:a:b:c', 'v1:a:b:c', now() + interval '100 days')
  on conflict (negocio_id) do update set estado = 'ACTIVA';

  select vv.id, vv.producto_id, vv.nombre_display, vv.stock into v
    from public.producto_variantes vv join public.productos p on p.id = vv.producto_id
   where vv.negocio_id = n and vv.activa and p.publicado and vv.stock >= 3
     and exists (select 1 from public.productos_stock ps
                  where ps.producto_id = vv.producto_id and ps.variante = vv.nombre_display)
   order by vv.id limit 1;
  if v.id is null then raise exception 'SIN_VARIANTE_DE_PRUEBA'; end if;
  stock_antes := v.stock;
  select cantidad into espejo_antes from public.productos_stock
   where producto_id = v.producto_id and variante = v.nombre_display;

  -- 1. Crear: 2 unidades en dos renglones de la misma variante.
  r := public.crear_orden_tienda(n,
    jsonb_build_object('medio','TRANSFERENCIA','cliente_nombre','Prueba','cliente_telefono','1155550000',
      'modalidad_entrega','RETIRO','subtotal',200,'descuento',20,'recargo',0,'envio',0,'total',180,'ip_hash','abc'),
    jsonb_build_array(
      jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X','variante',v.nombre_display,
                         'precio_unitario',100,'cantidad',1,'subtotal',100),
      jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X','variante',v.nombre_display,
                         'precio_unitario',100,'cantidad',1,'subtotal',100)));
  if (r->>'numero')::int < 1 or r->>'alias' <> 'tienda.demo.mp' or length(r->>'token_publico') <> 48 then
    raise exception 'FALLA respuesta %', r;
  end if;
  select stock into s from public.producto_variantes where id = v.id;
  if s <> stock_antes - 2 then raise exception 'FALLA stock % -> %', stock_antes, s; end if;
  select cantidad into e from public.productos_stock where producto_id = v.producto_id and variante = v.nombre_display;
  if e <> greatest(0, espejo_antes - 2) then raise exception 'FALLA espejo % -> %', espejo_antes, e; end if;
  select count(*) into cnt from public.movimientos_stock
   where variante_id = v.id and origen = 'ORDEN_TIENDA' and referencia_id = (r->>'id')::uuid and delta = -2;
  if cnt <> 1 then raise exception 'FALLA movimiento ORDEN_TIENDA: %', cnt; end if;

  -- 1b. Mismo id otra vez (respuesta perdida, reintento): misma orden, stock intacto.
  r2 := public.crear_orden_tienda(n,
    jsonb_build_object('id', r->>'id', 'medio','TRANSFERENCIA','cliente_nombre','Prueba','cliente_telefono','1155550000',
      'modalidad_entrega','RETIRO','subtotal',200,'descuento',20,'recargo',0,'envio',0,'total',180),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X','variante','x',
      'precio_unitario',100,'cantidad',2,'subtotal',200)));
  if r2->>'numero' <> r->>'numero' or (r2->>'repetida')::boolean is not true then raise exception 'FALLA idempotencia %', r2; end if;
  if (select stock from public.producto_variantes where id = v.id) <> s then raise exception 'FALLA: el reintento movió stock'; end if;

  -- 2. Sin stock: pide una unidad más de lo que queda → nada escrito.
  select count(*) into cnt from public.ordenes_tienda where negocio_id = n;
  begin
    r2 := public.crear_orden_tienda(n,
      jsonb_build_object('medio','TRANSFERENCIA','cliente_nombre','Otra','cliente_telefono','1155550001',
        'modalidad_entrega','RETIRO','subtotal', s + 1,'descuento',0,'recargo',0,'envio',0,'total', s + 1),
      jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X','variante','x',
        'precio_unitario',1,'cantidad', s + 1,'subtotal', s + 1)));
    raise exception 'FALLA: vendió sin stock';
  exception when others then
    if sqlerrm <> 'SIN_STOCK' then raise; end if;
  end;
  if (select count(*) from public.ordenes_tienda where negocio_id = n) <> cnt then
    raise exception 'FALLA: quedó una orden sin stock';
  end if;
  if (select stock from public.producto_variantes where id = v.id) <> s then
    raise exception 'FALLA: el stock se movió en la orden fallida';
  end if;

  -- 3. Medio apagado, total que no cuadra, variante de otro negocio.
  begin
    perform public.crear_orden_tienda(n,
      jsonb_build_object('medio','MP_CHECKOUT','cliente_nombre','x','cliente_telefono','1155550002',
        'modalidad_entrega','RETIRO','subtotal',100,'descuento',0,'recargo',0,'envio',0,'total',100),
      jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X','variante','x',
        'precio_unitario',100,'cantidad',1,'subtotal',100)));
    raise exception 'FALLA: MP apagado aceptado';
  exception when others then if sqlerrm <> 'MEDIO_NO_DISPONIBLE' then raise; end if; end;
  begin
    perform public.crear_orden_tienda(n,
      jsonb_build_object('medio','TRANSFERENCIA','cliente_nombre','x','cliente_telefono','1155550002',
        'modalidad_entrega','RETIRO','subtotal',100,'descuento',0,'recargo',0,'envio',0,'total',1),
      jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X','variante','x',
        'precio_unitario',100,'cantidad',1,'subtotal',100)));
    raise exception 'FALLA: total que no cuadra aceptado';
  exception when check_violation then null; end;
  begin
    perform public.crear_orden_tienda(n,
      jsonb_build_object('medio','TRANSFERENCIA','cliente_nombre','x','cliente_telefono','1155550002',
        'modalidad_entrega','RETIRO','subtotal',100,'descuento',0,'recargo',0,'envio',0,'total',100),
      jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,
        'variante_id',(select id from public.producto_variantes where negocio_id <> n limit 1),
        'nombre','X','variante','x','precio_unitario',100,'cantidad',1,'subtotal',100)));
    raise exception 'FALLA: variante ajena aceptada';
  exception when others then if sqlerrm <> 'RENGLON_INVALIDO' then raise; end if; end;

  -- 4. Vencer: vuelve el stock una sola vez.
  update public.ordenes_tienda set vence_en = now() - interval '1 minute' where id = (r->>'id')::uuid;
  if public.liberar_ordenes_tienda_vencidas(n) <> 1 then raise exception 'FALLA: no liberó'; end if;
  if public.liberar_ordenes_tienda_vencidas(n) <> 0 then raise exception 'FALLA: liberó dos veces'; end if;
  if (select stock from public.producto_variantes where id = v.id) <> stock_antes then
    raise exception 'FALLA: el stock no volvió';
  end if;
  if (select estado from public.ordenes_tienda where id = (r->>'id')::uuid) <> 'VENCIDA' then
    raise exception 'FALLA estado';
  end if;
  select count(*) into cnt from public.movimientos_stock
   where variante_id = v.id and origen = 'ORDEN_TIENDA_LIBERADA' and referencia_id = (r->>'id')::uuid and delta = 2;
  if cnt <> 1 then raise exception 'FALLA movimiento LIBERADA: %', cnt; end if;

  -- 5. anon: lee las opciones, no crea.
  perform set_config('request.headers', json_build_object('x-negocio-slug','tienda-demo')::text, true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
  set local role anon;
  if (public.opciones_cobro_online()->>'transferencia')::boolean is not true
     or (public.opciones_cobro_online()->>'mercadopago')::boolean is not false then
    raise exception 'FALLA opciones %', public.opciones_cobro_online();
  end if;
  begin
    perform public.crear_orden_tienda(n, '{}'::jsonb, '[]'::jsonb);
    raise exception 'FALLA: anon llamó crear_orden_tienda';
  exception when insufficient_privilege then null; end;
  reset role;

  raise exception 'DRY_RUN_OK';
end $$;
