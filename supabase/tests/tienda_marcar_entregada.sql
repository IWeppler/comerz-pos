-- Test de 20261012190806_tienda_marcar_entregada.sql (correr la migración antes,
-- en la misma transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
-- Cubre: una pagada se entrega una vez (la segunda devuelve false), guarda quién
-- y cuándo, no toca la venta; deshacer la vuelve a PAGADA; una pendiente no se entrega.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid; v record; r jsonb; o record;
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;
  update public.configuracion_pos set cobro_online_mp = true where negocio_id = n;
  insert into public.mercadopago_conexiones (negocio_id, mp_user_id, access_token_cifrado, refresh_token_cifrado, expira_en)
  values (n, '1', 'v1:a:b:c', 'v1:a:b:c', now() + interval '100 days') on conflict (negocio_id) do update set estado = 'ACTIVA';
  select vv.id, vv.producto_id, vv.nombre_display, coalesce(vv.precio, p.precio) as precio into v
    from public.producto_variantes vv join public.productos p on p.id = vv.producto_id
   where vv.negocio_id = n and vv.activa and p.publicado and vv.stock >= 2 and coalesce(vv.precio, p.precio) > 0 order by vv.id limit 1;
  r := public.crear_orden_tienda(n,
    jsonb_build_object('medio','MP_CHECKOUT','cliente_nombre','E','cliente_telefono','5491155550099',
      'modalidad_entrega','RETIRO','subtotal',v.precio,'descuento',0,'recargo',0,'envio',0,'total',v.precio),
    jsonb_build_array(jsonb_build_object('producto_id',v.producto_id,'variante_id',v.id,'nombre','X',
      'variante',v.nombre_display,'precio_unitario',v.precio,'cantidad',1,'subtotal',v.precio)));
  perform public.aplicar_pago_mp_orden(n, (r->>'id')::uuid, 'MP_WEBHOOK',
    jsonb_build_object('mp_payment_id','99001','estado_mp','approved','monto',v.precio,'moneda','ARS'));

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;
  if not public.marcar_orden_entregada((r->>'id')::uuid) then raise exception 'FALLA entregar'; end if;
  if public.marcar_orden_entregada((r->>'id')::uuid) then raise exception 'FALLA entregar x2'; end if;
  reset role;
  select * into o from public.ordenes_tienda where id = (r->>'id')::uuid;
  if o.estado <> 'ENTREGADA' or o.entregada_por <> admin_u or o.entregada_en is null or o.venta_id is null then
    raise exception 'FALLA estado %', o.estado;
  end if;
  set local role authenticated;
  if not public.marcar_orden_entregada((r->>'id')::uuid, false) then raise exception 'FALLA deshacer'; end if;
  reset role;
  select * into o from public.ordenes_tienda where id = (r->>'id')::uuid;
  if o.estado <> 'PAGADA' or o.entregada_en is not null then raise exception 'FALLA deshacer estado'; end if;
  update public.ordenes_tienda set estado = 'PENDIENTE_PAGO' where id = o.id;
  set local role authenticated;
  if public.marcar_orden_entregada(o.id) then raise exception 'FALLA: entregó una pendiente'; end if;
  reset role;
  raise exception 'DRY_RUN_OK';
end $$;
