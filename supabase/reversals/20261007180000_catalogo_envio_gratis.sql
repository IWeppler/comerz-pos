-- Primero volver al código anterior: el catálogo nuevo pide estas columnas.
begin;
alter table public.configuracion_pos
  drop column envio_gratis_desde_monto,
  drop column envio_gratis_desde_unidades,
  drop column envio_gratis_alcance;
commit;
