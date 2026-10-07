-- Reversión de 20261007120000_imei_por_categoria.sql. Se corre A MANO.
--
-- OJO antes de correrla:
--   - Las unidades creadas por completar_imei_venta_item quedan (son aparatos
--     reales vendidos). Solo se pierde poder crear nuevas.
--   - Borra ventas_items.motivo_sin_imei con lo que se haya guardado.
--   - El código que llame a las funciones nuevas tiene que volver atrás ANTES.

-- 5. aprobar_orden_compra_impl: reemplazos inversos sobre el cuerpo VIVO.
do $reversion$
declare
  v_def text;
  v_nuevo text;
  v_pares text[][];
  i int;
  v_ocurrencias int;
begin
  v_pares := array[
    [$v$    select im.imei || ' (dos veces en el remito)' as imei
    from jsonb_array_elements(p_items) as it
    cross join lateral public.imeis_linea_remito(it) as im(imei)
    where nullif(it->>'producto_id', '') is not null
      and (it->>'cantidad')::numeric > 0
    group by im.imei$v$,
     $v$    select trim(it->>'imei') || ' (dos veces en el remito)' as imei
    from jsonb_array_elements(p_items) as it
    where nullif(it->>'producto_id', '') is not null
      and (it->>'cantidad')::numeric > 0
      and nullif(trim(coalesce(it->>'imei', '')), '') is not null
    group by trim(it->>'imei')$v$],
    [$v$    from jsonb_array_elements(p_items) as it
    cross join lateral public.imeis_linea_remito(it) as im(imei)
    join unidades_serie u
      on u.negocio_id = v_negocio_id
     and u.imei = im.imei$v$,
     $v$    from jsonb_array_elements(p_items) as it
    join unidades_serie u
      on u.negocio_id = v_negocio_id
     and u.imei = trim(it->>'imei')$v$],
    [$v$  -- GUARD DE IMEI DE MAS (20261007120000): no puede haber mas aparatos con
  -- numero que unidades recibidas. Solo renglones que entran (cantidad > 0):
  -- uno "no vino" con su IMEI del Excel no crea nada, como siempre.
  select string_agg(
           coalesce(nullif(it->>'raw_nombre', ''), '(sin nombre)')
             || ' (' || c.n || ' IMEI para ' || (it->>'cantidad') || ' unidades)',
           '; '
         )
    into v_colisiones
  from jsonb_array_elements(p_items) as it
  cross join lateral (
    select count(*) as n from public.imeis_linea_remito(it)
  ) c
  where nullif(it->>'producto_id', '') is not null
    and (it->>'cantidad')::numeric > 0
    and c.n > floor((it->>'cantidad')::numeric);

  if v_colisiones is not null then
    raise exception
      'REMITO_IMEIS_DE_MAS: hay renglones con mas IMEI que unidades: %',
      v_colisiones
      using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop$v$,
     $v$  for v_item in select * from jsonb_array_elements(p_items)
  loop$v$],
    [$v$    -- Una unidad por IMEI de la línea (el del Excel + los completados en la
    -- conciliación). Nacen disponibles: el stock ya lo suma la variante.
    if v_variante_id is not null then
      insert into unidades_serie (negocio_id, producto_variante_id, imei, estado)
      select
        coalesce(v_negocio_id, security.current_negocio_id()),
        v_variante_id,
        im.imei,
        'disponible'
      from public.imeis_linea_remito(v_item) as im(imei);

      get diagnostics v_imeis_linea = row_count;
      v_imeis_creados := v_imeis_creados + v_imeis_linea;
    end if;$v$,
     $v$    if v_imei is not null and v_variante_id is not null then
      insert into unidades_serie (negocio_id, producto_variante_id, imei, estado)
      values (
        coalesce(v_negocio_id, security.current_negocio_id()),
        v_variante_id,
        v_imei,
        'disponible'
      );

      if found then
        v_imeis_creados := v_imeis_creados + 1;
      end if;
    end if;$v$],
    [$v$  v_imeis_creados integer := 0;
  v_imeis_linea integer := 0;
begin$v$,
     $v$  v_imeis_creados integer := 0;
begin$v$]
  ];

  v_def := pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure);
  v_nuevo := v_def;
  for i in 1 .. array_length(v_pares, 1) loop
    v_ocurrencias :=
      (length(v_nuevo) - length(replace(v_nuevo, v_pares[i][1], ''))) / length(v_pares[i][1]);
    if v_ocurrencias <> 1 then
      raise exception 'reversion: el reemplazo % matchea % veces (se esperaba 1)', i, v_ocurrencias;
    end if;
    v_nuevo := replace(v_nuevo, v_pares[i][1], v_pares[i][2]);
  end loop;
  execute v_nuevo;

  v_def := pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure);
  if position('imeis_linea_remito' in v_def) > 0
     or position('tiene_permiso(''stock.ingresar_remito'')' in v_def) = 0 then
    raise exception 'reversion: aprobar_orden_compra_impl no quedo como antes';
  end if;
end;
$reversion$;

-- 3b. registrar_venta: deja de grabar el motivo (inverso, cuerpo VIVO).
do $registrar$
declare
  v_firma constant text := 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])';
  v_nuevo text;
  v_pares text[][] := array[
    [$v$    promocion_id, promocion_nombre, es_venta_libre, motivo_sin_imei
  )$v$,
     $v$    promocion_id, promocion_nombre, es_venta_libre
  )$v$],
    [$v$    coalesce(i.es_venta_libre, false),
    nullif(trim(i.motivo_sin_imei), '')
  from jsonb_to_recordset(p_items) as i($v$,
     $v$    coalesce(i.es_venta_libre, false)
  from jsonb_to_recordset(p_items) as i($v$],
    [$v$    es_venta_libre boolean, motivo_sin_imei text
  );$v$,
     $v$    es_venta_libre boolean
  );$v$]
  ];
  i int;
  v_ocurrencias int;
begin
  v_nuevo := pg_get_functiondef(v_firma::regprocedure);
  for i in 1 .. array_length(v_pares, 1) loop
    v_ocurrencias :=
      (length(v_nuevo) - length(replace(v_nuevo, v_pares[i][1], ''))) / length(v_pares[i][1]);
    if v_ocurrencias <> 1 then
      raise exception 'reversion registrar_venta: el reemplazo % matchea % veces', i, v_ocurrencias;
    end if;
    v_nuevo := replace(v_nuevo, v_pares[i][1], v_pares[i][2]);
  end loop;
  execute v_nuevo;
  if position('motivo_sin_imei' in pg_get_functiondef(v_firma::regprocedure)) > 0 then
    raise exception 'reversion: registrar_venta sigue grabando motivo_sin_imei';
  end if;
end;
$registrar$;

drop function if exists public.imeis_linea_remito(jsonb);
drop function if exists public.completar_imei_venta_item(uuid, text);
drop function if exists public.variantes_llevan_serie(uuid[]);
drop function if exists public.productos_llevan_serie(uuid[]);
drop function if exists public.categorias_llevan_serie();
drop function if exists public.normalizar_imei(text);

alter table public.ventas_items drop constraint if exists ventas_items_motivo_sin_imei_no_vacio;
alter table public.ventas_items drop column if exists motivo_sin_imei;
alter table public.categorias drop column if exists lleva_serie;
