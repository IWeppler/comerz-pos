-- Vuelve a los criterios fijos del codigo.
alter table public.configuracion_pos
  drop column if exists arca_recargos_iva,
  drop column if exists arca_ri_a_monotributo,
  drop column if exists arca_tope_consumidor_final;
