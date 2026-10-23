-- Reversión de 20261023140000_gastos_comerz_dolares_y_comisiones.sql (a mano).
-- Ojo: borra las columnas nuevas. Un gasto en USD vuelve a ser solo su monto en
-- pesos, y una comisión pasa a categoría `otro` para no violar el CHECK viejo.
update public.gastos_comerz set categoria = 'otro' where categoria = 'comision';

alter table public.gastos_comerz
  drop constraint if exists gastos_comerz_origen_solo_comision,
  drop constraint if exists gastos_comerz_usd_completo,
  drop constraint if exists gastos_comerz_moneda_check;

alter table public.gastos_comerz
  drop column if exists pago_origen_id,
  drop column if exists negocio_origen_id,
  drop column if exists cotizacion_mep,
  drop column if exists monto_usd,
  drop column if exists moneda;

alter table public.gastos_comerz drop constraint gastos_comerz_categoria_check;
alter table public.gastos_comerz add constraint gastos_comerz_categoria_check
  check (categoria = any (array['infra', 'sueldo', 'marketing', 'impuestos', 'servicios', 'otro']));

comment on column public.gastos_comerz.monto is null;
