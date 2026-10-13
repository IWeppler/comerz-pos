-- Test de 20261012201739_suscripciones_mp.sql (correr la migración antes, en la
-- misma transacción). Termina en DRY_RUN_OK: no deja nada.
-- Cubre: un cobro aprobado registra el pago y corre el vencimiento un mes desde
-- el vencimiento vigente; el mismo cobro dos veces no hace nada; un comercio en
-- prueba pasa a activo con el plan de la suscripción y el período arranca el día
-- del cobro si ya había vencido; una suscripción desconocida no escribe nada; solo
-- una viva por comercio; el comercio ve la suya y no la de otro.
do $$
declare
  click uuid := (select id from public.negocios where slug = 'clicktostado');
  demo uuid := (select id from public.negocios where slug = 'tienda-demo');
  gestion uuid := (select id from public.planes where nombre = 'Gestión');
  venc date; res text; n record; cnt int; admin_u uuid;
begin
  venc := (select (plan_vencimiento at time zone 'UTC')::date from public.negocios where id = click);
  insert into public.suscripciones_mp (negocio_id, preapproval_id, estado, plan_id, monto)
  values (click, 'pre_test_click', 'authorized', gestion, 30000);

  res := public.registrar_pago_suscripcion_mp('pre_test_click', 'pay_test_1', 30000, current_date);
  if res <> 'APLICADO' then raise exception 'FALLA aplicar: %', res; end if;
  select (plan_vencimiento at time zone 'UTC')::date as v, estado into n from public.negocios where id = click;
  if n.v <> (greatest(venc, current_date) + interval '1 month')::date then raise exception 'FALLA vencimiento % (antes %)', n.v, venc; end if;
  if public.registrar_pago_suscripcion_mp('pre_test_click', 'pay_test_1', 30000, current_date) <> 'DUPLICADO' then raise exception 'FALLA duplicado'; end if;
  select count(*) into cnt from public.pagos_suscripcion where mp_payment_id = 'pay_test_1';
  if cnt <> 1 then raise exception 'FALLA pagos %', cnt; end if;

  -- Comercio en prueba, vencido: arranca hoy, pasa a activo con Gestión.
  update public.negocios set estado = 'prueba', plan_vencimiento = now() - interval '3 days' where id = demo;
  insert into public.suscripciones_mp (negocio_id, preapproval_id, estado, plan_id, monto)
  values (demo, 'pre_test_demo', 'authorized', gestion, 50000);
  perform public.registrar_pago_suscripcion_mp('pre_test_demo', 'pay_test_2', 50000, current_date);
  select estado, plan_id, (plan_vencimiento at time zone 'UTC')::date as v into n from public.negocios where id = demo;
  if n.estado <> 'activo' or n.plan_id <> gestion or n.v <> (current_date + interval '1 month')::date then
    raise exception 'FALLA prueba→activo % %', n.estado, n.v;
  end if;

  if public.registrar_pago_suscripcion_mp('pre_no_existe', 'pay_test_3', 1, current_date) <> 'SUSCRIPCION_DESCONOCIDA' then
    raise exception 'FALLA desconocida';
  end if;

  begin
    insert into public.suscripciones_mp (negocio_id, preapproval_id, estado, monto) values (click, 'pre_test_click_2', 'pending', 30000);
    raise exception 'FALLA: dos vivas';
  exception when unique_violation then null; end;

  -- RLS: el admin de tienda-demo ve la suya y no la de ClickTostado.
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = demo and ro.nombre = 'ADMIN' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', demo)::text, true);
  set local role authenticated;
  if (select count(*) from public.suscripciones_mp) <> 1 then raise exception 'FALLA RLS'; end if;
  begin
    perform public.registrar_pago_suscripcion_mp('pre_test_demo', 'pay_x', 1, current_date);
    raise exception 'FALLA: authenticated registró un pago';
  exception when insufficient_privilege then null; end;
  reset role;

  raise exception 'DRY_RUN_OK';
end $$;
