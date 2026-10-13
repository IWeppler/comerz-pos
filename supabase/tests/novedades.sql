-- Test de 20261013144754_novedades.sql (correr la migración antes, en la misma
-- transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
-- Cubre: una novedad publicada aparece sin leer para un admin y para una vendedora
-- (las novedades son para todos); un borrador no aparece; marcarla leída la baja del
-- contador sin tocar los avisos del negocio; publicada antes de crearse la cuenta no
-- cuenta como sin leer; un usuario que no es super admin no puede publicar.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid; vend_u uuid; nov uuid; borrador uuid; r jsonb; antes int;
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;
  select un.usuario_id into vend_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'VENDEDOR' limit 1;

  insert into public.novedades (titulo, icono, cuerpo, publicada_en)
  values ('Llegó la campana', 'sparkles', E'Ahora te avisamos **lo importante**.\n- Agotados\n- Ventas online', now())
  returning id into nov;
  insert into public.novedades (titulo, cuerpo) values ('Borrador', '') returning id into borrador;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;

  r := public.mis_notificaciones();
  if jsonb_array_length(r->'novedades') <> 1 or r->'novedades'->0->>'clave' <> 'novedad:' || nov
     or (r->'novedades'->0->>'leida')::boolean or r->'novedades'->0->>'cuerpo' not like '%**lo importante**%' then
    raise exception 'FALLA novedad en la lista: %', r->'novedades';
  end if;
  antes := public.notificaciones_sin_leer();
  perform public.marcar_notificaciones_leidas(array['novedad:' || nov]);
  if public.notificaciones_sin_leer() <> antes - 1
     or (public.mis_notificaciones()->'novedades'->0->>'leida')::boolean is not true then
    raise exception 'FALLA leída: antes %, ahora %', antes, public.notificaciones_sin_leer();
  end if;

  -- No es super admin: no puede publicar.
  begin
    perform public.guardar_novedad(null, 'Intruso', 'gift', '', true);
    raise exception 'FALLA: publicó sin ser super admin';
  exception when insufficient_privilege then null;
  end;
  reset role;
  -- (Como postgres: authenticated no tiene SELECT sobre la tabla, y está bien.)
  if exists (select 1 from public.notificaciones_leidas where clave like 'novedad:%') then
    raise exception 'FALLA: la novedad se guardó como aviso del negocio';
  end if;

  -- La vendedora también la ve.
  if vend_u is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', vend_u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if jsonb_array_length(public.mis_notificaciones()->'novedades') <> 1 then
      raise exception 'FALLA: la vendedora no ve la novedad';
    end if;
    reset role;
  end if;

  -- Publicada antes de que existiera la cuenta: en la lista, pero leída.
  update public.novedades set publicada_en = '2000-01-01' where id = nov;
  delete from public.novedades_vistas where novedad_id = nov;
  if exists (select 1 from public._novedades_para(admin_u) x where x.id = nov) then
    raise exception 'FALLA: una novedad de hace más de 120 días sigue en la lista';
  end if;
  update public.novedades set publicada_en = (select created_at - interval '1 day' from auth.users where id = admin_u) where id = nov;
  if (select x.leida from public._novedades_para(admin_u) x where x.id = nov) is distinct from true
     and (select created_at from auth.users where id = admin_u) > now() - interval '119 days' then
    raise exception 'FALLA: anterior a la cuenta cuenta como sin leer';
  end if;

  raise exception 'DRY_RUN_OK';
end $$;
