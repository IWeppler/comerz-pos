-- Test de 20261013140623_notificaciones_tienda_y_debito.sql (correr la migración antes,
-- en la misma transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
-- Cubre: orden pagada por Mercado Pago avisa; una transferencia confirmada no; pagada
-- sin stock, revisar y contracargo avisan con su título; volver a un estado ya avisado
-- no duplica; débito de Mercado Pago avisa y un pago manual no.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  num int := coalesce((select max(numero) from public.ordenes_tienda where negocio_id = n), 0) + 1000;
  o_mp uuid; o_tr uuid; c int;
begin
  delete from public.notificaciones where negocio_id = n;

  insert into public.ordenes_tienda (negocio_id, numero, medio, cliente_nombre, cliente_telefono,
    modalidad_entrega, subtotal, total, vence_en)
  values (n, num, 'MP_CHECKOUT', 'Ana Prueba', '1155554444', 'RETIRO', 45000, 45000, now() + interval '1 hour')
  returning id into o_mp;
  insert into public.ordenes_tienda (negocio_id, numero, medio, cliente_nombre, cliente_telefono,
    modalidad_entrega, subtotal, total, vence_en)
  values (n, num + 1, 'TRANSFERENCIA', 'Beto Prueba', '1155553333', 'RETIRO', 1000, 1000, now() + interval '1 hour')
  returning id into o_tr;

  -- Mercado Pago acredita: aviso.
  update public.ordenes_tienda set estado = 'PAGADA' where id = o_mp;
  if not exists (select 1 from public.notificaciones where negocio_id = n and clave = 'orden:' || o_mp || ':PAGADA'
                   and tipo = 'ORDEN_PAGADA' and titulo = 'Venta online pagada'
                   and detalle like 'Orden #' || num || ' · $45.000 · Ana Prueba.%') then
    raise exception 'FALLA: no avisó la orden pagada por MP: %', (select jsonb_agg(x) from public.notificaciones x where negocio_id = n);
  end if;

  -- Transferencia confirmada por el negocio: no avisa.
  update public.ordenes_tienda set estado = 'PAGADA' where id = o_tr;
  if exists (select 1 from public.notificaciones where negocio_id = n and clave like 'orden:' || o_tr || '%') then
    raise exception 'FALLA: avisó una transferencia confirmada a mano';
  end if;

  -- Revisar, contracargo, pagada sin stock: avisan.
  update public.ordenes_tienda set estado = 'REVISAR' where id = o_tr;
  update public.ordenes_tienda set estado = 'CONTRACARGO' where id = o_mp;
  update public.ordenes_tienda set estado = 'PAGADA_SIN_STOCK' where id = o_tr;
  select count(*) into c from public.notificaciones where negocio_id = n;
  if c <> 4
     or not exists (select 1 from public.notificaciones where negocio_id = n and tipo = 'ORDEN_SIN_STOCK' and titulo = 'Pago de una orden vencida')
     or not exists (select 1 from public.notificaciones where negocio_id = n and tipo = 'ORDEN_REVISAR' and titulo = 'Contracargo de una venta online') then
    raise exception 'FALLA estados: % avisos', c;
  end if;

  -- Volver a REVISAR (ya avisado): actualiza el mismo, no duplica.
  update public.ordenes_tienda set estado = 'REVISAR' where id = o_tr;
  if (select count(*) from public.notificaciones where negocio_id = n) <> 4 then raise exception 'FALLA: duplicó'; end if;

  -- Débito de Mercado Pago: aviso. Pago manual: no.
  insert into public.pagos_suscripcion (negocio_id, monto, periodo_desde, periodo_hasta, medio, plan_nombre, mp_payment_id)
  values (n, 30000, current_date, current_date + 30, 'mercadopago', 'Plan Gestión', 'test-123');
  insert into public.pagos_suscripcion (negocio_id, monto, periodo_desde, periodo_hasta, medio, plan_nombre)
  values (n, 30000, current_date, current_date + 30, 'transferencia', 'Plan Gestión');
  if not exists (select 1 from public.notificaciones where negocio_id = n and clave = 'debito:test-123'
                   and tipo = 'DEBITO_COBRADO' and detalle like '$30.000 · Plan Gestión. Cubre hasta el %')
     or (select count(*) from public.notificaciones where negocio_id = n and tipo = 'DEBITO_COBRADO') <> 1 then
    raise exception 'FALLA débito: %', (select jsonb_agg(x) from public.notificaciones x where negocio_id = n and tipo = 'DEBITO_COBRADO');
  end if;

  raise exception 'DRY_RUN_OK';
end $$;
