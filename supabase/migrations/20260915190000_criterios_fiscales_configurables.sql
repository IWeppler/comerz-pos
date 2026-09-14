-- Tres criterios fiscales que estaban como constantes pasan a configuración
-- del comercio. Los dos primeros son decisiones que confirma CADA contador;
-- el tercero es un número que fija ARCA por resolución y cambia.
--
--   arca_recargos_iva          cómo se factura el recargo por método de pago
--                              y el de cuenta corriente en A/B. Default
--                              GRAVADO_21 (lo que había en el código).
--   arca_ri_a_monotributo      qué emite un RI cuando le vende a un
--                              monotributista. Default FACTURA_B.
--   arca_tope_consumidor_final tope para consumidor final sin identificar.
--                              NULL = el default del sistema (código), así
--                              cuando ARCA lo actualice, un cambio de código
--                              alcanza a todos los que no lo pisaron a mano.
--
-- Solo importan con modo ARCA. Los defaults dejan a todos como estaban.

alter table public.configuracion_pos
  add column if not exists arca_recargos_iva text not null default 'GRAVADO_21',
  add column if not exists arca_ri_a_monotributo text not null default 'FACTURA_B',
  add column if not exists arca_tope_consumidor_final numeric(14, 2);

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_arca_recargos_iva_check;
alter table public.configuracion_pos
  add constraint configuracion_pos_arca_recargos_iva_check
  check (arca_recargos_iva in ('GRAVADO_21', 'GRAVADO_105', 'GRAVADO_27', 'EXENTO', 'NO_GRAVADO'));

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_arca_ri_a_monotributo_check;
alter table public.configuracion_pos
  add constraint configuracion_pos_arca_ri_a_monotributo_check
  check (arca_ri_a_monotributo in ('FACTURA_A', 'FACTURA_B'));

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_arca_tope_cf_check;
alter table public.configuracion_pos
  add constraint configuracion_pos_arca_tope_cf_check
  check (arca_tope_consumidor_final is null or arca_tope_consumidor_final > 0);

comment on column public.configuracion_pos.arca_recargos_iva is
  'Tratamiento de IVA de los recargos (metodo de pago y cuenta corriente) en facturas A/B. Lo confirma el contador.';
comment on column public.configuracion_pos.arca_ri_a_monotributo is
  'Letra que emite un Responsable Inscripto a un Monotributista: FACTURA_A o FACTURA_B. Lo confirma el contador.';
comment on column public.configuracion_pos.arca_tope_consumidor_final is
  'Tope para facturar a consumidor final sin DNI/CUIT. NULL = default del sistema (codigos-arca.ts), que sigue a la RG vigente.';
