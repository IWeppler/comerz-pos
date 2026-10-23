-- Recargo LIBRE por ticket en una venta común (docs/ventas.md, 23/10/2026).
--
-- La vendedora puede ponerle un porcentaje de recargo a una venta de CONTADO
-- (0 / 5 / 10 / 15 o a mano). Decidido con Ignacio:
--   * Permiso nuevo `ventas.recargo_libre`, asignado a los roles que ya tenían
--     `ventas.fiar_sin_recargo` (hoy los 18 ADMIN): nadie pierde nada.
--   * Un ticket tiene UN solo recargo: el de cuenta corriente (fiado) o el
--     libre (contado), nunca los dos. Lo exige un CHECK, no solo el POS.
--   * En una devolución PARCIAL el recargo libre se queda, como el recargo por
--     método: `registrar_devolucion` devuelve solo Σ precio_final × cantidad
--     de los renglones, así que NO hace falta tocarla.
--
-- Columnas propias y no `recargo_cc_*`: ese par significa "interés de fiar" y
-- alimenta el movimiento de deuda del cliente y la prorrata de la devolución.
-- `ventas.total` ya incluye el recargo libre (como el de cuenta corriente).
--
-- `registrar_venta` se reescribe desde el cuerpo VIVO con replace(): suma las
-- dos columnas al INSERT (lista FIJA: un campo que no se suma ahí se descarta
-- sin error) y exige el permiso. Sigue INVOKER y conserva sus permisos.
-- Reversión: supabase/reversals/20261023160000_recargo_libre_en_ventas.sql

-- ─── 1. Columnas ─────────────────────────────────────────────────────────
alter table public.ventas
  add column if not exists recargo_libre_porcentaje numeric(5, 2),
  add column if not exists recargo_libre_monto numeric(12, 2);

-- Los coalesce no son decorativos: un CHECK que da NULL DEJA PASAR la fila.
alter table public.ventas
  add constraint ventas_recargo_libre_coherente check (
    (recargo_libre_porcentaje is null and recargo_libre_monto is null)
    or (coalesce(recargo_libre_porcentaje, -1) between 0 and 100
        and coalesce(recargo_libre_monto, -1) >= 0)
  ),
  add constraint ventas_un_solo_recargo check (
    coalesce(recargo_libre_monto, 0) = 0 or coalesce(recargo_cc_monto, 0) = 0
  );

comment on column public.ventas.recargo_libre_porcentaje is
  'Porcentaje de recargo libre que la vendedora le puso a esta venta de contado. null = no se sabe (ventas anteriores), 0 = sin recargo. Excluyente con recargo_cc_*.';
comment on column public.ventas.recargo_libre_monto is
  'Monto del recargo libre, ya incluido en ventas.total. No es interés de fiar: no entra al movimiento de deuda del cliente. Una devolución parcial NO lo devuelve.';

-- ─── 2. Permiso ──────────────────────────────────────────────────────────
insert into public.permisos (clave, modulo, descripcion)
select 'ventas.recargo_libre', 'ventas',
       'Aplicar un recargo libre (porcentaje) a una venta de contado'
 where not exists (select 1 from public.permisos where clave = 'ventas.recargo_libre');

-- A los roles que ya podían apartarse del recargo de fiar. `negocio_id` va
-- explícito: la migración no corre con un negocio activo y el default es null.
insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select rp.rol_id,
       (select id from public.permisos where clave = 'ventas.recargo_libre'),
       rp.negocio_id
  from public.rol_permisos rp
  join public.permisos p on p.id = rp.permiso_id
 where p.clave = 'ventas.fiar_sin_recargo'
   and not exists (
     select 1 from public.rol_permisos x
      where x.rol_id = rp.rol_id
        and x.permiso_id = (select id from public.permisos where clave = 'ventas.recargo_libre'));

-- ─── 3. registrar_venta ──────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_acl_antes text := (select proacl::text from pg_proc
    where oid = 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_a1 text := E'    recargo_cc_porcentaje, recargo_cc_monto,\n    fecha_venta, registrada_offline, desfasaje_precio,\n';
  v_b1 text := E'    recargo_cc_porcentaje, recargo_cc_monto,\n    recargo_libre_porcentaje, recargo_libre_monto,\n    fecha_venta, registrada_offline, desfasaje_precio,\n';
  v_a2 text := E'    (p_venta->>''recargo_cc_monto'')::numeric,\n    coalesce((p_venta->>''fecha_venta'')::timestamptz, now()),\n';
  v_b2 text := E'    (p_venta->>''recargo_cc_monto'')::numeric,\n    (p_venta->>''recargo_libre_porcentaje'')::numeric,\n    (p_venta->>''recargo_libre_monto'')::numeric,\n    coalesce((p_venta->>''fecha_venta'')::timestamptz, now()),\n';
  v_a3 text := E'  if v_negocio is null then\n    raise exception ''SIN_NEGOCIO_ACTIVO'';\n  end if;\n';
  v_b3 text := E'  if v_negocio is null then\n    raise exception ''SIN_NEGOCIO_ACTIVO'';\n  end if;\n\n'
    || E'  -- Recargo libre del ticket (20261023160000): pide permiso. Lo exige tambien\n'
    || E'  -- create-sale.ts; esto es la base, que es la que cuenta.\n'
    || E'  if coalesce((p_venta->>''recargo_libre_monto'')::numeric, 0) > 0\n'
    || E'     and not coalesce(public.tiene_permiso(''ventas.recargo_libre''), false) then\n'
    || E'    raise exception ''SIN_PERMISO_RECARGO_LIBRE'';\n'
    || E'  end if;\n';
  v_nueva text;
  pares text[][] := array[[v_a1, v_b1], [v_a2, v_b2], [v_a3, v_b3]];
  i int;
begin
  v_nueva := v_def;
  for i in 1..3 loop
    if (length(v_nueva) - length(replace(v_nueva, pares[i][1], ''))) / length(pares[i][1]) <> 1 then
      raise exception 'RECARGO_LIBRE: el ancla % no matchea exactamente una vez', i;
    end if;
    v_nueva := replace(v_nueva, pares[i][1], pares[i][2]);
  end loop;

  if v_nueva not like '%tiene_permiso(''ventas.fiar_sin_recargo'')%'
     or v_nueva not like '%SIN_PERMISO_RECARGO_LIBRE%'
     or v_nueva not like '%cuenta_corriente_movimientos%'
     or v_nueva not like '%VENTA_SIN_RENGLONES%'
     or v_nueva like '%SECURITY DEFINER%' then
    raise exception 'RECARGO_LIBRE: se perdió algo crítico de registrar_venta';
  end if;

  execute v_nueva;

  if (select proacl::text from pg_proc
       where oid = 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure)
     is distinct from v_acl_antes then
    raise exception 'RECARGO_LIBRE_GUARD: cambiaron los permisos de registrar_venta';
  end if;
end $$;

-- ─── Guards finales ──────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_proc where proname = 'registrar_venta' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'RECARGO_LIBRE_GUARD: sobrecarga de registrar_venta';
  end if;
  if (select count(*) from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
       where p.clave = 'ventas.recargo_libre')
     <> (select count(*) from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
          where p.clave = 'ventas.fiar_sin_recargo') then
    raise exception 'RECARGO_LIBRE_GUARD: el permiso nuevo no quedó en los mismos roles que fiar_sin_recargo';
  end if;
  if (select count(*) from public.ventas where recargo_libre_monto is not null) <> 0 then
    raise exception 'RECARGO_LIBRE_GUARD: las ventas existentes tenían que quedar en null';
  end if;
end $$;
