-- Reversión de 20261008190000_resumen_cc_logo_y_catalogo.sql
-- Los mismos tres reemplazos al revés, sobre el cuerpo vivo.

do $$
declare
  v_nueva text;
  v_reemplazos text[][] := array[
    array['select n.nombre, n.slug into v_negocio', 'select n.nombre into v_negocio'],
    array['select cp."posName" as pos_name, cp."posLogo" as pos_logo, cp.catalogo_activo,' || E'\n         cp.direccion, cp.whatsapp,',
          'select cp."posName" as pos_name, cp.direccion, cp.whatsapp,'],
    array[E'''whatsapp'', v_config.whatsapp,\n'
        || E'      ''logo'', nullif(btrim(coalesce(v_config.pos_logo, '''')), ''''),\n'
        || E'      ''catalogo_slug'', case when v_config.catalogo_activo is distinct from false\n'
        || E'                              then v_negocio.slug end\n'
        || E'    ),',
          E'''whatsapp'', v_config.whatsapp\n    ),']
  ];
  i int;
  v_veces int;
begin
  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure) into v_nueva;
  for i in 1 .. array_length(v_reemplazos, 1) loop
    v_veces := (length(v_nueva) - length(replace(v_nueva, v_reemplazos[i][1], ''))) / length(v_reemplazos[i][1]);
    if v_veces <> 1 then raise exception 'El reemplazo % matchea % veces', i, v_veces; end if;
    v_nueva := replace(v_nueva, v_reemplazos[i][1], v_reemplazos[i][2]);
  end loop;
  execute v_nueva;
end;
$$;
