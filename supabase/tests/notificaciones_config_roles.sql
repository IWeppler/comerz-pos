-- Test de 20261013145823_notificaciones_config_roles.sql (correr la migración antes, en
-- la misma transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
-- Cubre: sin configuración, los defaults (todo para ADMIN y ENCARGADO, PLAN solo ADMIN);
-- guardar cambia lo que se aplica; una forma inválida falla y no guarda; un ENCARGADO no
-- puede leer ni guardar.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid; enc_u uuid; r jsonb;
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;
  select un.usuario_id into enc_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ENCARGADO' limit 1;
  update public.configuracion_pos set notificaciones_roles = null where negocio_id = n;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;

  r := public.notificaciones_roles_efectivos();
  if r <> '{"STOCK":{"ADMIN":true,"ENCARGADO":true},"TIENDA":{"ADMIN":true,"ENCARGADO":true},"PLAN":{"ADMIN":true,"ENCARGADO":false},"PLATA":{"ADMIN":true,"ENCARGADO":true}}'::jsonb then
    raise exception 'FALLA defaults: %', r;
  end if;

  perform public.guardar_notificaciones_roles('{"STOCK":["ENCARGADO"],"TIENDA":["ADMIN","ENCARGADO"],"PLAN":["ADMIN"],"PLATA":[]}');
  r := public.notificaciones_roles_efectivos();
  if (r->'STOCK'->>'ADMIN')::boolean or not (r->'STOCK'->>'ENCARGADO')::boolean
     or (r->'PLATA'->>'ADMIN')::boolean or (r->'PLATA'->>'ENCARGADO')::boolean then
    raise exception 'FALLA guardado: %', r;
  end if;

  begin
    perform public.guardar_notificaciones_roles('{"STOCK":["VENDEDOR"],"TIENDA":[],"PLAN":[],"PLATA":[]}');
    raise exception 'FALLA: aceptó VENDEDOR';
  exception when raise_exception then
    if sqlerrm not like 'NOTIFICACIONES_ROLES_INVALIDOS%' then raise; end if;
  end;
  begin
    perform public.guardar_notificaciones_roles('{"STOCK":[]}');
    raise exception 'FALLA: aceptó categorías de menos';
  exception when raise_exception then
    if sqlerrm not like 'NOTIFICACIONES_ROLES_INVALIDOS%' then raise; end if;
  end;
  if (public.notificaciones_roles_efectivos()->'STOCK'->>'ENCARGADO')::boolean is not true then
    raise exception 'FALLA: un guardado inválido cambió algo';
  end if;
  reset role;

  if enc_u is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', enc_u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      perform public.guardar_notificaciones_roles('{"STOCK":[],"TIENDA":[],"PLAN":[],"PLATA":[]}');
      raise exception 'FALLA: un ENCARGADO guardó';
    exception when insufficient_privilege then null;
    end;
    reset role;
  end if;

  raise exception 'DRY_RUN_OK encargado=%', enc_u is not null;
end $$;
