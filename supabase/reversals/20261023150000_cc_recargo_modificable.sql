-- Reversión de 20261023150000_cc_recargo_modificable.sql (a mano).
-- Vuelve el guard de registrar_venta a "solo pide permiso para el 0".
do $$
declare
  v_def text := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_nuevo text := E'      if nullif(p_cc->>''cuotas'', '''') is null\n'
    || E'         and (\n'
    || E'           abs(round(coalesce((p_venta->>''recargo_cc_porcentaje'')::numeric, 0), 2)\n'
    || E'               - round(coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                                  where c.negocio_id = v_negocio), 0), 2)) > 0.005\n'
    || E'           or (coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                          where c.negocio_id = v_negocio), 0) > 0\n'
    || E'               and coalesce((p_venta->>''recargo_cc_monto'')::numeric, 0) <= 0)\n'
    || E'         )\n';
  v_viejo text := E'      if coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                    where c.negocio_id = v_negocio), 0) > 0\n'
    || E'         and (coalesce((p_venta->>''recargo_cc_porcentaje'')::numeric, 0) <= 0\n'
    || E'              or coalesce((p_venta->>''recargo_cc_monto'')::numeric, 0) <= 0)\n'
    || E'         and nullif(p_cc->>''cuotas'', '''') is null\n';
begin
  if (length(v_def) - length(replace(v_def, v_nuevo, ''))) / length(v_nuevo) <> 1 then
    raise exception 'REVERSION: el guard nuevo no matchea exactamente una vez';
  end if;
  execute replace(v_def, v_nuevo, v_viejo);
end $$;
