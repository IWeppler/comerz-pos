-- Aviso en la campana al llegar al tope de ventas del mes (docs/suscripciones.md,
-- "Topes de uso") y el uso del mes por comercio para /admincomerz.
--
-- Depende de 20261023120000 (planes.reglas.max_ventas_mensuales).
--
--   1. `_estado_tope_ventas(negocio)`: un ESTADO derivado (no se guarda, se va solo
--      al mes siguiente) con la forma de `_estados_notificaciones`. Aparece cuando
--      las ventas no anuladas del mes comercial argentino llegan al tope del plan
--      (`reglas_negocio`, o sea con el override del comercio). Clave
--      `tope_ventas:YYYY-MM`: "leído" vale para ese mes y el siguiente vuelve a
--      avisar. Fecha = la de la venta que alcanzó el tope (estable). Tipo
--      `PLAN_TOPE_VENTAS` → categoría PLAN (llega a la dueña por default).
--      Cuesta una cuenta con LIMIT = tope (máx. 500 / 5.000 filas por el índice
--      (negocio_id, fecha_venta)), y solo para quien lo corre un ADMIN/ENCARGADO y
--      tiene tope. Sin tope declarado no hace nada.
--      Mismas exclusiones que los avisos de plan: solo prueba/activo, y un precio
--      acordado de $0 (cortesía) no recibe avisos de plan.
--   2. `_estados_notificaciones` suma ese estado (desde el cuerpo VIVO, replace()).
--   3. `ventas_del_mes_por_comercio()`: ventas del mes y tope de cada comercio, solo
--      super admin, para la tabla de /admincomerz. Va aparte de `comercios_con_uso`
--      (cambiarle el tipo de retorno obliga a dropearla y recrearla).
-- Es un aviso: NO frena ninguna venta.
-- Reversión: supabase/reversals/20261023130000_aviso_tope_ventas.sql

-- ─── Guard previo ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc where oid = 'public._estados_notificaciones(uuid)'::regprocedure)
     or not exists (select 1 from pg_proc where oid = 'public.reglas_negocio(uuid)'::regprocedure) then
    raise exception 'TOPE_VENTAS: faltan _estados_notificaciones o reglas_negocio';
  end if;
  if not exists (select 1 from public.planes
                  where id = 'bcbc54c4-65b7-4e0d-9a9d-ca586981a375'
                    and (reglas ->> 'max_ventas_mensuales')::int = 5000) then
    raise exception 'TOPE_VENTAS: aplicar antes 20261023120000';
  end if;
end $$;

-- ─── 1. El estado ─────────────────────────────────────────────────────────
create or replace function public._estado_tope_ventas(p_negocio uuid)
returns table (clave text, tipo text, titulo text, detalle text, href text, fecha timestamptz)
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_tope int;
  v_plan text;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_cuantas int;
  v_alcanzada timestamptz;
  v_tope_txt text;
begin
  select nullif(public.reglas_negocio(n.id) ->> 'max_ventas_mensuales', 'null')::int, pl.nombre
    into v_tope, v_plan
    from public.negocios n
    left join public.planes pl on pl.id = n.plan_id
   where n.id = p_negocio
     and n.estado in ('prueba', 'activo')
     and coalesce(n.precio_acordado, -1) <> 0;

  if v_tope is null or v_tope <= 0 then
    return;
  end if;

  v_inicio := date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
                at time zone 'America/Argentina/Buenos_Aires';
  v_fin := (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') + interval '1 month')
             at time zone 'America/Argentina/Buenos_Aires';

  -- Las primeras `tope` ventas del mes: si hay tantas, el tope se alcanzó, y la
  -- última es la que lo alcanzó.
  select count(*), max(s.fecha_venta)
    into v_cuantas, v_alcanzada
    from (
      select v.fecha_venta
        from public.ventas v
       where v.negocio_id = p_negocio
         and v.estado_operacion <> 'ANULADA'
         and v.fecha_venta >= v_inicio and v.fecha_venta < v_fin
       order by v.fecha_venta
       limit v_tope
    ) s;

  if v_cuantas < v_tope then
    return;
  end if;

  v_tope_txt := replace(to_char(v_tope, 'FM999,999,999'), ',', '.');
  return query select
    'tope_ventas:' || to_char(v_inicio at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM'),
    'PLAN_TOPE_VENTAS'::text,
    'Llegaste a las ' || v_tope_txt || ' ventas del mes',
    'Tu plan ' || coalesce(v_plan, 'actual') || ' incluye ' || v_tope_txt
      || ' ventas por mes. Seguís vendiendo sin cortes; si tu volumen se mantiene, escribinos y vemos el plan que te conviene.',
    '/perfil?tab=plan'::text,
    v_alcanzada;
end $$;
revoke all on function public._estado_tope_ventas(uuid) from public, anon, authenticated;

-- ─── 2. Se suma a los estados (cuerpo VIVO + replace + guard) ─────────────
do $$
declare
  v_def text := pg_get_functiondef('public._estados_notificaciones(uuid)'::regprocedure);
  v_viejo text := 'where x.clave is not null';
  v_nuevo text := E'where x.clave is not null\n\n  union all\n  select * from public._estado_tope_ventas(p_negocio)';
  v_nueva text;
begin
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'TOPE_VENTAS: el ancla de _estados_notificaciones no matchea exactamente una vez';
  end if;
  if position('_estado_tope_ventas' in v_def) > 0 then
    raise exception 'TOPE_VENTAS: ya estaba aplicado';
  end if;

  v_nueva := replace(v_def, v_viejo, v_nuevo);
  if v_nueva not like '%SECURITY DEFINER%'
     or v_nueva not like '%r.negocio_id = p_negocio%'
     or v_nueva not like '%o.negocio_id = p_negocio%'
     or v_nueva not like '%PRUEBA_VENCE%' then
    raise exception 'TOPE_VENTAS: se perdió algo crítico de _estados_notificaciones';
  end if;
  execute v_nueva;
end $$;

-- ─── 3. Para /admincomerz ─────────────────────────────────────────────────
create or replace function public.ventas_del_mes_por_comercio()
returns table (id uuid, ventas_mes bigint, max_ventas integer)
language sql stable security definer set search_path to 'public', 'security', 'pg_temp' as $$
  with mes as (
    select date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')
             at time zone 'America/Argentina/Buenos_Aires' as inicio,
           (date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') + interval '1 month')
             at time zone 'America/Argentina/Buenos_Aires' as fin
  )
  select n.id,
         (select count(*) from public.ventas v
           where v.negocio_id = n.id
             and v.estado_operacion <> 'ANULADA'
             and v.fecha_venta >= m.inicio and v.fecha_venta < m.fin),
         nullif(public.reglas_negocio(n.id) ->> 'max_ventas_mensuales', 'null')::int
    from public.negocios n
   cross join mes m
   where security.is_super_admin()
$$;
revoke all on function public.ventas_del_mes_por_comercio() from public, anon;
grant execute on function public.ventas_del_mes_por_comercio() to authenticated;

-- ─── Guard final ──────────────────────────────────────────────────────────
do $$
declare
  n uuid;
begin
  if has_function_privilege('authenticated', 'public._estado_tope_ventas(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._estados_notificaciones(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ventas_del_mes_por_comercio()', 'EXECUTE')
     or not (select prosecdef from pg_proc where oid = 'public._estado_tope_ventas(uuid)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.ventas_del_mes_por_comercio()'::regprocedure)
     or pg_get_functiondef('public._estados_notificaciones(uuid)'::regprocedure) not like '%_estado_tope_ventas%' then
    raise exception 'TOPE_VENTAS_GUARD: permisos o cuerpo';
  end if;

  -- Ningún comercio rompe la lista de estados (la función corre para todos).
  for n in select id from public.negocios loop
    perform count(*) from public._estados_notificaciones(n);
  end loop;
end $$;
