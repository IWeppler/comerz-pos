-- Pagos en el checkout, T4 (+ la parte de T8 que la orden necesita desde el día 1):
-- crear la orden del catálogo descontando stock, y liberar las vencidas.
-- Diseño: docs/pagos-auditoria.md §2, §3.6, §10, §11.
--
--  1. `crear_orden_tienda(p_negocio, p_orden, p_items)`: UNA transacción que
--     valida el módulo y el medio, numera, inserta la orden y sus renglones y
--     DESCUENTA el stock por variante con UPDATE condicional. Si una sola
--     variante no alcanza, no queda nada escrito: ni orden ni stock movido.
--     Dos compradoras sobre la última unidad: la segunda espera el row lock,
--     relee y falla con SIN_STOCK.
--  2. `liberar_ordenes_tienda_vencidas(p_negocio)`: PENDIENTE_PAGO vencidas →
--     VENCIDA y el stock vuelve. Idempotente por `stock_liberado_en`.
--     -- STOPGAP: sin pg_cron (decisión 12/10/2026) se llama al crear una orden
--     -- y al leer órdenes; anotado en docs/pagos-stopgaps.md #1 (cada 10 min).
--  3. `opciones_cobro_online()`: para el catálogo (anon). Dice qué medios
--     online ofrece la tienda; solo booleanos, nada de alias ni tokens.
--
-- 1 y 2 son SECURITY DEFINER y SOLO para service_role: los llama la server
-- action del catálogo DESPUÉS de recalcular precios y totales desde la base.
-- Si `anon` pudiera llamarlas, cualquiera con la anon key mandaría su propio
-- total con un curl. Por eso el negocio entra por parámetro: quien llama es
-- el server, que lo resolvió del slug.
--
-- Precios y totales los calcula la action con los MISMOS módulos que el
-- carrito (`calcularTotalesPedido`, `precioBaseDeVariante`, `precioPorCantidad`).
-- Acá se verifica que cuadren entre sí, que cada variante sea del negocio,
-- esté activa y su producto publicado, y que haya stock.
--
-- Reversión: supabase/reversals/20261012162746_tienda_crear_orden.sql

-- Devuelve al stock lo que apartó UNA orden. Quien llama ya marcó
-- `stock_liberado_en` en el mismo UPDATE condicional que cambió el estado: es
-- lo que impide devolver dos veces. Un solo lugar para vencer y cancelar.
create or replace function public._devolver_stock_orden_tienda(p_negocio uuid, p_orden uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
begin
  perform public.marcar_origen_movimiento('ORDEN_TIENDA_LIBERADA', p_orden);

  for v_item in
    select i.variante_id, sum(i.cantidad) as cantidad
      from public.ordenes_tienda_items i
     where i.negocio_id = p_negocio and i.orden_id = p_orden
     group by i.variante_id
     order by i.variante_id
  loop
    -- La variante puede haberse borrado mientras tanto: no hay a dónde
    -- devolver y el UPDATE no toca nada (queda en la orden igual).
    update public.producto_variantes v
       set stock = v.stock + v_item.cantidad, updated_at = now()
     where v.id = v_item.variante_id and v.negocio_id = p_negocio;

    update public.productos_stock ps
       set cantidad = greatest(0, ps.cantidad + v_item.cantidad)
      from public.producto_variantes v
     where v.id = v_item.variante_id and v.negocio_id = p_negocio
       and ps.negocio_id = p_negocio and ps.producto_id = v.producto_id
       and ps.variante = v.nombre_display;
  end loop;
end $$;

create or replace function public.liberar_ordenes_tienda_vencidas(p_negocio uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orden record;
  v_cantidad integer := 0;
begin
  if p_negocio is null then return 0; end if;

  -- El UPDATE condicional toma el row lock: si dos llamadas corren a la vez,
  -- la segunda relee `stock_liberado_en` y no devuelve el stock otra vez.
  for v_orden in
    update public.ordenes_tienda
       set estado = 'VENCIDA', stock_liberado_en = now(), actualizado_en = now()
     where negocio_id = p_negocio
       and estado = 'PENDIENTE_PAGO'
       and vence_en < now()
       and stock_liberado_en is null
    returning id
  loop
    perform public._devolver_stock_orden_tienda(p_negocio, v_orden.id);

    insert into public.eventos_pago (negocio_id, orden_id, origen, clave_idempotencia, resultado)
    values (p_negocio, v_orden.id, 'VENCIMIENTO', 'vence:' || v_orden.id, 'APLICADO')
    on conflict (clave_idempotencia) do nothing;

    v_cantidad := v_cantidad + 1;
  end loop;

  return v_cantidad;
end $$;

comment on function public.liberar_ordenes_tienda_vencidas(uuid) is
  'Vence las órdenes PENDIENTE_PAGO del negocio cuyo plazo pasó y devuelve su stock (origen ORDEN_TIENDA_LIBERADA). Idempotente. STOPGAP: sin pg_cron, se llama al crear y al leer órdenes (docs/pagos-stopgaps.md #1). Solo service_role.';

create or replace function public.crear_orden_tienda(p_negocio uuid, p_orden jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_negocio record;
  v_config record;
  v_conexion_activa boolean;
  v_medio text := p_orden->>'medio';
  v_telefono text := p_orden->>'cliente_telefono';
  v_ip text := nullif(p_orden->>'ip_hash', '');
  v_minutos integer;
  v_numero integer;
  -- Id generado por el navegador: si la respuesta se pierde y la clienta
  -- reintenta, la misma orden vuelve como resultado normal y el stock no se
  -- aparta dos veces.
  v_orden_id uuid := coalesce(nullif(p_orden->>'id', '')::uuid, gen_random_uuid());
  v_existente record;
  v_token text;
  v_vence timestamptz;
  v_subtotal numeric;
  v_suma_items numeric;
  v_renglones integer;
  v_item record;
  v_stock record;
begin
  -- ─── Idempotencia: el mismo id devuelve la orden que ya existe ───
  select o.id, o.numero, o.token_publico, o.total, o.vence_en, o.medio into v_existente
    from public.ordenes_tienda o where o.id = v_orden_id and o.negocio_id = p_negocio;
  if v_existente.id is not null then
    select c.alias_mercadopago_tienda, c.transferencia_titular into v_config
      from public.configuracion_pos c where c.negocio_id = p_negocio;
    return jsonb_build_object(
      'id', v_existente.id, 'numero', v_existente.numero, 'token_publico', v_existente.token_publico,
      'total', v_existente.total, 'vence_en', v_existente.vence_en,
      'alias', case when v_existente.medio = 'TRANSFERENCIA' then v_config.alias_mercadopago_tienda end,
      'titular', case when v_existente.medio = 'TRANSFERENCIA' then v_config.transferencia_titular end,
      'repetida', true);
  end if;

  -- ─── El comercio y el medio ───
  select n.id, n.estado, n.pagos_online_habilitado into v_negocio
    from public.negocios n where n.id = p_negocio;
  if v_negocio.id is null or v_negocio.estado not in ('activo', 'prueba', 'demo') then
    raise exception 'TIENDA_NO_DISPONIBLE';
  end if;
  if not v_negocio.pagos_online_habilitado then
    raise exception 'COBROS_ONLINE_APAGADOS';
  end if;

  select c.cobro_online_transferencia, c.cobro_online_mp, c.alias_mercadopago_tienda,
         c.transferencia_titular, c.minutos_vence_transferencia, c.minutos_vence_mp
    into v_config
    from public.configuracion_pos c where c.negocio_id = p_negocio;

  select exists (select 1 from public.mercadopago_conexiones m
                  where m.negocio_id = p_negocio and m.estado = 'ACTIVA')
    into v_conexion_activa;

  if v_medio = 'TRANSFERENCIA' then
    if not coalesce(v_config.cobro_online_transferencia, false)
       or v_config.alias_mercadopago_tienda is null or not v_conexion_activa then
      raise exception 'MEDIO_NO_DISPONIBLE';
    end if;
    v_minutos := v_config.minutos_vence_transferencia;
  elsif v_medio in ('MP_CHECKOUT', 'MP_CREDITO') then
    if not coalesce(v_config.cobro_online_mp, false) or not v_conexion_activa then
      raise exception 'MEDIO_NO_DISPONIBLE';
    end if;
    v_minutos := v_config.minutos_vence_mp;
  else
    raise exception 'MEDIO_NO_DISPONIBLE';
  end if;

  -- ─── Topes contra el abuso: la orden aparta stock sin pagar ───
  if v_ip is not null and (
       select count(*) from public.ordenes_tienda o
        where o.negocio_id = p_negocio and o.ip_hash = v_ip
          and o.creado_en > now() - interval '1 hour') >= 5 then
    raise exception 'DEMASIADAS_ORDENES';
  end if;
  if (select count(*) from public.ordenes_tienda o
       where o.negocio_id = p_negocio and o.cliente_telefono = v_telefono
         and o.estado = 'PENDIENTE_PAGO' and o.vence_en > now()) >= 3 then
    raise exception 'DEMASIADAS_PENDIENTES';
  end if;

  -- ─── Renglones: forma y pertenencia ───
  if jsonb_typeof(p_items) <> 'array' then raise exception 'ORDEN_SIN_RENGLONES'; end if;
  v_renglones := jsonb_array_length(p_items);
  if v_renglones < 1 or v_renglones > 50 then raise exception 'ORDEN_SIN_RENGLONES'; end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_items) as i(producto_id uuid, variante_id uuid, cantidad numeric,
                                            precio_unitario numeric, subtotal numeric)
      left join public.producto_variantes v
        on v.id = i.variante_id and v.negocio_id = p_negocio and v.producto_id = i.producto_id
      left join public.productos p
        on p.id = v.producto_id and p.negocio_id = p_negocio
     where v.id is null or not coalesce(v.activa, false) or not coalesce(p.publicado, false)
        or i.cantidad is null or i.cantidad <= 0
        or i.precio_unitario is null or i.precio_unitario < 0
        or i.subtotal is null or abs(i.subtotal - round(i.precio_unitario * i.cantidad, 2)) > 0.01
  ) then
    raise exception 'RENGLON_INVALIDO';
  end if;

  -- ─── Los montos cuadran entre sí (los calculó la action desde la base) ───
  v_subtotal := (p_orden->>'subtotal')::numeric;
  select coalesce(sum((i->>'subtotal')::numeric), 0) into v_suma_items
    from jsonb_array_elements(p_items) i;
  if v_subtotal is null or abs(v_subtotal - v_suma_items) > 0.01 then
    raise exception 'TOTALES_NO_CUADRAN';
  end if;

  -- ─── Las vencidas devuelven su stock ANTES de mirar si alcanza ───
  perform public.liberar_ordenes_tienda_vencidas(p_negocio);

  -- ─── Número de orden: serie propia, atómica ───
  insert into public.ordenes_tienda_numeradores (negocio_id, ultimo)
  values (p_negocio, 1)
  on conflict (negocio_id) do update set ultimo = public.ordenes_tienda_numeradores.ultimo + 1
  returning ultimo into v_numero;

  v_vence := now() + make_interval(mins => v_minutos);

  -- El CHECK `ordenes_tienda_total_cuadra` frena un total que no sea
  -- subtotal − descuento + recargo + envío.
  insert into public.ordenes_tienda (
    id, negocio_id, numero, medio, cliente_nombre, cliente_telefono,
    modalidad_entrega, localidad, direccion, nota,
    subtotal, descuento, recargo, envio, total, promociones_aplicadas,
    vence_en, ip_hash
  ) values (
    v_orden_id, p_negocio, v_numero, v_medio,
    btrim(p_orden->>'cliente_nombre'), v_telefono,
    p_orden->>'modalidad_entrega', nullif(btrim(p_orden->>'localidad'), ''),
    nullif(btrim(p_orden->>'direccion'), ''), nullif(btrim(p_orden->>'nota'), ''),
    v_subtotal, (p_orden->>'descuento')::numeric, (p_orden->>'recargo')::numeric,
    (p_orden->>'envio')::numeric, (p_orden->>'total')::numeric,
    coalesce(p_orden->'promociones_aplicadas', '[]'::jsonb),
    v_vence, v_ip
  )
  returning token_publico into v_token;

  insert into public.ordenes_tienda_items (
    negocio_id, orden_id, producto_id, variante_id, nombre, variante,
    precio_unitario, cantidad, subtotal
  )
  select p_negocio, v_orden_id, i.producto_id, i.variante_id, left(i.nombre, 200),
         left(i.variante, 200), i.precio_unitario, i.cantidad, i.subtotal
    from jsonb_to_recordset(p_items) as i(producto_id uuid, variante_id uuid, nombre text,
                                          variante text, precio_unitario numeric,
                                          cantidad numeric, subtotal numeric);

  -- ─── Stock: se descuenta YA, con UPDATE condicional por variante ───
  -- Agrupado: dos renglones de la misma variante piden la suma.
  -- Ordenado por id: dos órdenes concurrentes toman los locks en el mismo
  -- orden y no se traban entre sí.
  perform public.marcar_origen_movimiento('ORDEN_TIENDA', v_orden_id);
  for v_item in
    select i.variante_id, sum(i.cantidad) as cantidad
      from public.ordenes_tienda_items i
     where i.negocio_id = p_negocio and i.orden_id = v_orden_id
     group by i.variante_id
     order by i.variante_id
  loop
    update public.producto_variantes v
       set stock = v.stock - v_item.cantidad, updated_at = now()
     where v.id = v_item.variante_id and v.negocio_id = p_negocio
       and v.stock >= v_item.cantidad
    returning v.producto_id, v.nombre_display into v_stock;

    if not found then
      raise exception 'SIN_STOCK'
        using detail = coalesce((select v.nombre_display from public.producto_variantes v
                                  where v.id = v_item.variante_id), '');
    end if;

    -- El espejo legacy se descuenta si existe (mismo criterio que la venta).
    update public.productos_stock ps
       set cantidad = greatest(0, ps.cantidad - v_item.cantidad)
     where ps.negocio_id = p_negocio and ps.producto_id = v_stock.producto_id
       and ps.variante = v_stock.nombre_display;
  end loop;

  return jsonb_build_object(
    'id', v_orden_id,
    'numero', v_numero,
    'token_publico', v_token,
    'total', (p_orden->>'total')::numeric,
    'vence_en', v_vence,
    'alias', case when v_medio = 'TRANSFERENCIA' then v_config.alias_mercadopago_tienda end,
    'titular', case when v_medio = 'TRANSFERENCIA' then v_config.transferencia_titular end
  );
end $$;

comment on function public.crear_orden_tienda(uuid, jsonb, jsonb) is
  'Crea la orden del catálogo y descuenta el stock en UNA transacción (origen ORDEN_TIENDA). Montos ya recalculados desde la base por la server action; acá se verifica que cuadren, que cada variante sea del negocio y que haya stock. Solo service_role.';

create or replace function public.opciones_cobro_online()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_negocio uuid := security.negocio_publico();
  v_habilitado boolean;
  v_conectado boolean;
  v_config record;
begin
  if v_negocio is null then
    return jsonb_build_object('transferencia', false, 'mercadopago', false);
  end if;

  select n.pagos_online_habilitado into v_habilitado from public.negocios n where n.id = v_negocio;
  select exists (select 1 from public.mercadopago_conexiones m
                  where m.negocio_id = v_negocio and m.estado = 'ACTIVA') into v_conectado;
  select c.cobro_online_transferencia, c.cobro_online_mp, c.alias_mercadopago_tienda
    into v_config from public.configuracion_pos c where c.negocio_id = v_negocio;

  return jsonb_build_object(
    'transferencia', coalesce(v_habilitado and v_conectado and v_config.cobro_online_transferencia
                              and v_config.alias_mercadopago_tienda is not null, false),
    'mercadopago', coalesce(v_habilitado and v_conectado and v_config.cobro_online_mp, false)
  );
end $$;

comment on function public.opciones_cobro_online() is
  'Qué medios online ofrece el catálogo del slug actual (anon). Solo booleanos.';

revoke all on function public._devolver_stock_orden_tienda(uuid, uuid) from public, anon, authenticated;
revoke all on function public.liberar_ordenes_tienda_vencidas(uuid) from public, anon, authenticated;
revoke all on function public.crear_orden_tienda(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.opciones_cobro_online() from public;
grant execute on function public.liberar_ordenes_tienda_vencidas(uuid) to service_role;
grant execute on function public.crear_orden_tienda(uuid, jsonb, jsonb) to service_role;
grant execute on function public.opciones_cobro_online() to anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.crear_orden_tienda(uuid,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.crear_orden_tienda(uuid,jsonb,jsonb)', 'EXECUTE')
    or has_function_privilege('anon', 'public.liberar_ordenes_tienda_vencidas(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public._devolver_stock_orden_tienda(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._devolver_stock_orden_tienda(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.liberar_ordenes_tienda_vencidas(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.crear_orden_tienda(uuid,jsonb,jsonb)', 'EXECUTE')
    or not has_function_privilege('anon', 'public.opciones_cobro_online()', 'EXECUTE') then
    raise exception 'TIENDA_ORDEN_GUARD_GRANTS';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('crear_orden_tienda', 'liberar_ordenes_tienda_vencidas', 'opciones_cobro_online')) <> 3
    or not (select bool_and(prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('crear_orden_tienda', 'liberar_ordenes_tienda_vencidas', 'opciones_cobro_online')) then
    raise exception 'TIENDA_ORDEN_GUARD_FUNCIONES';
  end if;
end $$;
