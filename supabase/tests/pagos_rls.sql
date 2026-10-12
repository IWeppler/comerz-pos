-- Test de RLS de 20261012133049_tienda_ordenes_y_pagos.sql.
--
-- Corre contra la base real SIN dejar nada: todo va adentro de una transacción
-- que termina en ROLLBACK. Si una aserción falla, `raise exception` corta y
-- también revierte. Resultado esperado: el NOTICE "PAGOS_RLS_OK".
--
-- Arma fixtures en dos negocios (A y B) con un ADMIN de cada uno, y verifica:
--   1. A ve sus órdenes, ítems y eventos, y no los de B (y viceversa).
--   2. Nadie de authenticated puede insertar, actualizar ni borrar órdenes,
--      ítems ni eventos (se escriben solo por RPC).
--   3. Conexiones de MP, estados de OAuth y numeradores: ni el ADMIN los lee.
--   4. anon no lee nada de lo nuevo, ni siquiera con el slug del negocio.
--   5. Un rol sin `tienda.ver_ordenes` no ve órdenes de su propio negocio.
--
-- Uso: pegar entero en el SQL editor o en `execute_sql`.

begin;

create temp table _ctx on commit drop as
with admins as (
  select distinct on (un.negocio_id) un.negocio_id, un.usuario_id, n.slug
    from public.usuarios_negocios un
    join public.roles r on r.id = un.rol_id and r.nombre = 'ADMIN'
    join public.negocios n on n.id = un.negocio_id and n.estado in ('activo', 'prueba', 'demo')
   where n.slug is not null
   order by un.negocio_id, un.usuario_id
)
select (array_agg(negocio_id order by negocio_id))[1] as negocio_a,
       (array_agg(usuario_id order by negocio_id))[1] as usuario_a,
       (array_agg(slug order by negocio_id))[1] as slug_a,
       (array_agg(negocio_id order by negocio_id))[2] as negocio_b,
       (array_agg(usuario_id order by negocio_id))[2] as usuario_b
  from admins;

grant select on _ctx to authenticated, anon;

-- Fixtures (como postgres, saltean la RLS).
insert into public.ordenes_tienda (id, negocio_id, numero, medio, cliente_nombre, cliente_telefono,
  modalidad_entrega, subtotal, total, vence_en)
select '00000000-0000-0000-0000-00000000000a'::uuid, negocio_a, 1, 'TRANSFERENCIA', 'Prueba A', '1155550000',
       'RETIRO', 1000, 1000, now() + interval '2 hours' from _ctx
union all
select '00000000-0000-0000-0000-00000000000b'::uuid, negocio_b, 1, 'MP_CHECKOUT', 'Prueba B', '1155550001',
       'RETIRO', 2000, 2000, now() + interval '1 hour' from _ctx;

insert into public.ordenes_tienda_items (negocio_id, orden_id, producto_id, variante_id, nombre,
  precio_unitario, cantidad, subtotal)
select negocio_a, '00000000-0000-0000-0000-00000000000a'::uuid, gen_random_uuid(), gen_random_uuid(), 'X', 1000, 1, 1000 from _ctx
union all
select negocio_b, '00000000-0000-0000-0000-00000000000b'::uuid, gen_random_uuid(), gen_random_uuid(), 'Y', 2000, 1, 2000 from _ctx;

insert into public.eventos_pago (negocio_id, orden_id, origen, clave_idempotencia, resultado)
select negocio_a, '00000000-0000-0000-0000-00000000000a'::uuid, 'MANUAL', 'test:a', 'APLICADO' from _ctx
union all
select negocio_b, '00000000-0000-0000-0000-00000000000b'::uuid, 'MP_WEBHOOK', 'test:b', 'APLICADO' from _ctx;

insert into public.mercadopago_conexiones (negocio_id, mp_user_id, access_token_cifrado,
  refresh_token_cifrado, expira_en)
select negocio_a, '123', 'v1:a:b:c', 'v1:a:b:c', now() + interval '180 days' from _ctx;

-- Idempotencia: la misma clave dos veces tiene que chocar.
do $$
begin
  begin
    insert into public.eventos_pago (negocio_id, orden_id, origen, clave_idempotencia, resultado)
    select negocio_a, null, 'MP_WEBHOOK', 'test:a', 'APLICADO' from _ctx;
    raise exception 'FALLA: clave_idempotencia repetida se insertó';
  exception when unique_violation then null;
  end;
  -- Total que no cuadra: lo frena el CHECK.
  begin
    insert into public.ordenes_tienda (negocio_id, numero, medio, cliente_nombre, cliente_telefono,
      modalidad_entrega, subtotal, descuento, total, vence_en)
    select negocio_a, 99, 'TRANSFERENCIA', 'X', '1155550000', 'RETIRO', 1000, 100, 1000, now() from _ctx;
    raise exception 'FALLA: total que no cuadra se insertó';
  exception when check_violation then null;
  end;
end $$;

-- Una función que corre la batería como un usuario dado.
create function pg_temp.como_usuario(p_usuario uuid, p_negocio uuid, p_otro uuid) returns void
language plpgsql as $$
declare v int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', p_negocio)::text, true);
  set local role authenticated;

  select count(*) into v from public.ordenes_tienda where negocio_id = p_negocio;
  if v <> 1 then raise exception 'FALLA: % no ve su orden (%)', p_negocio, v; end if;
  select count(*) into v from public.ordenes_tienda where negocio_id = p_otro;
  if v <> 0 then raise exception 'FALLA: % ve órdenes de %', p_negocio, p_otro; end if;
  select count(*) into v from public.ordenes_tienda_items where negocio_id = p_otro;
  if v <> 0 then raise exception 'FALLA: % ve ítems de %', p_negocio, p_otro; end if;
  select count(*) into v from public.ordenes_tienda_items where negocio_id = p_negocio;
  if v <> 1 then raise exception 'FALLA: % no ve sus ítems', p_negocio; end if;
  select count(*) into v from public.eventos_pago where negocio_id = p_otro;
  if v <> 0 then raise exception 'FALLA: % ve eventos de %', p_negocio, p_otro; end if;
  select count(*) into v from public.eventos_pago where clave_idempotencia like 'test:%';
  if v <> 1 then raise exception 'FALLA: % ve % eventos de prueba', p_negocio, v; end if;

  begin
    update public.ordenes_tienda set estado = 'PAGADA';
    raise exception 'FALLA: authenticated pudo UPDATE en ordenes_tienda';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ordenes_tienda (numero, medio, cliente_nombre, cliente_telefono,
      modalidad_entrega, subtotal, total, vence_en)
    values (50, 'TRANSFERENCIA', 'X', '1155550000', 'RETIRO', 1, 1, now());
    raise exception 'FALLA: authenticated pudo INSERT en ordenes_tienda';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.eventos_pago;
    raise exception 'FALLA: authenticated pudo DELETE en eventos_pago';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.mercadopago_conexiones;
    raise exception 'FALLA: authenticated leyó mercadopago_conexiones';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.mercadopago_oauth_estados;
    raise exception 'FALLA: authenticated leyó mercadopago_oauth_estados';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.ordenes_tienda_numeradores;
    raise exception 'FALLA: authenticated leyó ordenes_tienda_numeradores';
  exception when insufficient_privilege then null;
  end;

  reset role;
end $$;

select pg_temp.como_usuario(usuario_a, negocio_a, negocio_b) from _ctx;
select pg_temp.como_usuario(usuario_b, negocio_b, negocio_a) from _ctx;

-- Rol sin el permiso: se lo saca al ADMIN de A... no sirve (is_admin() da true
-- siempre). Se usa un usuario de A cuyo rol NO tenga `tienda.ver_ordenes`, si
-- existe; si no hay ninguno, se informa y se saltea.
do $$
declare v_usuario uuid; v_negocio uuid; v int;
begin
  select un.usuario_id, un.negocio_id into v_usuario, v_negocio
    from public.usuarios_negocios un
    join public.roles r on r.id = un.rol_id and r.nombre <> 'ADMIN'
   where not exists (select 1 from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
                      where rp.rol_id = un.rol_id and p.clave = 'tienda.ver_ordenes')
   limit 1;
  if v_usuario is null then
    raise notice 'SIN_ROL_SIN_PERMISO: no hay roles sin tienda.ver_ordenes, se saltea el caso 5';
    return;
  end if;
  insert into public.ordenes_tienda (negocio_id, numero, medio, cliente_nombre, cliente_telefono,
    modalidad_entrega, subtotal, total, vence_en)
  values (v_negocio, 77, 'TRANSFERENCIA', 'Prueba', '1155550002', 'RETIRO', 1, 1, now());

  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-activo', v_negocio)::text, true);
  set local role authenticated;
  select count(*) into v from public.ordenes_tienda;
  reset role;
  if v <> 0 then raise exception 'FALLA: rol sin tienda.ver_ordenes ve % órdenes', v; end if;
end $$;

-- anon, con el slug de A en el header.
do $$
declare v_slug text;
begin
  select slug_a into v_slug from _ctx;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.headers', json_build_object('x-negocio-slug', v_slug)::text, true);
  set local role anon;
  begin
    perform 1 from public.ordenes_tienda;
    raise exception 'FALLA: anon leyó ordenes_tienda';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.eventos_pago;
    raise exception 'FALLA: anon leyó eventos_pago';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.mercadopago_conexiones;
    raise exception 'FALLA: anon leyó mercadopago_conexiones';
  exception when insufficient_privilege then null;
  end;
  begin
    perform pagos_online_habilitado from public.negocios;
    raise exception 'FALLA: anon leyó negocios.pagos_online_habilitado';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

do $$ begin raise notice 'PAGOS_RLS_OK'; end $$;

rollback;
