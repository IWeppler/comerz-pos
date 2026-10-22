-- Reversión de 20261022120000_rls_tablas_variantes_internas.sql.
-- Vuelve al estado anterior (sin RLS, GRANT ALL a authenticated). Solo si la
-- fusión de productos falla por la policy: el estado anterior es inseguro.

begin;

drop policy if exists variantes_fusionadas_insert on public.variantes_fusionadas;
drop policy if exists aislamiento_negocio on public.variantes_fusionadas;
alter table public.variantes_fusionadas disable row level security;
grant all on public.variantes_fusionadas to authenticated;

alter table public.variantes_remapeo disable row level security;
alter table public.variantes_remapeo_aplicado disable row level security;
grant all on public.variantes_remapeo to authenticated;
grant all on public.variantes_remapeo_aplicado to authenticated;

commit;
