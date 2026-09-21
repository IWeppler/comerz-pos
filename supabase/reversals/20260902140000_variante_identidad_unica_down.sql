-- Rollback de 20260902140000_variante_identidad_unica.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- Saca el índice único y devuelve `guardar_variantes_producto_impl` a la
-- versión de 20260902110000 (upsert, pero SIN deduplicar el payload).
--
-- OJO: volver acá reabre el agujero por el que se crean variantes duplicadas
-- —dos entradas del payload con la misma identidad canónica y ninguna que
-- machee una existente entran como dos filas— que es el que produjo
-- "CARGO IMPERMEABLE 2 EN 1". Y reabre el 23505 de `productos_stock` cuando
-- además comparten `nombre_display`.
--
-- El índice se saca PRIMERO: mientras esté, la versión vieja de la función
-- puede fallar con una violación de unicidad en vez de crear el duplicado.

begin;

drop index if exists public.idx_variante_identidad;

-- El cuerpo de 20260902110000, sin el bloque de deduplicación. Está escrito
-- entero a propósito: reconstruirlo de memoria en una emergencia es cómo se
-- pierde el freno de faltantes.
create or replace function public.guardar_variantes_producto_impl(
  p_producto_id uuid,
  p_negocio_id uuid,
  p_variantes jsonb,
  p_editado_por uuid,
  p_confirmadas_eliminar jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
DECLARE
  v_existentes jsonb;
  v_faltantes_no_confirmados int := 0;
  v_existente jsonb;
  v_nueva jsonb;
  v_new_id uuid;
  v_stock_input text;
  v_stock numeric(12,3);
  v_relacion jsonb;
  v_auditoria jsonb[] := '{}';
  v_confirmada boolean;
  v_claves_entrantes text[] := '{}';
BEGIN
  IF p_negocio_id IS NULL THEN
    RAISE EXCEPTION 'guardar_variantes_producto requiere un negocio activo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.productos
    WHERE id = p_producto_id AND negocio_id = p_negocio_id
  ) THEN
    RAISE EXCEPTION 'El producto no pertenece al negocio activo';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', pv.id,
           'atributos', pv.atributos,
           'clave', public.atributos_comparables(pv.atributos),
           'nombre_display', pv.nombre_display,
           'precio', pv.precio,
           'costo', pv.costo,
           'stock', pv.stock
         )), '[]'::jsonb)
    INTO v_existentes
    FROM public.producto_variantes pv
    WHERE pv.producto_id = p_producto_id
      AND pv.negocio_id = p_negocio_id;

  FOR v_existente IN SELECT * FROM jsonb_array_elements(v_existentes)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_variantes) AS nv
      WHERE public.atributos_comparables(nv->'atributos') = (v_existente->>'clave')
    ) THEN
      v_confirmada := EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_confirmadas_eliminar) AS ce
        WHERE public.atributos_comparables(ce) = (v_existente->>'clave')
      );

      IF NOT v_confirmada AND coalesce((v_existente->>'stock')::numeric, 0) > 0 THEN
        v_faltantes_no_confirmados := v_faltantes_no_confirmados + 1;

        INSERT INTO public.producto_variantes_auditoria (
          negocio_id, producto_id, variante_id_anterior, variante_id_nueva,
          atributos, nombre_display, accion, stock_anterior, stock_nuevo,
          precio_anterior, precio_nuevo, costo_anterior, costo_nuevo,
          editado_por
        ) VALUES (
          p_negocio_id, p_producto_id, (v_existente->>'id')::uuid, NULL,
          v_existente->'atributos', v_existente->>'nombre_display',
          'BLOQUEADO_FALTANTE', (v_existente->>'stock')::numeric, NULL,
          (v_existente->>'precio')::numeric, NULL,
          (v_existente->>'costo')::numeric, NULL, p_editado_por
        );
      END IF;
    END IF;
  END LOOP;

  IF v_faltantes_no_confirmados > 0 THEN
    RETURN jsonb_build_object(
      'success', false, 'blocked', true, 'faltantes', v_faltantes_no_confirmados
    );
  END IF;

  DELETE FROM public.productos_stock
   WHERE producto_id = p_producto_id AND negocio_id = p_negocio_id;

  FOR v_nueva IN SELECT * FROM jsonb_array_elements(p_variantes)
  LOOP
    SELECT ve INTO v_existente
      FROM jsonb_array_elements(v_existentes) AS ve
      WHERE (ve->>'clave') = public.atributos_comparables(v_nueva->'atributos')
      LIMIT 1;

    v_claves_entrantes := v_claves_entrantes
      || public.atributos_comparables(v_nueva->'atributos');

    v_stock_input := NULLIF(trim(v_nueva->>'stock_input'), '');
    IF v_stock_input IS NOT NULL THEN
      v_stock := replace(v_stock_input, ',', '.')::numeric;
    ELSE
      v_stock := coalesce((v_existente->>'stock')::numeric, 0);
    END IF;

    IF v_existente IS NULL THEN
      INSERT INTO public.producto_variantes (
        negocio_id, producto_id, nombre_display, atributos, precio, costo, stock, sku
      ) VALUES (
        p_negocio_id, p_producto_id, v_nueva->>'nombre_display',
        v_nueva->'atributos', NULLIF(v_nueva->>'precio', '')::numeric,
        NULLIF(v_nueva->>'costo', '')::numeric, v_stock, NULLIF(v_nueva->>'sku', '')
      )
      RETURNING id INTO v_new_id;
    ELSE
      UPDATE public.producto_variantes
         SET nombre_display = v_nueva->>'nombre_display',
             atributos      = v_nueva->'atributos',
             precio         = NULLIF(v_nueva->>'precio', '')::numeric,
             costo          = NULLIF(v_nueva->>'costo', '')::numeric,
             stock          = v_stock,
             sku            = NULLIF(v_nueva->>'sku', ''),
             updated_at     = now()
       WHERE id = (v_existente->>'id')::uuid
      RETURNING id INTO v_new_id;

      DELETE FROM public.producto_variante_valores WHERE variante_id = v_new_id;
    END IF;

    FOR v_relacion IN SELECT * FROM jsonb_array_elements(coalesce(v_nueva->'relaciones', '[]'::jsonb))
    LOOP
      INSERT INTO public.producto_variante_valores (
        negocio_id, variante_id, atributo_id, atributo_valor_id
      ) VALUES (
        p_negocio_id, v_new_id,
        (v_relacion->>'atributo_id')::uuid, (v_relacion->>'atributo_valor_id')::uuid
      );
    END LOOP;

    INSERT INTO public.productos_stock (negocio_id, producto_id, variante, cantidad)
    VALUES (p_negocio_id, p_producto_id, v_nueva->>'nombre_display', v_stock);

    v_auditoria := v_auditoria || jsonb_build_object(
      'producto_id', p_producto_id,
      'variante_id_anterior', v_existente->>'id',
      'variante_id_nueva', v_new_id,
      'atributos', v_nueva->'atributos',
      'nombre_display', v_nueva->>'nombre_display',
      'accion', CASE WHEN v_existente IS NULL THEN 'CREADA' ELSE 'ACTUALIZADA' END,
      'stock_anterior', v_existente->>'stock',
      'stock_nuevo', v_stock,
      'precio_anterior', v_existente->>'precio',
      'precio_nuevo', NULLIF(v_nueva->>'precio', ''),
      'costo_anterior', v_existente->>'costo',
      'costo_nuevo', NULLIF(v_nueva->>'costo', ''),
      'editado_por', p_editado_por
    );

    v_existente := NULL;
  END LOOP;

  FOR v_existente IN SELECT * FROM jsonb_array_elements(v_existentes)
  LOOP
    IF NOT ((v_existente->>'clave') = ANY (v_claves_entrantes)) THEN
      DELETE FROM public.producto_variantes
       WHERE id = (v_existente->>'id')::uuid;

      v_auditoria := v_auditoria || jsonb_build_object(
        'producto_id', p_producto_id,
        'variante_id_anterior', v_existente->>'id',
        'variante_id_nueva', NULL,
        'atributos', v_existente->'atributos',
        'nombre_display', v_existente->>'nombre_display',
        'accion', 'ELIMINADA',
        'stock_anterior', v_existente->>'stock',
        'stock_nuevo', NULL,
        'precio_anterior', v_existente->>'precio',
        'precio_nuevo', NULL,
        'costo_anterior', v_existente->>'costo',
        'costo_nuevo', NULL,
        'editado_por', p_editado_por
      );
    END IF;
  END LOOP;

  INSERT INTO public.producto_variantes_auditoria (
    negocio_id, producto_id, variante_id_anterior, variante_id_nueva, atributos,
    nombre_display, accion, stock_anterior, stock_nuevo,
    precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, editado_por
  )
  SELECT
    p_negocio_id, (a->>'producto_id')::uuid, (a->>'variante_id_anterior')::uuid,
    (a->>'variante_id_nueva')::uuid, a->'atributos', a->>'nombre_display',
    a->>'accion', (a->>'stock_anterior')::numeric, (a->>'stock_nuevo')::numeric,
    (a->>'precio_anterior')::numeric, (a->>'precio_nuevo')::numeric,
    (a->>'costo_anterior')::numeric, (a->>'costo_nuevo')::numeric,
    (a->>'editado_por')::uuid
  FROM unnest(v_auditoria) AS a;

  RETURN jsonb_build_object('success', true, 'blocked', false);
END;
$function$;

commit;
