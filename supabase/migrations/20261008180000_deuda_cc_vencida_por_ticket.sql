-- ─────────────────────────────────────────────────────────────────────────────
-- `deuda_cc_vencida` imputa como `cc_deudas_vivas`: la mora DENTRO de su venta.
--
-- Por qué (8/10/2026, auditoría de mora): esta función armaba su propio FIFO con
-- cada mora como una deuda aparte, ordenada por el día en que se cobró. Como la
-- mora se cobra después de las compras que la causan, quedaba al FINAL de la
-- fila: los pagos cancelaban primero compras más nuevas y la mora aparecía
-- "impaga". Resultado: `mora_viva` inflada y `capital_vencido` de menos, contra
-- lo que dicen `cc_deudas_vivas` (vencimiento, resumen, recibo).
--   - Vero duarte (Estilo Bonito): base $10.000 cuando lo vencido vivo de su
--     compra del 22/8 son $14.500 (y $4.500 de "mora viva" ya pagada).
--   - CELESTE SCHOFER (Evens): $2.104,91 de "mora viva" ya pagada.
-- Desde acá hay UNA imputación: la de `cc_deudas_vivas`. Dentro de cada venta
-- los pagos cubren primero su mora: capital vivo = least(capital, vivo).
--
-- Además devuelve `ventas_vencidas_nuevas`: ventas vencidas con capital vivo
-- que todavía no recargaron. El monto fijo se cobra UNO POR CADA UNA (decisión
-- del 8/10/2026); hasta acá era uno por cobro.
--
-- Lo demás no cambia: mismas columnas, mismo criterio de `recargado_*` (una
-- venta recarga una vez: la que ya estaba vencida cuando se cobró una mora) y
-- el ancla de la mora sigue siendo la venta más vieja con capital vivo.
-- Cambia el tipo de retorno (columna nueva): DROP + CREATE, mismos GRANT.
-- Reversión: supabase/reversals/20261008180000_deuda_cc_vencida_por_ticket.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Foto de la versión vieja, para los guards.
create temp table _antes on commit drop as
select d.cliente_id, d.saldo_vivo, d.capital_vencido, d.recargado_vencido
  from public.deuda_cc_vencida() d;

do $$
begin
  -- El modo masivo nuevo recorre solo clientes con saldo > 0. Hoy ningún
  -- cliente con deuda viva tiene saldo <= 0; si apareciera uno, se perdería.
  if exists (select 1 from _antes a join public.clientes c on c.id = a.cliente_id
              where c.saldo_pendiente <= 0) then
    raise exception 'Hay clientes con deuda viva y saldo <= 0: revisar antes de filtrar por saldo';
  end if;
end;
$$;

drop function public.deuda_cc_vencida(uuid);

create function public.deuda_cc_vencida(p_cliente_id uuid default null::uuid)
returns table(
  cliente_id uuid,
  saldo_vivo numeric,
  vencido numeric,
  fecha_mas_antigua date,
  mora_viva numeric,
  capital_vivo numeric,
  debito_capital_mas_antiguo_id uuid,
  capital_vencido numeric,
  recargado_saldo numeric,
  recargado_vencido numeric,
  ventas_vencidas_nuevas integer
)
language sql
stable
set search_path to 'public', 'security', 'pg_temp'
as $function$
  with hoy as (
    select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d
  ),
  -- La deuda viva por venta, con su mora adentro: la MISMA imputación que
  -- vencimiento, resumen y recibo. Masivo: solo quien debe (saldo > 0).
  tickets as (
    select c.id as cliente_id, d.*,
           case when d.es_mora_huerfana then 0
                else least(d.monto - d.monto_mora, d.vivo) end as cap_vivo,
           case when d.es_mora_huerfana then d.vivo
                else greatest(0, d.vivo - (d.monto - d.monto_mora)) end as mora_vivo,
           d.vence_el < (select h.d from hoy h) as esta_vencido
      from public.clientes c
     cross join lateral public.cc_deudas_vivas(c.id) d
     where (p_cliente_id is null and c.saldo_pendiente > 0)
        or c.id = p_cliente_id
  ),
  -- Las moras cobradas. Una venta que existía cuando se cobró una ya tuvo su
  -- recargo con SALDO_COMPLETO; una que ya estaba vencida, con PORCION_VENCIDA.
  moras as (
    select m.cliente_id,
           m.creado_en,
           (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date as dia
      from public.cuenta_corriente_movimientos m
     where m.tipo = 'DEBITO'
       and m.pago_id is not null
       and m.anulado = false
       and m.cliente_id in (select t.cliente_id from tickets t)
  ),
  marcados as (
    select t.*,
           exists (
             select 1 from moras mo
              where mo.cliente_id = t.cliente_id
                and mo.creado_en > t.creado_en
           ) as rec_saldo,
           exists (
             select 1 from moras mo
              where mo.cliente_id = t.cliente_id
                and mo.creado_en > t.creado_en
                and t.vence_el < mo.dia
           ) as rec_vencido
      from tickets t
  )
  select
    m.cliente_id,
    round(sum(m.vivo), 2) as saldo_vivo,
    round(sum(m.vivo) filter (where m.vivo > 0 and m.esta_vencido), 2) as vencido,
    min(m.fecha) filter (where m.vivo > 0) as fecha_mas_antigua,
    round(coalesce(sum(m.mora_vivo), 0), 2) as mora_viva,
    round(coalesce(sum(m.cap_vivo), 0), 2) as capital_vivo,
    (array_agg(m.debito_id order by m.fecha, m.creado_en, m.debito_id)
       filter (where not m.es_mora_huerfana and m.cap_vivo > 0))[1]
      as debito_capital_mas_antiguo_id,
    round(coalesce(sum(m.cap_vivo) filter (
      where m.cap_vivo > 0 and m.esta_vencido
    ), 0), 2) as capital_vencido,
    round(coalesce(sum(m.cap_vivo) filter (
      where m.cap_vivo > 0 and m.rec_saldo
    ), 0), 2) as recargado_saldo,
    round(coalesce(sum(m.cap_vivo) filter (
      where m.cap_vivo > 0 and m.esta_vencido and m.rec_vencido
    ), 0), 2) as recargado_vencido,
    (count(*) filter (
      where m.cap_vivo > 0 and m.esta_vencido and not m.rec_vencido
    ))::integer as ventas_vencidas_nuevas
  from marcados m
  group by m.cliente_id
  having sum(m.vivo) > 0;
$function$;

grant execute on function public.deuda_cc_vencida(uuid) to anon, authenticated, service_role;

comment on function public.deuda_cc_vencida(uuid) is
  'Deuda viva por cliente con la imputación de cc_deudas_vivas (mora dentro de su venta, pagada primero). Bases de la mora: capital_vencido, recargado_* (una venta recarga una vez) y ventas_vencidas_nuevas (monto fijo: uno por cada una). Ver 20261008180000.';

-- Guards: el saldo vivo no cambia para nadie; la base de PORCION_VENCIDA solo
-- puede cambiar donde la mora estaba mal imputada; las partes suman el todo.
do $$
declare
  v_n int;
  v_cambios text;
begin
  select count(*) into v_n
    from _antes a
    full join public.deuda_cc_vencida() d on d.cliente_id = a.cliente_id
   where a.saldo_vivo is distinct from d.saldo_vivo;
  if v_n <> 0 then
    raise exception '% clientes cambiaron su saldo vivo', v_n;
  end if;

  select count(*) into v_n
    from public.deuda_cc_vencida() d
   where d.capital_vivo + d.mora_viva <> d.saldo_vivo
      or d.capital_vencido > d.capital_vivo
      or d.recargado_vencido > d.capital_vencido
      or d.ventas_vencidas_nuevas < 0;
  if v_n <> 0 then
    raise exception '% clientes con partes que no cierran', v_n;
  end if;

  -- Medido en seco el 8/10/2026: solo Vero duarte (10.000 → 14.500).
  select count(*), string_agg(c.nombre, ', ') into v_n, v_cambios
    from _antes a
    join public.deuda_cc_vencida() d on d.cliente_id = a.cliente_id
    join public.clientes c on c.id = a.cliente_id
   where greatest(0, a.capital_vencido - a.recargado_vencido)
         is distinct from greatest(0, d.capital_vencido - d.recargado_vencido);
  if v_n > 3 then
    raise exception 'Cambió la base de mora de % clientes (esperado 1): %', v_n, v_cambios;
  end if;

  select count(*) into v_n
    from pg_proc where proname = 'deuda_cc_vencida' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'Se esperaba una sola deuda_cc_vencida, hay %', v_n;
  end if;
end;
$$;
