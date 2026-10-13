-- Test de 20261013142607_notificaciones_estados.sql (correr la migración antes, en la
-- misma transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
-- Cubre: caja de otro día, transferencia por confirmar, remito sin conciliar y prueba
-- por terminar aparecen en la lista y en el contador; leídos dejan de contar; una
-- transferencia NUEVA vuelve a avisar (clave nueva); un estado resuelto desaparece.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid;
  num int := coalesce((select max(numero) from public.ordenes_tienda where negocio_id = n), 0) + 1000;
  t uuid; o1 uuid; r jsonb; claves text[];
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;
  delete from public.notificaciones where negocio_id = n;
  delete from public.notificaciones_leidas where negocio_id = n;

  -- Un turno abierto desde anteayer (un turno cerrado no se puede reabrir: trigger).
  insert into public.turnos_caja (negocio_id, vendedor_id, usuario_id, abierta_por, fecha_apertura, monto_inicial, estado)
  values (n, admin_u, admin_u, admin_u, now() - interval '2 days', 0, 'ABIERTO') returning id into t;
  -- Una transferencia esperando confirmación.
  insert into public.ordenes_tienda (negocio_id, numero, medio, cliente_nombre, cliente_telefono, modalidad_entrega, subtotal, total, vence_en)
  values (n, num, 'TRANSFERENCIA', 'Ana Prueba', '1155554444', 'RETIRO', 20000, 20000, now() + interval '1 day') returning id into o1;
  -- Un remito sin conciliar de hace 3 días.
  insert into public.ordenes_compra (negocio_id, proveedor, estado, creado_en) values (n, 'Proveedor Test', 'PENDIENTE', now() - interval '3 days');
  -- La prueba termina en 2 días.
  update public.negocios set estado = 'prueba', plan_vencimiento = now() + interval '2 days' where id = n;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;

  r := public.mis_notificaciones();
  select array_agg(e->>'tipo' order by e->>'tipo') into claves from jsonb_array_elements(r->'tu_negocio') e;
  if claves is distinct from array['CAJA_OTRO_DIA', 'ORDEN_TRANSFERENCIAS', 'PRUEBA_VENCE', 'REMITO_PENDIENTES']
     or (r->>'sin_leer')::int <> 4 or public.notificaciones_sin_leer() <> 4 then
    raise exception 'FALLA estados: % / %', claves, r;
  end if;
  if not exists (select 1 from jsonb_array_elements(r->'tu_negocio') e
                  where e->>'titulo' = 'Tu prueba termina en 2 días' and e->>'categoria' = 'PLAN')
     or not exists (select 1 from jsonb_array_elements(r->'tu_negocio') e
                  where e->>'titulo' = 'Una transferencia por confirmar' and e->>'detalle' like 'Orden #' || num || ' · $20.000.%')
     or not exists (select 1 from jsonb_array_elements(r->'tu_negocio') e
                  where e->>'tipo' = 'REMITO_PENDIENTES' and e->>'categoria' = 'STOCK' and e->>'detalle' like 'El más antiguo es de hace %') then
    raise exception 'FALLA textos: %', r;
  end if;

  -- Leídos: el contador baja a cero.
  perform public.marcar_notificaciones_leidas(array(select e->>'clave' from jsonb_array_elements(r->'tu_negocio') e));
  if public.notificaciones_sin_leer() <> 0 then raise exception 'FALLA leídos'; end if;
  reset role;

  -- Otra transferencia: clave nueva, vuelve a avisar (y agrupa las dos).
  insert into public.ordenes_tienda (negocio_id, numero, medio, cliente_nombre, cliente_telefono, modalidad_entrega, subtotal, total, vence_en, creado_en)
  values (n, num + 1, 'TRANSFERENCIA', 'Beto Prueba', '1155553333', 'RETIRO', 5000, 5000, now() + interval '1 day', now() + interval '1 second');
  -- El turno pasa a ser de hoy: el estado desaparece.
  update public.turnos_caja set fecha_apertura = now() where id = t;
  set local role authenticated;
  r := public.mis_notificaciones();
  if public.notificaciones_sin_leer() <> 1
     or not exists (select 1 from jsonb_array_elements(r->'tu_negocio') e
                     where e->>'titulo' = '2 transferencias por confirmar' and not (e->>'leida')::boolean)
     or exists (select 1 from jsonb_array_elements(r->'tu_negocio') e where e->>'tipo' = 'CAJA_OTRO_DIA') then
    raise exception 'FALLA cambios: %', r;
  end if;
  reset role;

  raise exception 'DRY_RUN_OK';
end $$;
