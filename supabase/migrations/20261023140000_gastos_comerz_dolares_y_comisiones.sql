-- Gastos de Comerz en dólares y comisiones atadas a un cobro.
-- (docs/finanzas-comerz.md, decidido con Ignacio el 23/10/2026)
--
--   1. Moneda: un gasto puede estar en USD. Se guarda el monto original
--      (`monto_usd`) y el MEP con que se cargó (`cotizacion_mep`); `monto`
--      sigue siendo el equivalente en PESOS, así todo lo que ya lee `monto`
--      (el margen, el gráfico) sigue funcionando sin tocarse. Antes no había
--      forma de saber que los $33.000 de Vercel eran 20 USD.
--   2. Comisiones: nueva categoría `comision` y dos columnas para atar el gasto
--      al comercio y al cobro que lo origina (el sueldo de Romina es el primer
--      pago de cada cliente que consigue). Sin FK dura: es historia y tiene que
--      sobrevivir a un comercio descartado o a un pago corregido.
--
-- Aditiva: filas existentes quedan como ARS sin cotización. Tabla chica, solo
-- super admin (RLS ya existente).
-- Reversión: supabase/reversals/20261023140000_gastos_comerz_dolares_y_comisiones.sql

do $$
declare
  v_filas int;
begin
  select count(*) into v_filas from public.gastos_comerz;
  -- Guard: es la tabla chica de siempre y la restricción vieja existe.
  if v_filas > 5000 then
    raise exception 'GASTOS_USD: % filas, no es la tabla chica que se esperaba', v_filas;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.gastos_comerz'::regclass
                    and conname = 'gastos_comerz_categoria_check') then
    raise exception 'GASTOS_USD: falta gastos_comerz_categoria_check';
  end if;
end $$;

alter table public.gastos_comerz
  add column if not exists moneda text not null default 'ARS',
  add column if not exists monto_usd numeric(12, 2),
  add column if not exists cotizacion_mep numeric(12, 2),
  add column if not exists negocio_origen_id uuid,
  add column if not exists pago_origen_id uuid;

-- USD lleva monto y cotización; ARS no lleva ninguno de los dos. Un USD a
-- medias es un gasto que no se puede convertir ni auditar. El coalesce no es
-- decorativo: un CHECK que da NULL DEJA PASAR la fila (monto_usd null > 0 es
-- null, no false). La prueba en seco lo encontró.
alter table public.gastos_comerz
  add constraint gastos_comerz_moneda_check check (moneda in ('ARS', 'USD')),
  add constraint gastos_comerz_usd_completo check (
    (moneda = 'ARS' and monto_usd is null and cotizacion_mep is null)
    or (moneda = 'USD' and coalesce(monto_usd, 0) > 0 and coalesce(cotizacion_mep, 0) > 0)
  ),
  add constraint gastos_comerz_origen_solo_comision check (
    (negocio_origen_id is null and pago_origen_id is null) or categoria = 'comision'
  );

-- La categoría `comision` se suma a las que ya había.
alter table public.gastos_comerz drop constraint gastos_comerz_categoria_check;
alter table public.gastos_comerz add constraint gastos_comerz_categoria_check
  check (categoria = any (array['infra', 'sueldo', 'marketing', 'impuestos', 'servicios', 'otro', 'comision']));

comment on column public.gastos_comerz.monto is
  'Siempre en PESOS. Para un gasto en USD es el equivalente al momento de cargarlo (monto_usd x cotizacion_mep).';
comment on column public.gastos_comerz.monto_usd is
  'Monto original en dólares, solo si moneda = USD.';
comment on column public.gastos_comerz.cotizacion_mep is
  'Pesos por dólar (MEP, precio de venta) con que se cargó. Solo si moneda = USD.';
comment on column public.gastos_comerz.negocio_origen_id is
  'Comercio cuyo cobro origina la comisión. Sin FK: es historia. Solo categoria = comision.';
comment on column public.gastos_comerz.pago_origen_id is
  'pagos_suscripcion que origina la comisión (el primer pago del comercio). Sin FK: es historia.';

do $$
begin
  if (select count(*) from public.gastos_comerz where moneda <> 'ARS') <> 0
     or not exists (select 1 from pg_constraint
                     where conrelid = 'public.gastos_comerz'::regclass
                       and conname = 'gastos_comerz_usd_completo')
     or pg_get_constraintdef((select oid from pg_constraint
                               where conrelid = 'public.gastos_comerz'::regclass
                                 and conname = 'gastos_comerz_categoria_check')) not like '%comision%'
     or not exists (select 1 from pg_policies
                     where tablename = 'gastos_comerz' and policyname = 'gastos_comerz_super_admin') then
    raise exception 'GASTOS_USD_GUARD';
  end if;
end $$;
