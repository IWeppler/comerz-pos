-- Aumento masivo de precios por MARCA y en UNA transacción (7/10/2026).
-- Detalle: docs/stock-y-catalogo.md ("Ajustes por marca y aplicación
-- transaccional"). Reversión: supabase/reversals/20261007160000_ajustes_precios_por_marca.sql
--
-- Antes `aplicarPreciosAction` escribía producto por producto desde Node, tomaba
-- el precio nuevo del navegador y un UPDATE fallido solo se logueaba (lote a
-- medias). Ahora la base recalcula, valida el alcance contra la simulación y
-- escribe todo o nada; reintentar con el mismo id no duplica.
-- "Recargo sobre costo" rechaza productos sin costo (quedarían a $0).
--
-- Funciones nuevas, INVOKER: el gate de admin y la RLS del negocio se suman.
-- No modifica cuerpos de RPC existentes ni datos del catálogo.
ALTER TABLE public.actualizaciones_precio ADD COLUMN alcance_valor text;

-- Espejo de normalizarMarca (NFD, quitar diacríticos, espacios colapsados).
-- No usamos unaccent: también translitera caracteres que NFD conserva (ej. ß).
CREATE FUNCTION public.normalizar_marca_precios(p_texto text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT nullif(btrim(regexp_replace(lower(regexp_replace(normalize(p_texto, NFD), U&'[\0300-\036f]', '', 'g')),
    U&'[\0009-\000d\0020\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]+', ' ', 'g')), '');
$$;

-- Espejo de calcularAjuste / aplicarRedondeo; fixtures comunes en TS y SQL.
CREATE FUNCTION public.calcular_ajuste_precio(p_costo numeric, p_precio numeric, p_campo text,
  p_operacion text, p_valor numeric, p_redondeo text)
RETURNS TABLE(costo numeric, precio numeric)
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_factor numeric := CASE p_operacion WHEN 'AUMENTAR_PORCENTAJE' THEN 1 + p_valor / 100
  WHEN 'REDUCIR_PORCENTAJE' THEN 1 - p_valor / 100 ELSE 1 END;
BEGIN
  costo := CASE WHEN p_campo = 'PRECIO' THEN p_costo ELSE round(p_costo * v_factor, 2) END;
  precio := p_precio;
  IF p_campo <> 'COSTO' THEN
    precio := CASE WHEN p_operacion = 'FIJAR_MARGEN' THEN coalesce(costo, 0) * (1 + p_valor / 100)
      ELSE coalesce(p_precio, 0) * v_factor END;
    precio := CASE p_redondeo
      WHEN 'SIN_REDONDEO' THEN round(precio, 2)
      WHEN '10' THEN ceil(precio / 10) * 10 WHEN '50' THEN ceil(precio / 50) * 50
      WHEN '100' THEN ceil(precio / 100) * 100
      WHEN '90' THEN floor(precio / 100) * 100 + 90
      WHEN '99' THEN floor(precio / 100) * 100 + 99 END;
  END IF;
  RETURN NEXT;
END $$;

CREATE FUNCTION public.aplicar_ajuste_precios(p_solicitud_id uuid, p_nombre text,
  p_alcance text, p_valor_alcance text, p_campo text, p_operacion text, p_valor numeric,
  p_redondeo text, p_producto_ids uuid[], p_prevision jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_negocio uuid := security.current_negocio_id(); v_lote public.actualizaciones_precio%ROWTYPE;
  v_producto public.productos%ROWTYPE; v_variante public.producto_variantes%ROWTYPE;
  v_ids uuid[]; v_costo numeric; v_precio numeric; v_alcance_valor text;
  v_filas integer; v_productos integer := 0; v_variantes integer := 0;
  v_sin_costo integer; v_nombres_sin_costo text;
BEGIN
  IF auth.uid() IS NULL OR v_negocio IS NULL OR NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Solo un administrador puede actualizar precios';
  END IF;
  IF p_solicitud_id IS NULL OR p_alcance IS NULL OR p_alcance NOT IN ('TODOS','CATEGORIA','SELECCION','MARCA')
    OR p_campo IS NULL OR p_campo NOT IN ('PRECIO','COSTO','AMBOS')
    OR p_operacion IS NULL OR p_operacion NOT IN ('AUMENTAR_PORCENTAJE','REDUCIR_PORCENTAJE','FIJAR_MARGEN')
    OR p_redondeo IS NULL OR p_redondeo NOT IN ('SIN_REDONDEO','10','50','100','90','99')
    OR p_valor IS NULL OR p_valor::text IN ('NaN','Infinity','-Infinity')
    OR p_valor < 0 OR p_valor >= 10000000000 OR round(p_valor, 2) <> p_valor
    OR (p_operacion = 'REDUCIR_PORCENTAJE' AND p_valor > 100)
    OR (p_operacion = 'FIJAR_MARGEN' AND p_campo = 'COSTO')
    OR coalesce(cardinality(p_producto_ids), 0) = 0 OR array_position(p_producto_ids, NULL) IS NOT NULL
    OR p_prevision IS NULL OR jsonb_typeof(p_prevision) <> 'array' THEN
    RAISE EXCEPTION 'Regla de precios inválida';
  END IF;
  IF p_alcance IN ('MARCA','CATEGORIA') AND public.normalizar_marca_precios(p_valor_alcance) IS NULL THEN
    RAISE EXCEPTION 'Elegí la marca o categoría';
  END IF;
  -- Serializa aplicar/deshacer del mismo negocio y hace idempotente un reintento.
  PERFORM pg_advisory_xact_lock(hashtextextended('ajustes-precios:' || v_negocio::text, 0));
  SELECT * INTO v_lote FROM public.actualizaciones_precio WHERE id = p_solicitud_id AND negocio_id = v_negocio;
  IF FOUND THEN
    IF v_lote.creado_por IS DISTINCT FROM auth.uid() OR v_lote.tipo_alcance <> p_alcance
      OR v_lote.campo_objetivo <> p_campo OR v_lote.tipo_operacion <> p_operacion
      OR v_lote.valor <> p_valor OR v_lote.redondeo IS DISTINCT FROM p_redondeo
      OR (SELECT array_agg(i.producto_id ORDER BY i.producto_id) FROM public.actualizaciones_precio_items i
        WHERE i.lote_id = p_solicitud_id AND i.negocio_id = v_negocio AND i.variante_id IS NULL)
        IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_producto_ids) x)
      OR (p_alcance = 'MARCA' AND public.normalizar_marca_precios(v_lote.alcance_valor) IS DISTINCT FROM public.normalizar_marca_precios(p_valor_alcance)) THEN
      RAISE EXCEPTION 'Esta solicitud ya se usó para otra regla';
    END IF;
    RETURN v_lote.id;
  END IF;

  IF p_alcance = 'CATEGORIA' THEN
    SELECT c.nombre INTO v_alcance_valor FROM public.categorias c
      WHERE c.negocio_id = v_negocio AND c.id = p_valor_alcance::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Categoría no disponible'; END IF;
  ELSIF p_alcance = 'MARCA' THEN v_alcance_valor := btrim(p_valor_alcance); END IF;

  SELECT array_agg(p.id ORDER BY p.id) INTO v_ids FROM public.productos p
    WHERE p.negocio_id = v_negocio AND CASE p_alcance
      WHEN 'TODOS' THEN true
      WHEN 'CATEGORIA' THEN p.categoria_id = p_valor_alcance::uuid
      WHEN 'MARCA' THEN public.normalizar_marca_precios(p.marca) = public.normalizar_marca_precios(p_valor_alcance)
      WHEN 'SELECCION' THEN p.id = ANY(p_producto_ids) ELSE false END;
  IF v_ids IS NULL OR v_ids IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(p_producto_ids) x) THEN
    RAISE EXCEPTION 'El alcance cambió o tiene productos inválidos. Volvé a simular';
  END IF;

  -- Orden estable de locks: primero productos, después variantes.
  PERFORM 1 FROM public.productos p WHERE p.negocio_id = v_negocio AND p.id = ANY(v_ids) ORDER BY p.id FOR UPDATE;
  PERFORM 1 FROM public.producto_variantes v WHERE v.negocio_id = v_negocio AND v.producto_id = ANY(v_ids) ORDER BY v.id FOR UPDATE;
  -- La preview no define el cálculo, pero evita aplicar sobre precios que
  -- cambiaron mientras la persona estaba revisando. Se chequea tras los locks.
  IF jsonb_array_length(p_prevision) <> cardinality(v_ids)
    OR v_ids IS DISTINCT FROM (SELECT array_agg((j->>'producto_id')::uuid ORDER BY (j->>'producto_id')::uuid)
      FROM jsonb_array_elements(p_prevision) j)
    OR EXISTS (SELECT 1 FROM public.productos p JOIN jsonb_array_elements(p_prevision) j ON p.id = (j->>'producto_id')::uuid
      WHERE p.negocio_id = v_negocio AND p.id = ANY(v_ids)
        AND (p.precio IS DISTINCT FROM (j->>'precio_anterior')::numeric
          OR coalesce(p.precio_costo, 0) IS DISTINCT FROM (j->>'costo_anterior')::numeric)) THEN
    RAISE EXCEPTION 'Los precios cambiaron desde la simulación. Volvé a simular';
  END IF;
  -- Recargo sobre costo sin costo cargado = precio $0, y el POS y el catálogo
  -- lo venderían a $0. Medido el 7/10/2026: Librería Colores tiene 795
  -- productos sin costo y El Nono Cacho 91 de 92. Se rechaza nombrándolos
  -- (espejo de `productosSinCostoParaRecargo` en ajuste-precios.ts).
  IF p_operacion = 'FIJAR_MARGEN' THEN
    SELECT count(*) INTO v_sin_costo FROM public.productos p
      WHERE p.negocio_id = v_negocio AND p.id = ANY(v_ids) AND coalesce(p.precio_costo, 0) <= 0;
    IF v_sin_costo > 0 THEN
      SELECT string_agg(x.nombre, ', ') INTO v_nombres_sin_costo FROM (
        SELECT coalesce(nullif(btrim(p.nombre), ''), 'Sin nombre') AS nombre FROM public.productos p
        WHERE p.negocio_id = v_negocio AND p.id = ANY(v_ids) AND coalesce(p.precio_costo, 0) <= 0
        ORDER BY lower(coalesce(nullif(btrim(p.nombre), ''), 'Sin nombre')) LIMIT 5) x;
      RAISE EXCEPTION 'SIN_COSTO_PARA_RECARGO: % producto(s) no tienen costo cargado y quedarían en $0 (%). Cargales el costo o sacalos del alcance',
        v_sin_costo, v_nombres_sin_costo;
    END IF;
  END IF;
  INSERT INTO public.actualizaciones_precio(id, negocio_id, nombre, tipo_alcance, alcance_valor,
    tipo_operacion, campo_objetivo, valor, redondeo, cantidad_afectada, creado_por)
    VALUES (p_solicitud_id, v_negocio, coalesce(nullif(btrim(p_nombre), ''),
      CASE WHEN p_alcance = 'MARCA' THEN
        CASE p_operacion WHEN 'REDUCIR_PORCENTAJE' THEN 'Reducción ' WHEN 'FIJAR_MARGEN' THEN 'Recargo ' ELSE 'Aumento ' END
        || v_alcance_valor || ' ' || p_valor::text || '%'
      ELSE 'Ajuste de precios' END), p_alcance, v_alcance_valor, p_operacion, p_campo, p_valor, p_redondeo, cardinality(v_ids), auth.uid());

  FOR v_producto IN SELECT * FROM public.productos p WHERE p.negocio_id = v_negocio AND p.id = ANY(v_ids) ORDER BY p.id LOOP
    SELECT a.costo, a.precio INTO v_costo, v_precio FROM public.calcular_ajuste_precio(
      v_producto.precio_costo, v_producto.precio, p_campo, p_operacion, p_valor, p_redondeo) a;
    IF v_precio < 0 OR v_costo < 0 OR v_precio >= 10000000000 OR v_costo >= 10000000000 THEN
      RAISE EXCEPTION 'El ajuste produce un importe inválido para %', v_producto.nombre;
    END IF;
    INSERT INTO public.actualizaciones_precio_items(lote_id, negocio_id, producto_id, variante_id,
      costo_anterior, costo_nuevo, precio_anterior, precio_nuevo)
      VALUES (p_solicitud_id, v_negocio, v_producto.id, NULL, v_producto.precio_costo, v_costo, v_producto.precio, v_precio);
    UPDATE public.productos SET precio_costo = v_costo, precio = v_precio, updated_at = clock_timestamp()
      WHERE id = v_producto.id AND negocio_id = v_negocio;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    IF v_filas <> 1 THEN RAISE EXCEPTION 'No se pudo actualizar %', v_producto.nombre; END IF;
    v_productos := v_productos + 1;

    -- Conserva la regla vigente: precio propio recibe el nuevo de cabecera,
    -- costo propio recibe el nuevo costo. Nunca convierte herencia en copia.
    FOR v_variante IN SELECT * FROM public.producto_variantes v WHERE v.negocio_id = v_negocio AND v.producto_id = v_producto.id
      AND ((p_campo IN ('PRECIO','AMBOS') AND v.precio IS NOT NULL) OR (p_campo IN ('COSTO','AMBOS') AND v.costo IS NOT NULL)) ORDER BY v.id LOOP
      INSERT INTO public.actualizaciones_precio_items(lote_id, negocio_id, producto_id, variante_id,
        costo_anterior, costo_nuevo, precio_anterior, precio_nuevo)
        VALUES (p_solicitud_id, v_negocio, v_producto.id, v_variante.id, v_variante.costo,
          CASE WHEN p_campo IN ('COSTO','AMBOS') AND v_variante.costo IS NOT NULL THEN v_costo ELSE v_variante.costo END,
          v_variante.precio, CASE WHEN p_campo IN ('PRECIO','AMBOS') AND v_variante.precio IS NOT NULL THEN v_precio ELSE v_variante.precio END);
      UPDATE public.producto_variantes SET
        costo = CASE WHEN p_campo IN ('COSTO','AMBOS') AND costo IS NOT NULL THEN v_costo ELSE costo END,
        precio = CASE WHEN p_campo IN ('PRECIO','AMBOS') AND precio IS NOT NULL THEN v_precio ELSE precio END,
        updated_at = clock_timestamp() WHERE id = v_variante.id AND negocio_id = v_negocio AND producto_id = v_producto.id;
      GET DIAGNOSTICS v_filas = ROW_COUNT;
      IF v_filas <> 1 THEN RAISE EXCEPTION 'No se pudo actualizar la variante %', v_variante.id; END IF;
      v_variantes := v_variantes + 1;
    END LOOP;
  END LOOP;
  SELECT count(*) INTO v_filas FROM public.actualizaciones_precio_items WHERE lote_id = p_solicitud_id AND negocio_id = v_negocio;
  IF v_productos <> cardinality(v_ids) OR v_filas <> v_productos + v_variantes THEN
    RAISE EXCEPTION 'El ajuste quedó incompleto';
  END IF;
  RETURN p_solicitud_id;
END $$;

CREATE FUNCTION public.revertir_ajuste_precios(p_lote_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_negocio uuid := security.current_negocio_id(); v_item public.actualizaciones_precio_items%ROWTYPE;
  v_estado text; v_filas integer;
BEGIN
  IF auth.uid() IS NULL OR v_negocio IS NULL OR NOT coalesce(public.is_admin(), false) THEN
    RAISE EXCEPTION 'Solo un administrador puede revertir precios';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('ajustes-precios:' || v_negocio::text, 0));
  SELECT estado INTO v_estado FROM public.actualizaciones_precio WHERE id = p_lote_id AND negocio_id = v_negocio FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se encontró el ajuste'; END IF;
  IF v_estado = 'REVERTIDO' THEN RETURN; END IF;
  IF v_estado <> 'APLICADO' THEN RAISE EXCEPTION 'El ajuste no está aplicado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.actualizaciones_precio_items WHERE lote_id = p_lote_id AND negocio_id = v_negocio) THEN
    RAISE EXCEPTION 'El ajuste no tiene auditoría para deshacer';
  END IF;
  PERFORM 1 FROM public.productos p WHERE p.negocio_id = v_negocio AND p.id IN
    (SELECT i.producto_id FROM public.actualizaciones_precio_items i WHERE i.lote_id = p_lote_id AND i.negocio_id = v_negocio) ORDER BY p.id FOR UPDATE;
  PERFORM 1 FROM public.producto_variantes v WHERE v.negocio_id = v_negocio AND v.id IN
    (SELECT i.variante_id FROM public.actualizaciones_precio_items i WHERE i.lote_id = p_lote_id AND i.negocio_id = v_negocio) ORDER BY v.id FOR UPDATE;
  FOR v_item IN SELECT * FROM public.actualizaciones_precio_items WHERE lote_id = p_lote_id AND negocio_id = v_negocio ORDER BY creado_en, id LOOP
    IF v_item.variante_id IS NOT NULL THEN
      -- Una variante eliminada se omite; nunca cae al UPDATE de cabecera.
      IF EXISTS (SELECT 1 FROM public.producto_variantes WHERE id = v_item.variante_id AND producto_id = v_item.producto_id AND negocio_id = v_negocio) THEN
        UPDATE public.producto_variantes SET precio = v_item.precio_anterior, costo = v_item.costo_anterior, updated_at = clock_timestamp()
          WHERE id = v_item.variante_id AND producto_id = v_item.producto_id AND negocio_id = v_negocio;
        GET DIAGNOSTICS v_filas = ROW_COUNT;
        IF v_filas <> 1 THEN RAISE EXCEPTION 'No se pudo restaurar la variante'; END IF;
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.productos WHERE id = v_item.producto_id AND negocio_id = v_negocio) THEN
      UPDATE public.productos SET precio = v_item.precio_anterior, precio_costo = v_item.costo_anterior, updated_at = clock_timestamp()
        WHERE id = v_item.producto_id AND negocio_id = v_negocio;
      GET DIAGNOSTICS v_filas = ROW_COUNT;
      IF v_filas <> 1 THEN RAISE EXCEPTION 'No se pudo restaurar el producto'; END IF;
    END IF;
  END LOOP;
  UPDATE public.actualizaciones_precio SET estado = 'REVERTIDO', revertido_en = clock_timestamp()
    WHERE id = p_lote_id AND negocio_id = v_negocio AND estado = 'APLICADO';
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas <> 1 THEN RAISE EXCEPTION 'No se pudo cerrar la reversión'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.normalizar_marca_precios(text), public.calcular_ajuste_precio(numeric,numeric,text,text,numeric,text),
  public.aplicar_ajuste_precios(uuid,text,text,text,text,text,numeric,text,uuid[],jsonb), public.revertir_ajuste_precios(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalizar_marca_precios(text), public.calcular_ajuste_precio(numeric,numeric,text,text,numeric,text),
  public.aplicar_ajuste_precios(uuid,text,text,text,text,text,numeric,text,uuid[],jsonb), public.revertir_ajuste_precios(uuid) TO authenticated;

DO $$
DECLARE v_func regprocedure;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'actualizaciones_precio'
    AND column_name = 'alcance_valor' AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'Falta alcance_valor nullable';
  END IF;
  FOREACH v_func IN ARRAY ARRAY['public.aplicar_ajuste_precios(uuid,text,text,text,text,text,numeric,text,uuid[],jsonb)'::regprocedure,
    'public.revertir_ajuste_precios(uuid)'::regprocedure] LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = v_func) OR has_function_privilege('anon', v_func, 'EXECUTE')
      OR NOT has_function_privilege('authenticated', v_func, 'EXECUTE')
      OR position('public.is_admin()' IN pg_get_functiondef(v_func)) = 0
      OR (v_func = 'public.aplicar_ajuste_precios(uuid,text,text,text,text,text,numeric,text,uuid[],jsonb)'::regprocedure
          AND position('SIN_COSTO_PARA_RECARGO' IN pg_get_functiondef(v_func)) = 0)
      OR position('security.current_negocio_id()' IN pg_get_functiondef(v_func)) = 0 THEN
      RAISE EXCEPTION 'Permisos o aislamiento inválidos en %', v_func;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('aplicar_ajuste_precios','revertir_ajuste_precios')) <> 2 THEN
    RAISE EXCEPTION 'Hay sobrecargas inesperadas de ajustes';
  END IF;
END $$;
