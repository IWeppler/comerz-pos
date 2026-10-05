-- ─────────────────────────────────────────────────────────────────────────────
-- Mora: base configurable por comercio, una sola vez por venta, plazo válido.
--
-- Por qué (5/10/2026): Librería Colores reclamó que el recargo se aplicaba a
-- TODA la cuenta y no a lo vencido. Caso NATI CORDOBA: $14.800 vencidos (saldo
-- inicial del 4/9) y $302.150 de una compra del 29/9; el 15% sobre el saldo
-- completo daba $47.542,50 contra $2.220 sobre lo vencido. ROMI MANSILLA pagó el
-- 5/10 $17.377,50 de mora cuando sobre lo vencido eran $9.270.
--
-- 1. `recargo_mora_base`, por comercio:
--      SALDO_COMPLETO  = todo el capital adeudado (cláusula de aceleración que
--                        pidió Evens el 5/9 y quedó global). Default: nadie
--                        cambia salvo Colores.
--      PORCION_VENCIDA = solo el capital de las ventas vencidas (FIFO).
-- 2. Cambiar el plazo re-cachea `clientes.fecha_vencimiento_deuda` del
--    comercio (antes quedaba con el plazo viejo hasta el próximo movimiento).
-- 3. Colores: plazo 32 días y base PORCION_VENCIDA (pedido de la dueña vía
--    Ignacio, 5/10/2026). Tenía plazo 0: una compra vencía el día que se hizo.
-- 4. `cc_plazo_mora >= 1`.
-- 5. La mora se cobra UNA vez por venta. Hasta acá cada cobro con la cuenta
--    vencida recargaba de nuevo el capital que ya había pagado mora (9
--    clientes con 2 o 3 recargos; Evens, MARA MANSILLA: 4/9, 14/9 y 26/9),
--    contra lo que promete Configuración ("se suma una única vez").
--    `deuda_cc_vencida` devuelve, además del capital vencido, cuánto del
--    capital vivo YA tuvo su recargo:
--      recargado_saldo   = ventas que existían cuando se cobró una mora
--                          (con SALDO_COMPLETO esa mora las cubrió a todas)
--      recargado_vencido = ventas que ya estaban VENCIDAS cuando se cobró
--                          una mora (con PORCION_VENCIDA solo cubrió esas)
--    La base del próximo recargo es el capital (o el vencido) menos eso.
--    Cambia el tipo de retorno: DROP + CREATE desde el cuerpo VIVO.
-- Reversión: supabase/reversals/20261005120000_cc_base_recargo_configurable.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. La base del recargo, por comercio.
alter table public.configuracion_pos
  add column recargo_mora_base text not null default 'SALDO_COMPLETO'
  constraint configuracion_pos_recargo_mora_base_check
    check (recargo_mora_base in ('SALDO_COMPLETO', 'PORCION_VENCIDA'));

comment on column public.configuracion_pos.recargo_mora_base is
  'Sobre qué se calcula el recargo por mora PORCENTAJE. SALDO_COMPLETO: todo el capital adeudado (cláusula de aceleración). PORCION_VENCIDA: solo el capital de las ventas vencidas, imputando pagos FIFO. En los dos casos, una venta que ya pagó su recargo no recarga de nuevo (deuda_cc_vencida.recargado_*).';

-- 2. Cambiar el plazo re-cachea los vencimientos del comercio.
create or replace function public.recachear_vencimientos_por_plazo()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
begin
  -- SECURITY DEFINER: el filtro por negocio va a mano. Solo el comercio cuya
  -- configuración cambió.
  update public.clientes c
     set fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(c.id)
   where c.negocio_id = new.negocio_id
     and c.fecha_vencimiento_deuda
         is distinct from public.recalcular_vencimiento_cc(c.id);
  return null;
end;
$function$;

revoke execute on function public.recachear_vencimientos_por_plazo() from public, anon, authenticated;

create trigger trg_recachear_vencimientos_por_plazo
  after update of cc_plazo_mora on public.configuracion_pos
  for each row
  when (old.cc_plazo_mora is distinct from new.cc_plazo_mora)
  execute function public.recachear_vencimientos_por_plazo();

-- 3. Librería Colores: 32 días, recargo sobre cada venta vencida.
do $$
declare
  v_filas int;
  v_desfasados int;
begin
  update public.configuracion_pos
     set cc_plazo_mora = 32,
         recargo_mora_base = 'PORCION_VENCIDA'
   where negocio_id = '27b693c8-44f5-49c2-b3df-66d00be6719a';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Colores: se esperaba 1 fila de configuración, hubo %', v_filas;
  end if;

  -- El trigger tuvo que dejar el cache igual a la regla en todo el comercio.
  select count(*) into v_desfasados
    from public.clientes c
   where c.negocio_id = '27b693c8-44f5-49c2-b3df-66d00be6719a'
     and c.fecha_vencimiento_deuda
         is distinct from public.recalcular_vencimiento_cc(c.id);
  if v_desfasados > 0 then
    raise exception 'Colores: % clientes con el vencimiento desfasado después del re-cacheo', v_desfasados;
  end if;

  if exists (select 1 from public.configuracion_pos
              where recargo_mora_base <> 'SALDO_COMPLETO'
                and negocio_id <> '27b693c8-44f5-49c2-b3df-66d00be6719a') then
    raise exception 'recargo_mora_base: otro comercio cambió de base, cambiaría su mora';
  end if;
end $$;

-- 4. El plazo de mora no puede ser 0 ni negativo. VALID: con Colores en 32 no
--    queda ningún comercio afuera.
alter table public.configuracion_pos
  add constraint configuracion_pos_cc_plazo_mora_check
  check (cc_plazo_mora is null or cc_plazo_mora >= 1);

-- 5. `deuda_cc_vencida` + capital vencido + lo ya recargado, desde el cuerpo VIVO.
create temp table _dcv_antes on commit drop as
  select * from public.deuda_cc_vencida(null);

do $$
declare
  v_def     text;
  v_comment text;
  v_ret     constant text := 'debito_capital_mas_antiguo_id uuid)';
  v_ret_new constant text := 'debito_capital_mas_antiguo_id uuid, capital_vencido numeric, recargado_saldo numeric, recargado_vencido numeric)';
  v_ancla   constant text := '  ancla as (';
  v_ancla_new constant text := '  -- Las moras cobradas (DEBITO atado a un cobro). Una venta que existía
  -- cuando se cobró una ya tuvo su recargo con SALDO_COMPLETO; una que ya
  -- estaba vencida, con PORCION_VENCIDA.
  moras as (
    select m.cliente_id,
           m.creado_en,
           (m.creado_en at time zone ''America/Argentina/Buenos_Aires'')::date as dia
    from public.cuenta_corriente_movimientos m
    join plazos p on p.cliente_id = m.cliente_id
    where m.tipo = ''DEBITO''
      and m.pago_id is not null
      and m.anulado = false
  ),
  vivos_r as (
    select v.*,
           exists (
             select 1 from moras mo
             where mo.cliente_id = v.cliente_id
               and mo.creado_en > v.creado_en
           ) as recargado_saldo,
           exists (
             select 1 from moras mo
             where mo.cliente_id = v.cliente_id
               and mo.creado_en > v.creado_en
               and v.fecha + v.dias < mo.dia
           ) as recargado_vencido
    from vivos v
  ),
  ancla as (';
  v_from    constant text := '  from vivos v
  left join ancla a on a.cliente_id = v.cliente_id';
  v_from_new constant text := '  from vivos_r v
  left join ancla a on a.cliente_id = v.cliente_id';
  v_sel     constant text := 'a.debito_id as debito_capital_mas_antiguo_id';
  v_sel_new constant text := 'a.debito_id as debito_capital_mas_antiguo_id,
    round(coalesce(sum(v.vivo) filter (
      where v.vivo > 0 and not v.es_mora
        and v.fecha + v.dias < (now() at time zone ''America/Argentina/Buenos_Aires'')::date
    ), 0), 2) as capital_vencido,
    round(coalesce(sum(v.vivo) filter (
      where v.vivo > 0 and not v.es_mora and v.recargado_saldo
    ), 0), 2) as recargado_saldo,
    round(coalesce(sum(v.vivo) filter (
      where v.vivo > 0 and not v.es_mora and v.recargado_vencido
        and v.fecha + v.dias < (now() at time zone ''America/Argentina/Buenos_Aires'')::date
    ), 0), 2) as recargado_vencido';
  v_overloads int;
begin
  select pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure) into v_def;
  select obj_description('public.deuda_cc_vencida(uuid)'::regprocedure, 'pg_proc') into v_comment;

  if (length(v_def) - length(replace(v_def, v_ret, ''))) / length(v_ret) <> 1 then
    raise exception 'deuda_cc_vencida: el RETURNS TABLE no aparece exactamente 1 vez, el cuerpo vivo cambió';
  end if;
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'deuda_cc_vencida: el CTE ancla no aparece exactamente 1 vez, el cuerpo vivo cambió';
  end if;
  if (length(v_def) - length(replace(v_def, v_from, ''))) / length(v_from) <> 1 then
    raise exception 'deuda_cc_vencida: el from final no aparece exactamente 1 vez, el cuerpo vivo cambió';
  end if;
  if (length(v_def) - length(replace(v_def, v_sel, ''))) / length(v_sel) <> 1 then
    raise exception 'deuda_cc_vencida: el select del ancla no aparece exactamente 1 vez, el cuerpo vivo cambió';
  end if;
  if position('v.fecha + v.dias < (now() at time zone ''America/Argentina/Buenos_Aires'')::date' in v_def) = 0 then
    raise exception 'deuda_cc_vencida: el criterio de vencido no es el esperado (día argentino)';
  end if;

  drop function public.deuda_cc_vencida(uuid);
  execute replace(replace(replace(replace(v_def,
    v_ret, v_ret_new), v_ancla, v_ancla_new), v_from, v_from_new), v_sel, v_sel_new);

  -- Los mismos GRANT que tenía (baseline): anon, authenticated, service_role.
  grant execute on function public.deuda_cc_vencida(uuid) to anon, authenticated, service_role;
  execute format('comment on function public.deuda_cc_vencida(uuid) is %L',
    v_comment || ' `capital_vencido`: capital (sin recargos previos) de las ventas vencidas. `recargado_saldo` / `recargado_vencido`: capital vivo que YA pagó su recargo, según la base SALDO_COMPLETO / PORCION_VENCIDA (configuracion_pos.recargo_mora_base); se resta de la base del próximo recargo para que la mora se cobre una vez por venta.');

  select count(*) into v_overloads from pg_proc
   where proname = 'deuda_cc_vencida' and pronamespace = 'public'::regnamespace;
  if v_overloads <> 1 then
    raise exception 'deuda_cc_vencida: quedaron % versiones', v_overloads;
  end if;
end $$;

-- Guards: lo que ya devolvía no cambia, y lo nuevo es coherente.
do $$
declare
  v_distintos int;
  v_incoherentes int;
begin
  select count(*) into v_distintos
    from _dcv_antes a
    full join public.deuda_cc_vencida(null) d on d.cliente_id = a.cliente_id
   where a.cliente_id is null or d.cliente_id is null
      or a.saldo_vivo is distinct from d.saldo_vivo
      or a.vencido is distinct from d.vencido
      or a.fecha_mas_antigua is distinct from d.fecha_mas_antigua
      or a.mora_viva is distinct from d.mora_viva
      or a.capital_vivo is distinct from d.capital_vivo
      or a.debito_capital_mas_antiguo_id is distinct from d.debito_capital_mas_antiguo_id;
  if v_distintos > 0 then
    raise exception 'deuda_cc_vencida: % filas cambiaron en columnas que ya existían', v_distintos;
  end if;

  select count(*) into v_incoherentes
    from public.deuda_cc_vencida(null) d
   where d.capital_vencido < 0
      or d.capital_vencido > d.capital_vivo + 0.005
      or d.capital_vencido > coalesce(d.vencido, 0) + 0.005
      or d.recargado_saldo < 0
      or d.recargado_saldo > d.capital_vivo + 0.005
      or d.recargado_vencido < 0
      or d.recargado_vencido > d.capital_vencido + 0.005
      or d.recargado_vencido > d.recargado_saldo + 0.005;
  if v_incoherentes > 0 then
    raise exception 'deuda_cc_vencida: % filas con capital_vencido / recargado_* fuera de rango', v_incoherentes;
  end if;
end $$;
