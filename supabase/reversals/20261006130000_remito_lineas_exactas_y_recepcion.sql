-- Reversión de 20261006130000_remito_lineas_exactas_y_recepcion.sql.
--
-- Deshace los reemplazos sobre el cuerpo VIVO de aprobar_orden_compra_impl
-- (los mismos pares, invertidos) y saca las dos columnas de ordenes_items.
-- Ojo: sin la función nueva, una aprobación vuelve a poder omitir renglones
-- con producto sin ningún error.

do $mig$
declare
  v_def text;
  v_reemplazos text[][] := array[
    -- 1. Variable nueva.
    [
      '  v_sin_producto integer;',
      '  v_sin_producto integer;
  v_faltantes integer;'
    ],
    -- 2. Guard de líneas exactas, primero de todo.
    [
      'begin
  -- GUARD DE FUSION: va primero, antes de cualquier escritura.',
      'begin
  -- GUARD DE LINEAS EXACTAS (20261006130000): cada renglon de la orden viaja
  -- exactamente una vez, por item_id. Antes un renglon omitido no entraba al
  -- stock sin un solo error, y uno repetido sumaba dos veces.
  select string_agg(x.motivo, ''; '')
    into v_colisiones
  from (
    select ''hay renglones sin item_id'' as motivo
      from jsonb_array_elements(p_items) as it
     where nullif(it->>''item_id'', '''') is null
    having count(*) > 0
    union all
    select ''renglon repetido '' || (it->>''item_id'')
      from jsonb_array_elements(p_items) as it
     where nullif(it->>''item_id'', '''') is not null
     group by it->>''item_id''
    having count(*) > 1
    union all
    select ''renglon de otra orden '' || (it->>''item_id'')
      from jsonb_array_elements(p_items) as it
     where nullif(it->>''item_id'', '''') is not null
       and not exists (
         select 1 from ordenes_items oi
          where oi.id = (it->>''item_id'')::uuid
            and oi.orden_id = p_orden_id
       )
  ) x;

  if v_colisiones is not null then
    raise exception
      ''REMITO_LINEAS_INVALIDAS: %'', v_colisiones
      using errcode = ''P0001'';
  end if;

  select count(*)
    into v_faltantes
  from ordenes_items oi
  where oi.orden_id = p_orden_id
    and not exists (
      select 1
      from jsonb_array_elements(p_items) as it
      where nullif(it->>''item_id'', '''')::uuid = oi.id
    );

  if v_faltantes > 0 then
    raise exception
      ''REMITO_LINEAS_FALTANTES: % renglon(es) del remito no vinieron en la aprobacion; no entrarian al stock'',
      v_faltantes
      using errcode = ''P0001'';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as it
    where nullif(it->>''cantidad'', '''') is null
       or (it->>''cantidad'')::numeric < 0
  ) then
    raise exception
      ''REMITO_CANTIDAD_INVALIDA: hay renglones sin cantidad o con cantidad negativa''
      using errcode = ''P0001'';
  end if;

  -- GUARD DE FUSION: va primero, antes de cualquier escritura.'
    ],
    -- 3. Fusión: solo lo que entra.
    [
      '    where nullif(it->>''producto_id'', '''') is not null
  ),
  choques as (',
      '    where nullif(it->>''producto_id'', '''') is not null
      and (it->>''cantidad'')::numeric > 0
  ),
  choques as ('
    ],
    -- 4. Aprobación en vacío: solo lo que entra.
    [
      '  where nullif(it->>''producto_id'', '''') is not null;',
      '  where nullif(it->>''producto_id'', '''') is not null
    and (it->>''cantidad'')::numeric > 0;'
    ],
    -- 5. Sin producto: con todas las líneas presentes alcanza con mirar el
    --    payload. Un renglón que no vino (cantidad 0) no necesita producto.
    [
      '  select count(*)
    into v_sin_producto
  from ordenes_items oi
  where oi.orden_id = p_orden_id
    and oi.producto_id is null
    and not exists (
      select 1
      from jsonb_array_elements(p_items) as it
      where nullif(it->>''item_id'', '''')::uuid = oi.id
        and nullif(it->>''producto_id'', '''') is not null
    );',
      '  select count(*)
    into v_sin_producto
  from jsonb_array_elements(p_items) as it
  where nullif(it->>''producto_id'', '''') is null
    and (it->>''cantidad'')::numeric > 0;'
    ],
    -- 6. IMEI: solo lo que entra.
    [
      '    where nullif(it->>''producto_id'', '''') is not null
      and nullif(trim(coalesce(it->>''imei'', '''')), '''') is not null',
      '    where nullif(it->>''producto_id'', '''') is not null
      and (it->>''cantidad'')::numeric > 0
      and nullif(trim(coalesce(it->>''imei'', '''')), '''') is not null'
    ],
    [
      '    where nullif(it->>''producto_id'', '''') is not null
  ) x;',
      '    where nullif(it->>''producto_id'', '''') is not null
      and (it->>''cantidad'')::numeric > 0
  ) x;'
    ],
    -- 7. Cada renglón deja lo que de verdad entró, ANTES de saltear los que
    --    no mueven stock.
    [
      '    v_producto_id := nullif(v_item->>''producto_id'', '''')::uuid;
    if v_producto_id is null then
      continue;
    end if;',
      '    v_item_id  := nullif(v_item->>''item_id'', '''')::uuid;
    v_cantidad := coalesce((v_item->>''cantidad'')::numeric, 0);

    -- Lo que de verdad entro contra lo que decia el remito. NULL = igual.
    update ordenes_items
       set cantidad_recibida = case
             when v_cantidad = cantidad then null
             else v_cantidad
           end,
           motivo_ajuste = case
             when v_cantidad = cantidad then null
             else nullif(trim(coalesce(v_item->>''motivo_ajuste'', '''')), '''')
           end
     where id = v_item_id;

    v_producto_id := nullif(v_item->>''producto_id'', '''')::uuid;
    if v_producto_id is null or v_cantidad = 0 then
      continue;
    end if;'
    ]
  ];
  v_viejo text;
  v_nuevo text;
  v_veces int;
  i int;
begin
  select pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure)
    into v_def;

  if v_def not like '%REMITO_LINEAS_FALTANTES%' then
    raise exception 'aprobar_orden_compra_impl no tiene el guard de lineas exactas: no hay nada que revertir';
  end if;

  for i in 1 .. array_length(v_reemplazos, 1) loop
    v_viejo := v_reemplazos[i][2];
    v_nuevo := v_reemplazos[i][1];
    v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_veces <> 1 then
      raise exception 'Reemplazo % matchea % veces (se esperaba 1): %', i, v_veces, v_viejo;
    end if;
    v_def := replace(v_def, v_viejo, v_nuevo);
  end loop;

  execute v_def;

  -- Lo crítico sigue ahí (lo que se perdió una vez en 20260819180039).
  select pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure)
    into v_def;
  if v_def not like '%REMITO_VARIANTE_COLISION%'
     or v_def not like '%REMITO_SIN_LINEAS_IMPACTABLES%'
     or v_def not like '%REMITO_LINEAS_SIN_PRODUCTO%'
     or v_def not like '%REMITO_IMEI_REPETIDO%'
     or v_def not like '%insert into unidades_serie%'
     or v_def not like '%and estado <> ''APROBADA''%'
     or v_def not like '%ya_aprobada%'
     or v_def not like '%v_atributos = ''{}''::jsonb then producto_variantes.atributos%'
     or v_def not like '%insert into diccionario_alias%'
     or v_def not like '%actualizaciones_precio_items%'
     or v_def like '%REMITO_LINEAS_FALTANTES%'
     or v_def like '%cantidad_recibida%' then
    raise exception 'aprobar_orden_compra_impl perdió una salvaguarda';
  end if;

  if (select count(*) from pg_proc where proname = 'aprobar_orden_compra_impl') <> 1
     or (select count(*) from pg_proc where proname = 'aprobar_orden_compra') <> 1 then
    raise exception 'aprobar_orden_compra quedó con sobrecargas';
  end if;
end
$mig$;

alter table public.ordenes_items
  drop constraint if exists ordenes_items_cantidad_recibida_no_negativa,
  drop column if exists cantidad_recibida,
  drop column if exists motivo_ajuste;
