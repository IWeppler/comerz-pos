-- Tres lugares donde la carga de variantes con IMEI perdía o escondía datos
-- sin avisar. Salió de la auditoría del Samsung A56 de ClickTostado
-- (1/10/2026, ver 20261001130000).
--
-- 1. guardar_variantes_producto_impl: si dos filas del payload caían en la
--    misma identidad (atributos_comparables), la segunda se SALTEABA con
--    `CONTINUE WHEN` y su stock se perdía sin error. Pasa cuando se corrige
--    un valor y queda igual a otra combinación ("12/257" → "12/256" con la
--    12/256 ya existente). Ahora falla con VARIANTES_REPETIDAS y el nombre.
--
-- 2. guardar_variantes_producto_impl: borrar (o renombrar, que para la RPC es
--    insertar la nueva y borrar la vieja) una variante con IMEI chocaba contra
--    el FK RESTRICT de unidades_serie y la pantalla mostraba "hace referencia a
--    un registro que ya no existe". Ahora falla ANTES con VARIANTE_CON_IMEI y
--    el nombre de la variante. El FK sigue siendo el freno de fondo.
--
-- 3. aprobar_orden_compra_impl: un IMEI repetido (dos veces en el remito, o ya
--    cargado en el comercio) hacía `on conflict do nothing`: el stock se sumaba
--    y la unidad no se creaba, sin aviso. Ahora el remito no se aprueba
--    (REMITO_IMEI_REPETIDO con los números) y el `on conflict` se quita: una
--    carrera entre dos remitos termina en error de unicidad, no en silencio.
--    El guard va DESPUÉS del de idempotencia: re-aprobar una orden aprobada
--    sigue devolviendo {ya_aprobada: true} (sus IMEI ya existen, a propósito).
--
-- Se parchea el cuerpo VIVO (`pg_get_functiondef` + `replace`), con guard de
-- que cada reemplazo matchea exactamente una vez y de que lo crítico sigue.

do $$
declare
  v_def text;
  v_nuevo text;

  -- guardar_variantes_producto_impl
  g_decl_viejo constant text := E'  v_clave text;\nBEGIN';
  g_decl_nuevo constant text := E'  v_clave text;\n  v_con_imei text;\nBEGIN';

  g_skip_viejo constant text :=
    E'    CONTINUE WHEN v_clave = ANY (v_claves_entrantes);\n';
  g_skip_nuevo constant text :=
    E'    IF v_clave = ANY (v_claves_entrantes) THEN\n'
    || E'      RAISE EXCEPTION ''VARIANTES_REPETIDAS: "%" aparece dos veces; dos combinaciones quedaron iguales y una perdería su stock'',\n'
    || E'        v_nueva->>''nombre_display''\n'
    || E'        USING errcode = ''P0001'';\n'
    || E'    END IF;\n';

  g_del_viejo constant text :=
    E'  FOR v_existente IN SELECT * FROM jsonb_array_elements(v_existentes)\n'
    || E'  LOOP\n'
    || E'    IF NOT ((v_existente->>''clave'') = ANY (v_claves_entrantes)) THEN';
  g_del_nuevo constant text :=
    E'  SELECT string_agg(DISTINCT ve->>''nombre_display'', '', '')\n'
    || E'    INTO v_con_imei\n'
    || E'    FROM jsonb_array_elements(v_existentes) AS ve\n'
    || E'   WHERE NOT ((ve->>''clave'') = ANY (v_claves_entrantes))\n'
    || E'     AND EXISTS (\n'
    || E'       SELECT 1 FROM public.unidades_serie u\n'
    || E'        WHERE u.producto_variante_id = (ve->>''id'')::uuid\n'
    || E'     );\n'
    || E'\n'
    || E'  IF v_con_imei IS NOT NULL THEN\n'
    || E'    RAISE EXCEPTION ''VARIANTE_CON_IMEI: %'', v_con_imei\n'
    || E'      USING errcode = ''P0001'';\n'
    || E'  END IF;\n'
    || E'\n'
    || g_del_viejo;

  -- aprobar_orden_compra_impl
  a_loop_viejo constant text :=
    E'  for v_item in select * from jsonb_array_elements(p_items)\n  loop\n';
  a_loop_nuevo constant text :=
    E'  -- GUARD DE IMEI REPETIDO: despues del de idempotencia, antes de escribir.\n'
    || E'  select string_agg(x.imei, '', '' order by x.imei)\n'
    || E'    into v_colisiones\n'
    || E'  from (\n'
    || E'    select trim(it->>''imei'') || '' (dos veces en el remito)'' as imei\n'
    || E'    from jsonb_array_elements(p_items) as it\n'
    || E'    where nullif(it->>''producto_id'', '''') is not null\n'
    || E'      and nullif(trim(coalesce(it->>''imei'', '''')), '''') is not null\n'
    || E'    group by trim(it->>''imei'')\n'
    || E'    having count(*) > 1\n'
    || E'    union all\n'
    || E'    select distinct u.imei || '' (ya cargado, '' || u.estado || '')''\n'
    || E'    from jsonb_array_elements(p_items) as it\n'
    || E'    join unidades_serie u\n'
    || E'      on u.negocio_id = v_negocio_id\n'
    || E'     and u.imei = trim(it->>''imei'')\n'
    || E'    where nullif(it->>''producto_id'', '''') is not null\n'
    || E'  ) x;\n'
    || E'\n'
    || E'  if v_colisiones is not null then\n'
    || E'    raise exception\n'
    || E'      ''REMITO_IMEI_REPETIDO: estos IMEI no pueden entrar: %. Corregí o sacá el IMEI de esas filas y volvé a aprobar'',\n'
    || E'      v_colisiones\n'
    || E'      using errcode = ''P0001'';\n'
    || E'  end if;\n'
    || E'\n'
    || a_loop_viejo;

  a_conflict_viejo constant text :=
    E'      )\n      on conflict (negocio_id, imei) do nothing;\n';
  a_conflict_nuevo constant text :=
    E'      );\n';

  function_cuenta int;
begin
  ---------------------------------------------------------------------------
  -- 1 y 2. guardar_variantes_producto_impl
  ---------------------------------------------------------------------------
  select count(*) into function_cuenta
    from pg_proc where proname = 'guardar_variantes_producto_impl'
     and pronamespace = 'public'::regnamespace;
  if function_cuenta <> 1 then
    raise exception 'guardar_variantes_producto_impl: se esperaba 1 función, hay %', function_cuenta;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'guardar_variantes_producto_impl'
     and p.pronamespace = 'public'::regnamespace;

  if (length(v_def) - length(replace(v_def, g_decl_viejo, ''))) / length(g_decl_viejo) <> 1 then
    raise exception 'guardar_variantes_producto_impl: el DECLARE cambió';
  end if;
  if (length(v_def) - length(replace(v_def, g_skip_viejo, ''))) / length(g_skip_viejo) <> 1 then
    raise exception 'guardar_variantes_producto_impl: el CONTINUE WHEN no aparece exactamente una vez';
  end if;
  if (length(v_def) - length(replace(v_def, g_del_viejo, ''))) / length(g_del_viejo) <> 1 then
    raise exception 'guardar_variantes_producto_impl: el loop de borrado no aparece exactamente una vez';
  end if;

  v_nuevo := replace(replace(replace(v_def,
               g_decl_viejo, g_decl_nuevo),
               g_skip_viejo, g_skip_nuevo),
               g_del_viejo, g_del_nuevo);
  execute v_nuevo;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'guardar_variantes_producto_impl'
     and p.pronamespace = 'public'::regnamespace;
  if position('VARIANTES_REPETIDAS' in v_def) = 0
     or position('VARIANTE_CON_IMEI' in v_def) = 0
     or position('CONTINUE WHEN' in v_def) > 0
     or position('BLOQUEADO_FALTANTE' in v_def) = 0
     or position('p_confirmadas_eliminar' in v_def) = 0
     or position('SECURITY DEFINER' in v_def) > 0 then
    raise exception 'guardar_variantes_producto_impl: el parche no quedó o se perdió el freno de faltantes';
  end if;

  ---------------------------------------------------------------------------
  -- 3. aprobar_orden_compra_impl
  ---------------------------------------------------------------------------
  select count(*) into function_cuenta
    from pg_proc where proname = 'aprobar_orden_compra_impl'
     and pronamespace = 'public'::regnamespace;
  if function_cuenta <> 1 then
    raise exception 'aprobar_orden_compra_impl: se esperaba 1 función, hay %', function_cuenta;
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'aprobar_orden_compra_impl'
     and p.pronamespace = 'public'::regnamespace;

  if (length(v_def) - length(replace(v_def, a_loop_viejo, ''))) / length(a_loop_viejo) <> 1 then
    raise exception 'aprobar_orden_compra_impl: el loop principal no aparece exactamente una vez';
  end if;
  if (length(v_def) - length(replace(v_def, a_conflict_viejo, ''))) / length(a_conflict_viejo) <> 1 then
    raise exception 'aprobar_orden_compra_impl: el on conflict de unidades_serie no aparece exactamente una vez';
  end if;
  -- El guard nuevo tiene que quedar DESPUÉS del de idempotencia.
  if position('if not found then' in v_def) = 0
     or position('if not found then' in v_def) > position(a_loop_viejo in v_def) then
    raise exception 'aprobar_orden_compra_impl: el guard de idempotencia no está antes del loop';
  end if;

  v_nuevo := replace(replace(v_def,
               a_loop_viejo, a_loop_nuevo),
               a_conflict_viejo, a_conflict_nuevo);
  execute v_nuevo;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'aprobar_orden_compra_impl'
     and p.pronamespace = 'public'::regnamespace;
  if position('REMITO_IMEI_REPETIDO' in v_def) = 0
     or position('do nothing' in v_def) > 0
     or position('insert into unidades_serie' in v_def) = 0
     or position('REMITO_LINEAS_SIN_PRODUCTO' in v_def) = 0
     or position('REMITO_VARIANTE_COLISION' in v_def) = 0
     or position('ya_aprobada' in v_def) = 0
     or position('atributos_comparables' in v_def) = 0 then
    raise exception 'aprobar_orden_compra_impl: el parche no quedó o se perdió un guard existente';
  end if;
  if position('REMITO_IMEI_REPETIDO' in v_def) < position('ya_aprobada' in v_def) then
    raise exception 'aprobar_orden_compra_impl: el guard de IMEI quedó antes del de idempotencia';
  end if;
end $$;
