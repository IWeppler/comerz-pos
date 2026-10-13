-- Test de 20261013100000_notificaciones_base.sql (correr la migración antes, en la
-- misma transacción). Termina en DRY_RUN_OK: no deja nada. Negocio `tienda-demo`.
-- Cubre: una VENTA que agota un producto entero crea el aviso del día; una edición no;
-- un segundo producto agotado actualiza el mismo aviso y lo vuelve a marcar sin leer;
-- leído y "limpiar leídas" por usuario; un vendedor no ve avisos del negocio; la
-- configuración saca una categoría a un rol.
do $$
declare
  n uuid := (select id from public.negocios where slug = 'tienda-demo');
  admin_u uuid; p1 record; p2 record; r jsonb;
begin
  select un.usuario_id into admin_u from public.usuarios_negocios un join public.roles ro on ro.id = un.rol_id
   where un.negocio_id = n and ro.nombre = 'ADMIN' limit 1;
  -- Dos productos distintos con stock. Sus OTRAS variantes se dejan en 0 con una
  -- edición (que no avisa), así una venta de la variante elegida agota el producto.
  select v.id as variante, v.producto_id into p1 from public.producto_variantes v
   where v.negocio_id = n and v.activa and v.stock > 0 order by v.id limit 1;
  select v.id as variante, v.producto_id into p2 from public.producto_variantes v
   where v.negocio_id = n and v.activa and v.stock > 0 and v.producto_id <> p1.producto_id order by v.id limit 1;
  perform public.marcar_origen_movimiento('EDICION_VARIANTES', null);
  update public.producto_variantes set stock = 0
   where producto_id in (p1.producto_id, p2.producto_id) and id not in (p1.variante, p2.variante);

  -- Una edición que deja en 0 no avisa.
  perform public.marcar_origen_movimiento('EDICION_VARIANTES', null);
  update public.producto_variantes set stock = 0 where id = p2.variante;
  if exists (select 1 from public.notificaciones where negocio_id = n) then raise exception 'FALLA: avisó una edición'; end if;
  update public.producto_variantes set stock = 3 where id = p2.variante;

  -- Una venta que agota p1: aviso del día.
  perform public.marcar_origen_movimiento('VENTA', null);
  update public.producto_variantes set stock = 0 where id = p1.variante;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', n)::text, true);
  set local role authenticated;
  r := public.mis_notificaciones();
  if jsonb_array_length(r->'tu_negocio') <> 1 or (r->>'sin_leer')::int <> 1 or r->'tu_negocio'->0->>'titulo' <> 'Sin stock' then
    raise exception 'FALLA aviso: %', r;
  end if;
  if public.notificaciones_sin_leer() <> 1 then raise exception 'FALLA contador'; end if;
  perform public.marcar_notificaciones_leidas(array[r->'tu_negocio'->0->>'clave']);
  if public.notificaciones_sin_leer() <> 0 then raise exception 'FALLA leída'; end if;
  reset role;

  -- Segundo producto agotado el mismo día: mismo aviso, vuelve a no leído.
  perform public.marcar_origen_movimiento('VENTA', null);
  update public.producto_variantes set stock = 0 where id = p2.variante;
  set local role authenticated;
  r := public.mis_notificaciones();
  if jsonb_array_length(r->'tu_negocio') <> 1 or r->'tu_negocio'->0->>'titulo' <> 'Se agotaron 2 productos hoy'
     or (r->'tu_negocio'->0->>'leida')::boolean then
    raise exception 'FALLA agrupado: %', r;
  end if;
  perform public.marcar_notificaciones_leidas(array[r->'tu_negocio'->0->>'clave']);
  perform public.limpiar_notificaciones_leidas();
  if jsonb_array_length(public.mis_notificaciones()->'tu_negocio') <> 0 then raise exception 'FALLA limpiar'; end if;
  reset role;

  -- Configuración: el ADMIN sin STOCK no recibe el aviso.
  update public.configuracion_pos set notificaciones_roles = '{"STOCK":["ENCARGADO"]}' where negocio_id = n;
  update public.notificaciones_leidas set oculta = false where negocio_id = n;
  set local role authenticated;
  if public.notificaciones_sin_leer() <> 0 or jsonb_array_length(public.mis_notificaciones()->'tu_negocio') <> 0 then
    raise exception 'FALLA config';
  end if;
  reset role;

  raise exception 'DRY_RUN_OK';
end $$;
