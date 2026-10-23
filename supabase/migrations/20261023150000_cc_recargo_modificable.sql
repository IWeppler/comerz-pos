-- Recargo de cuenta corriente MODIFICABLE por ticket (docs/cuenta-corriente.md,
-- 23/10/2026). Antes la vendedora solo podía "Anular" el recargo de fiar (0%) y
-- la base solo exigía permiso para ese 0. Ahora el ticket ofrece "Modificar"
-- (0 / 5 / 10 / 15 o un porcentaje a mano) y CUALQUIER apartarse del default del
-- comercio —bajar, subir o anular— pide `ventas.fiar_sin_recargo`.
--
-- Sin columna nueva: el porcentaje que rigió ya se congela en
-- `ventas.recargo_cc_porcentaje` y el monto en `recargo_cc_monto`, y de ahí leen
-- la anulación, la devolución (que prorratea el recargo), el movimiento de la
-- cuenta corriente, el ticket y la factura. Todo eso ya funciona con un
-- porcentaje cualquiera.
--
-- Solo cambia el guard de `registrar_venta`, desde el cuerpo VIVO con replace()
-- (AGENTS.md: create or replace no avisa de nada) y con guards de que el
-- reemplazo matchea exactamente una vez y lo crítico sigue ahí. Con cuotas el
-- guard no aplica, igual que antes: la tasa la fija el plan.
-- Reversión: supabase/reversals/20261023150000_cc_recargo_modificable.sql

do $$
declare
  v_def text := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_acl_antes text := (select proacl::text from pg_proc
    where oid = 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_viejo text := E'      if coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                    where c.negocio_id = v_negocio), 0) > 0\n'
    || E'         and (coalesce((p_venta->>''recargo_cc_porcentaje'')::numeric, 0) <= 0\n'
    || E'              or coalesce((p_venta->>''recargo_cc_monto'')::numeric, 0) <= 0)\n'
    || E'         and nullif(p_cc->>''cuotas'', '''') is null\n';
  v_nuevo text := E'      if nullif(p_cc->>''cuotas'', '''') is null\n'
    || E'         and (\n'
    || E'           abs(round(coalesce((p_venta->>''recargo_cc_porcentaje'')::numeric, 0), 2)\n'
    || E'               - round(coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                                  where c.negocio_id = v_negocio), 0), 2)) > 0.005\n'
    || E'           or (coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                          where c.negocio_id = v_negocio), 0) > 0\n'
    || E'               and coalesce((p_venta->>''recargo_cc_monto'')::numeric, 0) <= 0)\n'
    || E'         )\n';
  v_nueva text;
begin
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'RECARGO_CC_MODIFICABLE: el guard viejo no matchea exactamente una vez';
  end if;

  v_nueva := replace(v_def, v_viejo, v_nuevo);

  -- Lo crítico sigue ahí: el permiso, el negocio, el insert del movimiento de
  -- deuda y que NO es SECURITY DEFINER (el aislamiento es la RLS de quien vende).
  if v_nueva not like '%tiene_permiso(''ventas.fiar_sin_recargo'')%'
     or v_nueva not like '%SIN_PERMISO_FIAR_SIN_RECARGO%'
     or v_nueva not like '%cuenta_corriente_movimientos%'
     or v_nueva not like '%VENTA_SIN_RENGLONES%'
     or v_nueva like '%SECURITY DEFINER%' then
    raise exception 'RECARGO_CC_MODIFICABLE: se perdió algo crítico de registrar_venta';
  end if;

  execute v_nueva;

  -- Esta migración NO toca permisos: `create or replace` los conserva. Se
  -- verifica contra lo que había, y no contra lo que uno supone: la primera
  -- versión de este guard asumía que `anon` no podía ejecutar la función, y sí
  -- podía (de antes; es inocua porque exige negocio activo, pero no es algo
  -- que esta migración tenga que juzgar).
  if (select proacl::text from pg_proc
       where oid = 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure)
     is distinct from v_acl_antes then
    raise exception 'RECARGO_CC_MODIFICABLE_GUARD: cambiaron los permisos de registrar_venta';
  end if;
end $$;

do $$
declare
  v_def text := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
begin
  if v_def not like '%> 0.005%'
     or v_def like '%      if coalesce((select c.cc_recargo_default%' then
    raise exception 'RECARGO_CC_MODIFICABLE_GUARD';
  end if;
  -- Una sola función con ese nombre: un cambio de firma crearía una sobrecarga.
  if (select count(*) from pg_proc where proname = 'registrar_venta' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'RECARGO_CC_MODIFICABLE_GUARD: sobrecarga de registrar_venta';
  end if;
end $$;
