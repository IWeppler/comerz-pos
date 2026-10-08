-- Reversión de 20261008200000_alias_transferencia_resumen_cc.sql
-- Primero la función (deja de leer la columna), después la columna.

do $$
declare
  v_nueva text;
  v_reemplazos text[][] := array[
    array['select cp."posName" as pos_name, cp."posLogo" as pos_logo, cp.catalogo_activo,' || E'\n         cp.alias_transferencia,',
          'select cp."posName" as pos_name, cp."posLogo" as pos_logo, cp.catalogo_activo,'],
    array[E'      ''alias'', nullif(btrim(coalesce(v_config.alias_transferencia, '''')), ''''),\n', '']
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

alter table public.configuracion_pos drop column alias_transferencia;
