-- Deshace la conexión con ARCA. Los comprobantes fiscales ya emitidos (si los
-- hubiera) se quedan sin sus columnas de ARCA pero no se borran: un CAE
-- emitido es un hecho contable.

drop function if exists public.registrar_venta_facturada(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], jsonb);

drop table if exists public.comprobantes_iva;

drop index if exists public.comprobantes_numeracion_unica_idx;
create unique index if not exists comprobantes_numeracion_unica_idx
  on public.comprobantes (negocio_id, punto_venta, tipo, numero);

alter table public.comprobantes
  drop constraint if exists comprobantes_arca_ambiente_check;

alter table public.comprobantes
  drop constraint if exists comprobantes_importes_coherentes_check;
alter table public.comprobantes
  add constraint comprobantes_importes_coherentes_check
  check (neto >= 0 and iva_monto >= 0 and total >= 0);

alter table public.comprobantes
  drop column if exists exento,
  drop column if exists no_gravado,
  drop column if exists fecha_comprobante,
  drop column if exists receptor_doc_tipo,
  drop column if exists receptor_doc_nro,
  drop column if exists arca_ambiente,
  drop column if exists arca_resultado,
  drop column if exists arca_observaciones;

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_arca_ambiente_check;
alter table public.configuracion_pos
  drop column if exists arca_ambiente;

drop table if exists public.arca_credenciales;
