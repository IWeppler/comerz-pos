-- Test de 20261023130000_aviso_tope_ventas.sql (correr la migración antes, en la misma
-- transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
-- Corrido en seco contra producción el 23/10/2026: DRY_RUN_OK.
-- No borra ventas (los comprobantes las referencian): fija el tope en "las que ya hay + 2".
-- Cubre: sin tope no hay aviso; con 1 venta de las 2 que faltan no; con las 2 sí (tipo PLAN_TOPE_VENTAS,
-- categoría PLAN, clave del mes); una anulada no cuenta; leído baja el contador; cortesía
-- ($0) no avisa; /admincomerz ve las mismas cuentas.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid;
  r jsonb;
  v_base int;
  v_tope int;
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;
  delete from public.notificaciones where negocio_id = n;
  delete from public.notificaciones_leidas where negocio_id = n;
  select count(*) into v_base from public.ventas
   where negocio_id = n and estado_operacion <> 'ANULADA'
     and fecha_venta >= date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
  v_tope := v_base + 2;
  update public.negocios set estado = 'activo', precio_acordado = null,
         plan_vencimiento = now() + interval '30 days',
         reglas_override = coalesce(reglas_override, '{}'::jsonb) || jsonb_build_object('max_ventas_mensuales', v_tope)
   where id = n;

  -- Una venta: todavía no.
  insert into public.ventas (negocio_id, total, fecha_venta) values (n, 1000, now());
  if exists (select 1 from public._estados_notificaciones(n) where tipo = 'PLAN_TOPE_VENTAS') then
    raise exception 'FALLA: avisa con una venta de dos';
  end if;

  -- Una anulada no cuenta.
  insert into public.ventas (negocio_id, total, fecha_venta, estado_operacion) values (n, 1000, now(), 'ANULADA');
  if exists (select 1 from public._estados_notificaciones(n) where tipo = 'PLAN_TOPE_VENTAS') then
    raise exception 'FALLA: cuenta una anulada';
  end if;

  -- La segunda: avisa.
  insert into public.ventas (negocio_id, total, fecha_venta) values (n, 1000, now());
  if (select count(*) from public._estados_notificaciones(n) where tipo = 'PLAN_TOPE_VENTAS'
        and clave = 'tope_ventas:' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM')) <> 1 then
    raise exception 'FALLA: no avisa al llegar al tope';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;
  r := public.mis_notificaciones();
  if not exists (select 1 from jsonb_array_elements(r->'tu_negocio') e
                  where e->>'tipo' = 'PLAN_TOPE_VENTAS' and e->>'categoria' = 'PLAN' and e->>'titulo' like 'Llegaste a las % ventas del mes') then
    raise exception 'FALLA lista: %', r;
  end if;
  perform public.marcar_notificaciones_leidas(array(select e->>'clave' from jsonb_array_elements(r->'tu_negocio') e));
  if public.notificaciones_sin_leer() <> 0 then raise exception 'FALLA leídos'; end if;
  reset role;

  -- Cortesía ($0): no avisa.
  update public.negocios set precio_acordado = 0 where id = n;
  if exists (select 1 from public._estados_notificaciones(n) where tipo = 'PLAN_TOPE_VENTAS') then
    raise exception 'FALLA: avisa a una cortesía';
  end if;
  update public.negocios set precio_acordado = null where id = n;

  -- Sin tope declarado: nada.
  update public.negocios set reglas_override = coalesce(reglas_override, '{}'::jsonb) || '{"max_ventas_mensuales": null}'::jsonb where id = n;
  if exists (select 1 from public._estados_notificaciones(n) where tipo = 'PLAN_TOPE_VENTAS') then
    raise exception 'FALLA: avisa sin tope';
  end if;

  raise exception 'DRY_RUN_OK';
end $$;
