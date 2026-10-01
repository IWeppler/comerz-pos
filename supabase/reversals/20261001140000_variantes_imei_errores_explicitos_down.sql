-- Reversión de 20261001140000_variantes_imei_errores_explicitos.sql
--
-- Vuelve a los tres silencios (CONTINUE WHEN, borrado que choca con el FK,
-- on conflict do nothing). Solo tiene sentido si los errores nuevos frenan
-- algo legítimo. Mismo método: replace sobre el cuerpo vivo, con guard.

do $$
declare
  v_def text;
  v_ini int;
  v_fin int;
begin
  -- guardar_variantes_producto_impl
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'guardar_variantes_producto_impl'
     and p.pronamespace = 'public'::regnamespace;

  v_def := replace(v_def, E'  v_clave text;\n  v_con_imei text;\nBEGIN', E'  v_clave text;\nBEGIN');

  v_ini := position(E'    IF v_clave = ANY (v_claves_entrantes) THEN\n' in v_def);
  v_fin := position(E'        USING errcode = ''P0001'';\n    END IF;\n' in v_def);
  if v_ini = 0 or v_fin = 0 then
    raise exception 'guardar: no se encontró el bloque VARIANTES_REPETIDAS';
  end if;
  v_def := substr(v_def, 1, v_ini - 1)
        || E'    CONTINUE WHEN v_clave = ANY (v_claves_entrantes);\n'
        || substr(v_def, v_fin + length(E'        USING errcode = ''P0001'';\n    END IF;\n'));

  v_ini := position(E'  SELECT string_agg(DISTINCT ve->>''nombre_display''' in v_def);
  v_fin := position(E'      USING errcode = ''P0001'';\n  END IF;\n\n' in v_def);
  if v_ini = 0 or v_fin = 0 then
    raise exception 'guardar: no se encontró el bloque VARIANTE_CON_IMEI';
  end if;
  v_def := substr(v_def, 1, v_ini - 1)
        || substr(v_def, v_fin + length(E'      USING errcode = ''P0001'';\n  END IF;\n\n'));

  execute v_def;

  -- aprobar_orden_compra_impl
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'aprobar_orden_compra_impl'
     and p.pronamespace = 'public'::regnamespace;

  v_ini := position(E'  -- GUARD DE IMEI REPETIDO' in v_def);
  v_fin := position(E'  for v_item in select * from jsonb_array_elements(p_items)\n' in v_def);
  if v_ini = 0 or v_fin = 0 or v_fin < v_ini then
    raise exception 'aprobar: no se encontró el bloque REMITO_IMEI_REPETIDO';
  end if;
  v_def := substr(v_def, 1, v_ini - 1) || substr(v_def, v_fin);

  v_def := replace(v_def,
    E'        ''disponible''\n      );\n',
    E'        ''disponible''\n      )\n      on conflict (negocio_id, imei) do nothing;\n');

  execute v_def;
end $$;
