-- Revierte 20260908190000: `aprobar_orden_compra_impl` vuelve a escribir solo
-- `productos.precio` (sin bajarlo a las variantes) y sin auditar el cambio.
--
-- Deshace exactamente los mismos reemplazos, en sentido inverso y sobre el
-- cuerpo VIVO. Cada bloque se verifica ÚNICO antes de sacarlo: si alguien tocó
-- la función en el medio, esto falla en vez de dejar un cuerpo a medias.
--
-- Lo que NO deshace, a propósito:
--   * Las filas ya escritas en `actualizaciones_precio(_items)` con
--     tipo_operacion REMITO. Son historia de precios que sí ocurrieron;
--     borrarlas es perder justo el rastro que la migración vino a crear.
--   * Los precios de variante que ya se alinearon. Para eso está "Deshacer"
--     en el historial de precios, lote por lote — que es la operación que la
--     persona entiende y puede revisar antes de confirmar.
--
-- Bajar esta migración exige bajar también el código: `merge-purchase.ts` lee
-- `variantes_conservadas` del resultado (cae a 0, inofensivo) y el historial
-- de precios rotula los lotes REMITO que van a quedar en la tabla.

do $$
declare
  v_def text;
  v_ancla text;
  v_nuevo text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'aprobar_orden_compra_impl';

  if v_def is null then
    raise exception 'GUARD: no existe public.aprobar_orden_compra_impl';
  end if;

  -- Bloque 1, al reves.
  v_ancla :=
'  v_lote_id uuid;
  v_precio_viejo numeric;
  v_costo_viejo numeric;
  v_precio_efectivo numeric;
  v_costo_efectivo numeric;
  v_precio_final numeric;
  v_costo_final numeric;
  v_filas integer;
  v_productos_reprecio integer := 0;
  v_variantes_alineadas integer := 0;
  v_variantes_conservadas integer := 0;

  v_lineas integer := 0;';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el bloque 1 de 20260908190000 no aparece exactamente una vez; la funcion no es la que dejo esa migracion';
  end if;
  v_nuevo :=
'  v_lineas integer := 0;';
  v_def := replace(v_def, v_ancla, v_nuevo);

  -- Bloque 2, al reves.
  v_ancla :=
'    if not (v_producto_id = any (v_productos_actualizados)) then
      if coalesce(v_precio_costo, 0) <> 0 or coalesce(v_precio_venta, 0) <> 0 then
        -- El precio viejo se lee DOS veces: el de cabecera (lo que hay que
        -- auditar) y el EFECTIVO (lo que se estaba cobrando). En 30 productos
        -- no son el mismo numero. Misma expresion que la vista
        -- productos_precio_efectivo, 20260908180000.
        select
          p.precio,
          p.precio_costo,
          case
            when v.total > 0 and v.con_precio = v.total and v.precios_distintos = 1
              then v.precio_unico
            else p.precio
          end,
          case
            when v.total > 0 and v.con_costo = v.total and v.costos_distintos = 1
              then v.costo_unico
            else p.precio_costo
          end
          into v_precio_viejo, v_costo_viejo, v_precio_efectivo, v_costo_efectivo
        from productos p
        left join lateral (
          select
            count(*)                  as total,
            count(pv.precio)          as con_precio,
            count(distinct pv.precio) as precios_distintos,
            min(pv.precio)            as precio_unico,
            count(pv.costo)           as con_costo,
            count(distinct pv.costo)  as costos_distintos,
            min(pv.costo)             as costo_unico
          from producto_variantes pv
          where pv.producto_id = p.id
        ) v on true
        where p.id = v_producto_id;

        v_precio_final := case
          when coalesce(v_precio_venta, 0) <> 0 then v_precio_venta
          else v_precio_viejo
        end;
        v_costo_final := case
          when coalesce(v_precio_costo, 0) <> 0 then v_precio_costo
          else v_costo_viejo
        end;

        update productos
        set precio_costo = v_costo_final,
            precio = v_precio_final
        where id = v_producto_id;

        if v_precio_final is distinct from v_precio_viejo
           or v_costo_final is distinct from v_costo_viejo
        then
          -- Lote perezoso: un remito que no mueve ningun precio no deja fila.
          if v_lote_id is null then
            insert into actualizaciones_precio (
              negocio_id, nombre, tipo_alcance, tipo_operacion,
              campo_objetivo, valor, redondeo, cantidad_afectada, creado_por
            )
            values (
              coalesce(v_negocio_id, security.current_negocio_id()),
              ''Ingreso de mercaderia - '' || coalesce(nullif(trim(p_proveedor), ''''), ''sin proveedor''),
              ''REMITO'', ''REMITO'', ''AMBOS'', 0, ''SIN_REDONDEO'', 0, auth.uid()
            )
            returning id into v_lote_id;
          end if;

          insert into actualizaciones_precio_items (
            negocio_id, lote_id, producto_id, variante_id,
            costo_anterior, costo_nuevo, precio_anterior, precio_nuevo
          )
          values (
            coalesce(v_negocio_id, security.current_negocio_id()),
            v_lote_id, v_producto_id, null,
            coalesce(v_costo_viejo, 0), coalesce(v_costo_final, 0),
            coalesce(v_precio_viejo, 0), coalesce(v_precio_final, 0)
          );

          v_productos_reprecio := v_productos_reprecio + 1;

          -- La auditoria de las variantes va ANTES del update: despues, el
          -- valor anterior ya no esta en ningun lado.
          insert into actualizaciones_precio_items (
            negocio_id, lote_id, producto_id, variante_id,
            costo_anterior, costo_nuevo, precio_anterior, precio_nuevo
          )
          select
            coalesce(v_negocio_id, security.current_negocio_id()),
            v_lote_id, v_producto_id, pv.id,
            coalesce(pv.costo, 0),
            coalesce(case when pv.costo = v_costo_efectivo then v_costo_final else pv.costo end, 0),
            coalesce(pv.precio, 0),
            coalesce(case when pv.precio = v_precio_efectivo then v_precio_final else pv.precio end, 0)
          from producto_variantes pv
          where pv.producto_id = v_producto_id
            and (
              (pv.precio = v_precio_efectivo and pv.precio is distinct from v_precio_final)
              or (pv.costo = v_costo_efectivo and pv.costo is distinct from v_costo_final)
            );

          -- Solo la variante cuyo precio propio era una COPIA del que se
          -- cobraba. La que decia otra cosa es un precio especial y se
          -- respeta. `pv.precio = v_precio_efectivo` ya descarta los NULL:
          -- esos heredan de la cabecera y no hay nada que mover.
          update producto_variantes pv
          set precio = case
                when pv.precio = v_precio_efectivo then v_precio_final
                else pv.precio
              end,
              costo = case
                when pv.costo = v_costo_efectivo then v_costo_final
                else pv.costo
              end,
              updated_at = now()
          where pv.producto_id = v_producto_id
            and (
              (pv.precio = v_precio_efectivo and pv.precio is distinct from v_precio_final)
              or (pv.costo = v_costo_efectivo and pv.costo is distinct from v_costo_final)
            );

          get diagnostics v_filas = row_count;
          v_variantes_alineadas := v_variantes_alineadas + v_filas;

          select count(*)
            into v_filas
          from producto_variantes pv
          where pv.producto_id = v_producto_id
            and pv.precio is not null
            and pv.precio is distinct from v_precio_final;

          v_variantes_conservadas := v_variantes_conservadas + v_filas;
        end if;
      end if;
';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el bloque 2 de 20260908190000 no aparece exactamente una vez; la funcion no es la que dejo esa migracion';
  end if;
  v_nuevo :=
'    if not (v_producto_id = any (v_productos_actualizados)) then
      if coalesce(v_precio_costo, 0) <> 0 or coalesce(v_precio_venta, 0) <> 0 then
        update productos
        set
          precio_costo = case
            when coalesce(v_precio_costo, 0) <> 0 then v_precio_costo
            else precio_costo
          end,
          precio = case
            when coalesce(v_precio_venta, 0) <> 0 then v_precio_venta
            else precio
          end
        where id = v_producto_id;
      end if;
';
  v_def := replace(v_def, v_ancla, v_nuevo);

  -- Bloque 3, al reves.
  v_ancla :=
'  if v_lote_id is not null then
    update actualizaciones_precio
    set cantidad_afectada = v_productos_reprecio
    where id = v_lote_id;
  end if;

  return jsonb_build_object(
    ''ya_aprobada'', false,';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el bloque 3 de 20260908190000 no aparece exactamente una vez; la funcion no es la que dejo esa migracion';
  end if;
  v_nuevo :=
'  return jsonb_build_object(
    ''ya_aprobada'', false,';
  v_def := replace(v_def, v_ancla, v_nuevo);

  -- Bloque 4, al reves.
  v_ancla :=
'    ''imeis_creados'', v_imeis_creados,
    ''productos_reprecio'', v_productos_reprecio,
    ''variantes_alineadas'', v_variantes_alineadas,
    ''variantes_conservadas'', v_variantes_conservadas
  );';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el bloque 4 de 20260908190000 no aparece exactamente una vez; la funcion no es la que dejo esa migracion';
  end if;
  v_nuevo :=
'    ''imeis_creados'', v_imeis_creados
  );';
  v_def := replace(v_def, v_ancla, v_nuevo);

  -- Bloque 5, al reves.
  v_ancla :=
'      ''alias_registrados'', 0,
      ''imeis_creados'', 0,
      ''productos_reprecio'', 0,
      ''variantes_alineadas'', 0,
      ''variantes_conservadas'', 0
    );';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el bloque 5 de 20260908190000 no aparece exactamente una vez; la funcion no es la que dejo esa migracion';
  end if;
  v_nuevo :=
'      ''alias_registrados'', 0,
      ''imeis_creados'', 0
    );';
  v_def := replace(v_def, v_ancla, v_nuevo);

  execute v_def;
end $$;

do $guard$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'aprobar_orden_compra_impl';

  if position('actualizaciones_precio' in v_def) > 0 then
    raise exception 'GUARD: la reversion dejo la auditoria de precios adentro';
  end if;
  if position('unidades_serie' in v_def) = 0 then
    raise exception 'GUARD: la reversion se llevo puesta la creacion de unidades_serie';
  end if;
end $guard$;

comment on function public.aprobar_orden_compra_impl(uuid, text, jsonb) is
  'Impacta un remito: precios, stock, variantes, IMEI y alias, en una transaccion.';
