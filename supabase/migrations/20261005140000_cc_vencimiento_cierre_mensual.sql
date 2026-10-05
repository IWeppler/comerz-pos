-- ─────────────────────────────────────────────────────────────────────────────
-- Vencimiento de cuenta corriente: "días desde la compra" o "cierre mensual".
--
-- Por qué (5/10/2026): Librería Colores vende fiado a escuelas y personas que
-- compran todo el mes y pagan a principio del siguiente. El 5 de cada mes la
-- dueña quiere saber quién le debe y pasar los saldos; la clienta tiene hasta
-- el 15 para pagar. Con "N días desde la compra" cada ticket vencía en una
-- fecha distinta y eso no se le puede explicar a nadie.
--
-- Por comercio (`configuracion_pos`):
--   cc_vencimiento_modo  DIAS (default, lo de siempre: fecha + cc_plazo_mora)
--                        | CIERRE_MENSUAL
--   cc_dia_cierre        1..28. Lo comprado ANTES de ese día del mes cierra
--                        ese día; lo comprado ese día o después, el mes que
--                        viene. (Colores: del 5/9 al 4/10 cierra el 5/10.)
--   cc_dia_vencimiento   1..28, opcional. El primer día con ese número a
--                        partir del cierre (mismo mes si es >= al cierre, el
--                        siguiente si es menor). NULL = vence el día del
--                        cierre. (Colores: 15, vence el 15/10.)
-- Hasta 28 para que exista en todos los meses.
--
-- La regla vive en UNA función, `cc_vence_el`, y la usan los tres que
-- calculaban el vencimiento a mano (`cc_deudas_vivas`, `deuda_cc_vencida`,
-- `registrar_venta`). Espejo TS: features/clients/lib/calcular-fecha-vencimiento.ts.
-- Para todos los comercios (en DIAS) el resultado es el mismo: guard.
-- Reversión: supabase/reversals/20261005140000_cc_vencimiento_cierre_mensual.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. La configuración.
alter table public.configuracion_pos
  add column cc_vencimiento_modo text not null default 'DIAS'
    constraint configuracion_pos_cc_vencimiento_modo_check
      check (cc_vencimiento_modo in ('DIAS', 'CIERRE_MENSUAL')),
  add column cc_dia_cierre smallint
    constraint configuracion_pos_cc_dia_cierre_check
      check (cc_dia_cierre between 1 and 28),
  add column cc_dia_vencimiento smallint
    constraint configuracion_pos_cc_dia_vencimiento_check
      check (cc_dia_vencimiento between 1 and 28),
  add constraint configuracion_pos_cc_cierre_requiere_dia_check
    check (cc_vencimiento_modo <> 'CIERRE_MENSUAL' or cc_dia_cierre is not null);

comment on column public.configuracion_pos.cc_vencimiento_modo is
  'DIAS: la deuda vence fecha de compra + cc_plazo_mora. CIERRE_MENSUAL: lo comprado antes del día cc_dia_cierre cierra ese día y vence el cc_dia_vencimiento siguiente (o el mismo día del cierre si es NULL). Regla: public.cc_vence_el.';

-- 2. La regla, en una función pura.
create or replace function public.cc_vence_el(
  p_fecha date,
  p_modo text,
  p_dias integer,
  p_dia_cierre integer,
  p_dia_vencimiento integer
)
returns date
language sql
immutable
set search_path to 'pg_temp'
as $function$
  select case
    when p_modo = 'CIERRE_MENSUAL' and p_dia_cierre is not null then (
      select case
        when p_dia_vencimiento is null then c.cierre
        when p_dia_vencimiento >= p_dia_cierre
          then date_trunc('month', c.cierre::timestamp)::date + (p_dia_vencimiento - 1)
        else (date_trunc('month', c.cierre::timestamp) + interval '1 month')::date
               + (p_dia_vencimiento - 1)
      end
      from (
        select case
          when extract(day from p_fecha) < p_dia_cierre
            then date_trunc('month', p_fecha::timestamp)::date + (p_dia_cierre - 1)
          else (date_trunc('month', p_fecha::timestamp) + interval '1 month')::date
                 + (p_dia_cierre - 1)
        end as cierre
      ) c
    )
    else p_fecha + coalesce(p_dias, 30)
  end;
$function$;

comment on function public.cc_vence_el(date, text, integer, integer, integer) is
  'Vencimiento de una deuda de cuenta corriente nacida en p_fecha, según la configuración del comercio. La ÚNICA regla: la usan cc_deudas_vivas, deuda_cc_vencida y registrar_venta. Espejo TS: calcular-fecha-vencimiento.ts.';

-- Lo mismo leyendo la configuración del comercio (para registrar_venta).
create or replace function public.cc_vence_el_negocio(p_negocio_id uuid, p_fecha date)
returns date
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select public.cc_vence_el(
    p_fecha,
    cp.cc_vencimiento_modo,
    coalesce(cp.cc_plazo_mora, 30),
    cp.cc_dia_cierre,
    cp.cc_dia_vencimiento
  )
  from (select 1) uno
  left join public.configuracion_pos cp on cp.negocio_id = p_negocio_id;
$function$;

-- Las llaman funciones INVOKER de quien vende o cobra. anon no las necesita:
-- el resumen público es DEFINER.
revoke execute on function public.cc_vence_el(date, text, integer, integer, integer) from public, anon;
revoke execute on function public.cc_vence_el_negocio(uuid, date) from public, anon;
grant execute on function public.cc_vence_el(date, text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.cc_vence_el_negocio(uuid, date) to authenticated, service_role;

-- Casos de la regla (los mismos que el test de TS).
do $$
declare
  v_mal text;
begin
  select string_agg(format('%s/%s/%s/%s/%s -> %s (esperaba %s)', f, modo, dias, dc, dv,
                           public.cc_vence_el(f, modo, dias, dc, dv), esperado), '; ')
    into v_mal
    from (values
      ('2026-09-05'::date, 'DIAS', 32, null::int, null::int, '2026-10-07'::date),
      ('2026-09-05', 'CIERRE_MENSUAL', 32, 5, 15, '2026-10-15'),
      ('2026-10-04', 'CIERRE_MENSUAL', 32, 5, 15, '2026-10-15'),
      ('2026-09-04', 'CIERRE_MENSUAL', 32, 5, 15, '2026-09-15'),
      ('2026-12-20', 'CIERRE_MENSUAL', 32, 5, 15, '2027-01-15'),
      ('2026-09-20', 'CIERRE_MENSUAL', 32, 5, null, '2026-10-05'),
      ('2026-09-20', 'CIERRE_MENSUAL', 32, 25, 10, '2026-10-10'),
      ('2026-09-27', 'CIERRE_MENSUAL', 32, 25, 10, '2026-11-10'),
      ('2026-09-20', 'CIERRE_MENSUAL', 32, 1, 10, '2026-10-10'),
      ('2026-09-01', 'CIERRE_MENSUAL', 32, 1, 10, '2026-10-10'),
      ('2026-09-20', null, null, null, null, '2026-10-20')
    ) t(f, modo, dias, dc, dv, esperado)
   where public.cc_vence_el(f, modo, dias, dc, dv) is distinct from esperado;
  if v_mal is not null then
    raise exception 'cc_vence_el: %', v_mal;
  end if;
end $$;

-- Foto de ANTES, para comprobar que para todos (en DIAS) nada cambia.
create temp table _venc_antes on commit drop as
  select c.id as cliente_id, public.recalcular_vencimiento_cc(c.id) as vence
    from public.clientes c;
create temp table _dcv_antes on commit drop as
  select * from public.deuda_cc_vencida(null);

-- 3. `cc_deudas_vivas`, desde el cuerpo VIVO.
do $$
declare
  v_def text;
  v_cli constant text := '    select c.negocio_id, coalesce(cp.cc_plazo_mora, 30) as dias
';
  v_cli_new constant text := '    select c.negocio_id, coalesce(cp.cc_plazo_mora, 30) as dias,
           cp.cc_vencimiento_modo as modo,
           cp.cc_dia_cierre as dia_cierre,
           cp.cc_dia_vencimiento as dia_vencimiento
';
  v_vence constant text := 'case when o.es_mora_huerfana then o.fecha else o.fecha + cl.dias end';
  v_vence_new constant text := 'case when o.es_mora_huerfana then o.fecha
              else public.cc_vence_el(o.fecha, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento) end';
begin
  select pg_get_functiondef('public.cc_deudas_vivas(uuid, uuid)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_cli, ''))) / length(v_cli) <> 1 then
    raise exception 'cc_deudas_vivas: el CTE cliente no aparece exactamente 1 vez';
  end if;
  if (length(v_def) - length(replace(v_def, v_vence, ''))) / length(v_vence) <> 1 then
    raise exception 'cc_deudas_vivas: vence_el no aparece exactamente 1 vez';
  end if;
  execute replace(replace(v_def, v_cli, v_cli_new), v_vence, v_vence_new);
end $$;

-- 4. `deuda_cc_vencida`, desde el cuerpo VIVO.
do $$
declare
  v_def text;
  v_pl constant text := '    select c.id as cliente_id, coalesce(cp.cc_plazo_mora, 30) as dias
';
  v_pl_new constant text := '    select c.id as cliente_id, coalesce(cp.cc_plazo_mora, 30) as dias,
           cp.cc_vencimiento_modo as modo,
           cp.cc_dia_cierre as dia_cierre,
           cp.cc_dia_vencimiento as dia_vencimiento
';
  v_viv constant text := '      pl.dias
    from debitos d';
  v_viv_new constant text := '      pl.dias,
      public.cc_vence_el(d.fecha, pl.modo, pl.dias, pl.dia_cierre, pl.dia_vencimiento) as vence_el
    from debitos d';
  v_cmp constant text := 'v.fecha + v.dias';
  v_n int;
begin
  select pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_pl, ''))) / length(v_pl) <> 1 then
    raise exception 'deuda_cc_vencida: el CTE plazos no aparece exactamente 1 vez';
  end if;
  if (length(v_def) - length(replace(v_def, v_viv, ''))) / length(v_viv) <> 1 then
    raise exception 'deuda_cc_vencida: pl.dias en vivos no aparece exactamente 1 vez';
  end if;
  v_n := (length(v_def) - length(replace(v_def, v_cmp, ''))) / length(v_cmp);
  if v_n <> 4 then
    raise exception 'deuda_cc_vencida: "v.fecha + v.dias" aparece % veces, se esperaban 4 (vencido, capital_vencido, recargado_vencido y las moras de vivos_r)', v_n;
  end if;
  execute replace(replace(replace(v_def, v_pl, v_pl_new), v_viv, v_viv_new), v_cmp, 'v.vence_el');

  select pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure) into v_def;
  if position('+ v.dias' in v_def) > 0 or position('cc_vence_el' in v_def) = 0 then
    raise exception 'deuda_cc_vencida: el parche no quedó como se esperaba';
  end if;
end $$;

-- 5. `registrar_venta`: el vencimiento que guarda en la venta, desde el cuerpo VIVO.
do $$
declare
  v_def text;
  v_old constant text := '      v_vencimiento := (v_fecha_venta at time zone ''UTC'')::date
                       + coalesce((p_cc->>''plazo_mora'')::int, 30);';
  v_new constant text := '      v_vencimiento := public.cc_vence_el_negocio(
                         v_negocio, (v_fecha_venta at time zone ''UTC'')::date);';
  v_secdef boolean;
  v_acl text;
begin
  if (select count(*) from pg_proc where proname = 'registrar_venta' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'registrar_venta: hay más de una versión';
  end if;
  -- Es SECURITY INVOKER (la RLS de quien vende la protege): lo que tenga, que
  -- siga igual, y los mismos permisos.
  select pg_get_functiondef(p.oid), p.prosecdef, p.proacl::text
    into v_def, v_secdef, v_acl
    from pg_proc p
   where p.proname = 'registrar_venta' and p.pronamespace = 'public'::regnamespace;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'registrar_venta: el cálculo del vencimiento no aparece exactamente 1 vez';
  end if;
  execute replace(v_def, v_old, v_new);

  if not exists (
    select 1 from pg_proc p
     where p.proname = 'registrar_venta' and p.pronamespace = 'public'::regnamespace
       and p.prosecdef = v_secdef
       and p.proacl::text is not distinct from v_acl
       and position('cc_vence_el_negocio' in pg_get_functiondef(p.oid)) > 0
  ) then
    raise exception 'registrar_venta: el parche no quedó como se esperaba (seguridad, permisos o cuerpo)';
  end if;
end $$;

-- Guard: con todos los comercios en DIAS, nada cambió.
do $$
declare
  v_venc int;
  v_dcv int;
begin
  select count(*) into v_venc
    from _venc_antes a
   where a.vence is distinct from public.recalcular_vencimiento_cc(a.cliente_id);
  select count(*) into v_dcv
    from _dcv_antes a
    full join public.deuda_cc_vencida(null) d on d.cliente_id = a.cliente_id
   where a.cliente_id is null or d.cliente_id is null
      or a.vencido is distinct from d.vencido
      or a.capital_vencido is distinct from d.capital_vencido
      or a.recargado_saldo is distinct from d.recargado_saldo
      or a.recargado_vencido is distinct from d.recargado_vencido
      or a.saldo_vivo is distinct from d.saldo_vivo;
  if v_venc > 0 or v_dcv > 0 then
    raise exception 'La regla nueva cambia % vencimientos y % filas de deuda_cc_vencida con todos en DIAS', v_venc, v_dcv;
  end if;
end $$;

-- 6. Cambiar cualquiera de las cuatro columnas re-cachea los vencimientos.
drop trigger trg_recachear_vencimientos_por_plazo on public.configuracion_pos;
create trigger trg_recachear_vencimientos_por_plazo
  after update of cc_plazo_mora, cc_vencimiento_modo, cc_dia_cierre, cc_dia_vencimiento
  on public.configuracion_pos
  for each row
  when (old.cc_plazo_mora is distinct from new.cc_plazo_mora
        or old.cc_vencimiento_modo is distinct from new.cc_vencimiento_modo
        or old.cc_dia_cierre is distinct from new.cc_dia_cierre
        or old.cc_dia_vencimiento is distinct from new.cc_dia_vencimiento)
  execute function public.recachear_vencimientos_por_plazo();

-- 7. Librería Colores: cierre el 5, vence el 15 (pedido del 5/10/2026).
do $$
declare
  v_filas int;
  v_desfasados int;
begin
  update public.configuracion_pos
     set cc_vencimiento_modo = 'CIERRE_MENSUAL',
         cc_dia_cierre = 5,
         cc_dia_vencimiento = 15
   where negocio_id = '27b693c8-44f5-49c2-b3df-66d00be6719a';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Colores: se esperaba 1 fila de configuración, hubo %', v_filas;
  end if;

  select count(*) into v_desfasados
    from public.clientes c
   where c.negocio_id = '27b693c8-44f5-49c2-b3df-66d00be6719a'
     and c.fecha_vencimiento_deuda
         is distinct from public.recalcular_vencimiento_cc(c.id);
  if v_desfasados > 0 then
    raise exception 'Colores: % clientes con el vencimiento desfasado después del re-cacheo', v_desfasados;
  end if;

  if exists (select 1 from public.configuracion_pos
              where cc_vencimiento_modo <> 'DIAS'
                and negocio_id <> '27b693c8-44f5-49c2-b3df-66d00be6719a') then
    raise exception 'cc_vencimiento_modo: otro comercio quedó en cierre mensual';
  end if;
end $$;
