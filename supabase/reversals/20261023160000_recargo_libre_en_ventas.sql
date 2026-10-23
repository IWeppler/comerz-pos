-- Reversión de 20261023160000_recargo_libre_en_ventas.sql (a mano).
-- ATENCIÓN: borra las columnas. Una venta con recargo libre conserva su `total`
-- (que ya lo incluye) pero pierde el dato de qué parte fue recargo y qué
-- porcentaje. Antes de correrla: `select id, total, recargo_libre_monto from
-- ventas where recargo_libre_monto > 0`.

-- 1. registrar_venta: saca el permiso y las dos columnas del INSERT.
do $$
declare
  v_def text := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_nueva text := v_def;
  v_b1 text := E'    recargo_cc_porcentaje, recargo_cc_monto,\n    recargo_libre_porcentaje, recargo_libre_monto,\n    fecha_venta, registrada_offline, desfasaje_precio,\n';
  v_a1 text := E'    recargo_cc_porcentaje, recargo_cc_monto,\n    fecha_venta, registrada_offline, desfasaje_precio,\n';
  v_b2 text := E'    (p_venta->>''recargo_cc_monto'')::numeric,\n    (p_venta->>''recargo_libre_porcentaje'')::numeric,\n    (p_venta->>''recargo_libre_monto'')::numeric,\n    coalesce((p_venta->>''fecha_venta'')::timestamptz, now()),\n';
  v_a2 text := E'    (p_venta->>''recargo_cc_monto'')::numeric,\n    coalesce((p_venta->>''fecha_venta'')::timestamptz, now()),\n';
  v_b3 text := E'\n  -- Recargo libre del ticket (20261023160000): pide permiso. Lo exige tambien\n'
    || E'  -- create-sale.ts; esto es la base, que es la que cuenta.\n'
    || E'  if coalesce((p_venta->>''recargo_libre_monto'')::numeric, 0) > 0\n'
    || E'     and not coalesce(public.tiene_permiso(''ventas.recargo_libre''), false) then\n'
    || E'    raise exception ''SIN_PERMISO_RECARGO_LIBRE'';\n'
    || E'  end if;\n';
begin
  foreach v_a1 in array array[v_b1, v_b2, v_b3] loop
    if (length(v_nueva) - length(replace(v_nueva, v_a1, ''))) / length(v_a1) <> 1 then
      raise exception 'REVERSION: un bloque no matchea exactamente una vez';
    end if;
  end loop;
  v_nueva := replace(v_nueva, v_b1, E'    recargo_cc_porcentaje, recargo_cc_monto,\n    fecha_venta, registrada_offline, desfasaje_precio,\n');
  v_nueva := replace(v_nueva, v_b2, E'    (p_venta->>''recargo_cc_monto'')::numeric,\n    coalesce((p_venta->>''fecha_venta'')::timestamptz, now()),\n');
  v_nueva := replace(v_nueva, v_b3, '');
  execute v_nueva;
end $$;

-- 2. Permiso.
delete from public.rol_permisos
 where permiso_id = (select id from public.permisos where clave = 'ventas.recargo_libre');
delete from public.permisos where clave = 'ventas.recargo_libre';

-- 3. Columnas.
alter table public.ventas
  drop constraint if exists ventas_un_solo_recargo,
  drop constraint if exists ventas_recargo_libre_coherente;
alter table public.ventas
  drop column if exists recargo_libre_monto,
  drop column if exists recargo_libre_porcentaje;
