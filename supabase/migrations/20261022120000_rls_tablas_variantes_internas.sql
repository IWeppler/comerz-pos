-- RLS en las tres tablas de la reorganización de variantes (septiembre).
--
-- El advisor de Supabase las marca como críticas: sin RLS y con GRANT ALL a
-- `authenticated`, cualquier usuario logueado de cualquier negocio podía leer,
-- modificar o borrar estas filas por PostgREST (anon no tenía grant).
--
-- Dos casos distintos:
--  - `variantes_fusionadas` está VIVA: la escribe `fusionar_productos`
--    (SECURITY INVOKER, Stock › Fusionar). Activar RLS sin policy la rompe. Lleva
--    aislamiento por negocio y solo INSERT: es historia para revertir, append-only.
--    La app no la lee (la reversión se hace con SQL de servicio).
--  - `variantes_remapeo` y `variantes_remapeo_aplicado` no las escribe ni las lee
--    ninguna función ni la app (son el rastro de 20260902130000 para un rollback
--    exacto). Quedan como `backfill_variante_id_20260903`: RLS sin policies y sin
--    GRANT a anon/authenticated.
--
-- Verificado en seco (transacción revertida) como `authenticated` de un negocio
-- demo: INSERT del propio negocio pasa, INSERT a otro negocio falla, SELECT
-- devuelve 0 filas, UPDATE/DELETE no tocan nada, y las otras dos tablas dan
-- permission denied.
-- Reversión: supabase/reversals/20261022120000_rls_tablas_variantes_internas.sql

begin;

alter table public.variantes_fusionadas enable row level security;

create policy aislamiento_negocio on public.variantes_fusionadas
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy variantes_fusionadas_insert on public.variantes_fusionadas
  as permissive for insert to authenticated
  with check (true);

revoke update, delete, truncate on public.variantes_fusionadas from authenticated;
revoke all on public.variantes_fusionadas from anon;

alter table public.variantes_remapeo enable row level security;
alter table public.variantes_remapeo_aplicado enable row level security;
revoke all on public.variantes_remapeo from anon, authenticated;
revoke all on public.variantes_remapeo_aplicado from anon, authenticated;

do $guard$
declare
  v_sin_rls int;
  v_policies int;
  v_grants int;
begin
  select count(*) into v_sin_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_sin_rls <> 0 then
    raise exception 'quedan % tablas de public sin RLS', v_sin_rls;
  end if;

  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'variantes_fusionadas';
  if v_policies <> 2 then
    raise exception 'variantes_fusionadas: se esperaban 2 policies, hay %', v_policies;
  end if;

  select count(*) into v_grants from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('variantes_remapeo', 'variantes_remapeo_aplicado')
     and grantee in ('anon', 'authenticated');
  if v_grants <> 0 then
    raise exception 'variantes_remapeo*: quedan % grants a anon/authenticated', v_grants;
  end if;

  select count(*) into v_grants from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'variantes_fusionadas'
     and grantee = 'authenticated' and privilege_type = 'INSERT';
  if v_grants <> 1 then
    raise exception 'variantes_fusionadas: authenticated perdió INSERT (fusionar_productos lo necesita)';
  end if;
end
$guard$;

commit;
