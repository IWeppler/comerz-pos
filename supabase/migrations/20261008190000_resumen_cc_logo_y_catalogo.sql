-- ─────────────────────────────────────────────────────────────────────────────
-- Resumen público de cuenta corriente (/r/<token>): logo y catálogo del comercio.
--
-- Pedido de Ignacio (8/10/2026): arriba el logo y el nombre del comercio; al
-- final un botón al catálogo si el comercio lo tiene habilitado.
-- `resumen_cuenta_por_token` suma a `comercio`:
--   logo           configuracion_pos."posLogo" (el mismo que muestra la tienda)
--   catalogo_slug  negocios.slug, SOLO si el catálogo no está cerrado
--                  (`catalogo_activo` false = "Comercio cerrado", mismo
--                  criterio que la tienda). La URL la arma la página con
--                  `urlDeCatalogo`: el dominio vive en el entorno, no en la base.
-- Las dos cosas ya son públicas (las lee el catálogo con anon).
--
-- Se reescribe desde el cuerpo VIVO con replace(), con guard de que cada
-- reemplazo matchea exactamente una vez y de que la función sigue siendo
-- SECURITY DEFINER con su search_path.
-- Reversión: supabase/reversals/20261008190000_resumen_cc_logo_y_catalogo.sql
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_def text;
  v_nueva text;
  v_reemplazos text[][] := array[
    array[
      'select n.nombre into v_negocio',
      'select n.nombre, n.slug into v_negocio'
    ],
    array[
      'select cp."posName" as pos_name, cp.direccion, cp.whatsapp,',
      'select cp."posName" as pos_name, cp."posLogo" as pos_logo, cp.catalogo_activo,'
        || E'\n         cp.direccion, cp.whatsapp,'
    ],
    array[
      E'''whatsapp'', v_config.whatsapp\n    ),',
      E'''whatsapp'', v_config.whatsapp,\n'
        || E'      ''logo'', nullif(btrim(coalesce(v_config.pos_logo, '''')), ''''),\n'
        || E'      ''catalogo_slug'', case when v_config.catalogo_activo is distinct from false\n'
        || E'                              then v_negocio.slug end\n'
        || E'    ),'
    ]
  ];
  i int;
  v_veces int;
begin
  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure)
    into v_def;
  v_nueva := v_def;

  for i in 1 .. array_length(v_reemplazos, 1) loop
    v_veces := (length(v_nueva) - length(replace(v_nueva, v_reemplazos[i][1], '')))
               / length(v_reemplazos[i][1]);
    if v_veces <> 1 then
      raise exception 'El reemplazo % matchea % veces (se esperaba 1): %',
        i, v_veces, v_reemplazos[i][1];
    end if;
    v_nueva := replace(v_nueva, v_reemplazos[i][1], v_reemplazos[i][2]);
  end loop;

  if v_nueva not like '%SECURITY DEFINER%'
     or v_nueva not like '%SET search_path TO ''public'', ''pg_temp''%'
     or v_nueva not like '%where c.resumen_token = p_token%' then
    raise exception 'La función perdió SECURITY DEFINER, su search_path o el filtro por token';
  end if;

  execute v_nueva;
end;
$$;

-- El resultado trae logo y catálogo, y una sola versión de la función.
do $$
declare
  v_n int;
  v_out jsonb;
begin
  select count(*) into v_n from pg_proc
   where proname = 'resumen_cuenta_por_token' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'Se esperaba una sola resumen_cuenta_por_token, hay %', v_n;
  end if;

  select public.resumen_cuenta_por_token(c.resumen_token) into v_out
    from public.clientes c
   where c.resumen_token is not null
   limit 1;
  if v_out is not null and not (v_out->'comercio' ? 'logo' and v_out->'comercio' ? 'catalogo_slug') then
    raise exception 'El resumen no trae logo/catalogo_slug: %', v_out->'comercio';
  end if;
end;
$$;
