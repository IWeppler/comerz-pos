-- Suscripciones, S1: precio acordado por comercio (docs/suscripciones.md).
--
-- Hay comercios que pagan menos que el plan (ayudan con el producto). Ese
-- precio no estaba guardado: el MRR sumaba el de lista.
--
--   1. `negocios.precio_acordado`: null = precio de lista del plan. Lo ve el
--      comercio (es su precio); el MOTIVO no, por eso va al historial.
--   2. `precios_acordados`: historial append-only, solo super admin, sin FK
--      dura a negocios (sobrevive a la baja).
--   3. `fijar_precio_acordado(negocio, precio, motivo)`: super admin, escribe
--      negocio + historial en una transacción.
--   4. Las tres RPC del panel de Comerz devuelven `plan_precio` = precio
--      EFECTIVO (`coalesce(precio_acordado, precio de lista)`). Espejo TS:
--      `features/admin/lib/precio-efectivo.ts`. Cuerpo VIVO + reemplazos que
--      matchean una vez.
-- Reversión: supabase/reversals/20261012200111_precio_acordado.sql

alter table public.negocios
  add column precio_acordado numeric(14,2)
    constraint negocios_precio_acordado_check check (precio_acordado is null or precio_acordado >= 0);
comment on column public.negocios.precio_acordado is
  'Lo que paga este comercio por mes. Null = el precio de lista de su plan. El motivo está en precios_acordados (solo super admin).';

create table public.precios_acordados (
  id uuid primary key default gen_random_uuid(),
  -- Sin FK: el historial sobrevive a lo que registra.
  negocio_id uuid not null,
  precio numeric(14,2) check (precio is null or precio >= 0),
  motivo text check (motivo is null or length(motivo) <= 300),
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index precios_acordados_negocio_idx on public.precios_acordados (negocio_id, creado_en desc);
alter table public.precios_acordados enable row level security;
revoke all on public.precios_acordados from public, anon, authenticated;
grant select on public.precios_acordados to authenticated;
create policy precios_acordados_super_admin on public.precios_acordados
  for select to authenticated using ((select security.is_super_admin()));
comment on table public.precios_acordados is
  'Historial de precios acordados con cada comercio y por qué. Solo super admin; se escribe por fijar_precio_acordado.';

create or replace function public.fijar_precio_acordado(p_negocio uuid, p_precio numeric, p_motivo text default null)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  if not coalesce(security.is_super_admin(), false) then raise exception 'SIN_PERMISO'; end if;
  if p_precio is not null and p_precio < 0 then raise exception 'PRECIO_INVALIDO'; end if;

  update public.negocios set precio_acordado = p_precio where id = p_negocio returning id into v_id;
  if v_id is null then return false; end if;

  insert into public.precios_acordados (negocio_id, precio, motivo)
  values (p_negocio, p_precio, nullif(btrim(coalesce(p_motivo, '')), ''));
  return true;
end $$;
revoke all on function public.fijar_precio_acordado(uuid, numeric, text) from public, anon;
grant execute on function public.fijar_precio_acordado(uuid, numeric, text) to authenticated;

do $$
declare
  v_def text;
  v_veces int;
  r record;
begin
  for r in
    select * from (values
      ('public.comercios_con_uso()',
       E'    coalesce(pl.precio_mensual, 0) as plan_precio,\n',
       E'    coalesce(n.precio_acordado, pl.precio_mensual, 0) as plan_precio,\n'),
      ('public.ciclo_de_vida_negocios()',
       E'    p.precio_mensual as plan_precio,\n',
       E'    coalesce(n.precio_acordado, p.precio_mensual) as plan_precio,\n'),
      ('public.metricas_globales_comerz()',
       E'        ''plan_precio'', coalesce(pl.precio_mensual, 0),\n',
       E'        ''plan_precio'', coalesce(n.precio_acordado, pl.precio_mensual, 0),\n')
    ) as t(funcion, buscar, nuevo)
  loop
    v_def := pg_get_functiondef(r.funcion::regprocedure);
    v_veces := (length(v_def) - length(replace(v_def, r.buscar, ''))) / length(r.buscar);
    if v_veces <> 1 then raise exception 'PRECIO_ANCLA %: matchea % veces', r.funcion, v_veces; end if;
    execute replace(v_def, r.buscar, r.nuevo);
    v_def := pg_get_functiondef(r.funcion::regprocedure);
    if position('precio_acordado' in v_def) = 0 or position('SECURITY DEFINER' in v_def) = 0 then
      raise exception 'PRECIO_GUARD %', r.funcion;
    end if;
  end loop;

  if has_column_privilege('anon', 'public.negocios', 'precio_acordado', 'SELECT')
    or has_table_privilege('anon', 'public.precios_acordados', 'SELECT')
    or has_table_privilege('authenticated', 'public.precios_acordados', 'INSERT')
    or has_function_privilege('anon', 'public.fijar_precio_acordado(uuid,numeric,text)', 'EXECUTE') then
    raise exception 'PRECIO_GUARD_GRANTS';
  end if;
end $$;
