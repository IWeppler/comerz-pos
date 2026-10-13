-- Suscripciones, S2+S3: débito automático de Mercado Pago (docs/suscripciones.md).
--
--   1. `suscripciones_mp`: la suscripción (preapproval) de cada comercio en la
--      cuenta de MP de Comerz. Una VIVA por comercio (pending/authorized/paused);
--      las canceladas quedan como historia. Lee el super admin y el propio
--      comercio (para ver su estado y su link); escribe solo el server
--      (service_role).
--   2. `pagos_suscripcion.mp_payment_id` único: el mismo cobro de MP no se
--      registra dos veces (webhook repetido, reintento).
--   3. `registrar_pago_suscripcion_mp`: el cobro aprobado de una suscripción,
--      en UNA transacción: el pago, el vencimiento corrido un mes y, si estaba
--      en prueba, el pase a activo con el plan de la suscripción. Idempotente.
--      El período es el MISMO criterio que el pago manual
--      (`features/admin/lib/periodo-pago.ts`): desde el vencimiento si no
--      pasó, desde el día del cobro si ya pasó; + 1 mes topeado a fin de mes
--      (el `+ interval '1 month'` de Postgres topea igual que `sumarMeses`).
--      Las fechas de `plan_vencimiento` son medianoche UTC (así las escribe el
--      pago manual: `String(vencimiento).slice(0, 10)`): se leen en UTC. Leerlas
--      en hora argentina corría el vencimiento un día por cobro.
-- Reversión: supabase/reversals/20261012201739_suscripciones_mp.sql

create table public.suscripciones_mp (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  preapproval_id text not null unique check (length(preapproval_id) between 5 and 100),
  estado text not null default 'pending' check (estado in ('pending', 'authorized', 'paused', 'cancelled')),
  plan_id uuid references public.planes(id),
  monto numeric(14,2) not null check (monto > 0),
  payer_email text check (payer_email is null or length(payer_email) <= 254),
  -- Primer débito: el vencimiento vigente, o la creación si ya había vencido.
  inicio timestamptz,
  init_point text check (init_point is null or init_point like 'https://%'),
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index suscripciones_mp_una_viva on public.suscripciones_mp (negocio_id)
  where estado in ('pending', 'authorized', 'paused');
create index suscripciones_mp_negocio_idx on public.suscripciones_mp (negocio_id, creado_en desc);
alter table public.suscripciones_mp enable row level security;
revoke all on public.suscripciones_mp from public, anon, authenticated;
grant select on public.suscripciones_mp to authenticated;
create policy suscripciones_mp_select on public.suscripciones_mp for select to authenticated
  using ((select security.is_super_admin()) or negocio_id = (select security.current_negocio_id()));
comment on table public.suscripciones_mp is
  'Débito automático de Comerz a cada comercio (preapproval de MP). Escribe solo el server; ver docs/suscripciones.md.';

alter table public.pagos_suscripcion add column mp_payment_id text;
create unique index pagos_suscripcion_mp_payment_unico on public.pagos_suscripcion (mp_payment_id)
  where mp_payment_id is not null;

create or replace function public.registrar_pago_suscripcion_mp(
  p_preapproval_id text,
  p_mp_payment_id text,
  p_monto numeric,
  p_fecha date
)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sus record;
  v_neg record;
  v_plan record;
  v_desde date;
  v_hasta date;
  v_pago uuid;
begin
  if p_mp_payment_id is null or p_monto is null or p_monto <= 0 or p_fecha is null then
    raise exception 'PAGO_INCOMPLETO';
  end if;

  select * into v_sus from public.suscripciones_mp where preapproval_id = p_preapproval_id;
  if v_sus.id is null then return 'SUSCRIPCION_DESCONOCIDA'; end if;

  select n.id, n.estado, n.plan_vencimiento, n.plan_id into v_neg
    from public.negocios n where n.id = v_sus.negocio_id for update;

  if exists (select 1 from public.pagos_suscripcion where mp_payment_id = p_mp_payment_id) then
    return 'DUPLICADO';
  end if;

  select p.id, p.nombre into v_plan from public.planes p where p.id = coalesce(v_sus.plan_id, v_neg.plan_id);

  v_desde := greatest(coalesce((v_neg.plan_vencimiento at time zone 'UTC')::date, p_fecha), p_fecha);
  v_hasta := (v_desde + interval '1 month')::date;

  insert into public.pagos_suscripcion (negocio_id, monto, fecha_pago, periodo_desde, periodo_hasta, medio,
                                        plan_nombre, nota, registrado_por, mp_payment_id)
  values (v_neg.id, p_monto, p_fecha, v_desde, v_hasta, 'mercadopago',
          v_plan.nombre, 'Débito automático de Mercado Pago', null, p_mp_payment_id)
  on conflict do nothing
  returning id into v_pago;
  if v_pago is null then return 'DUPLICADO'; end if;

  update public.negocios
     set plan_vencimiento = v_hasta,
         plan_id = coalesce(v_sus.plan_id, plan_id),
         estado = case when estado = 'prueba' then 'activo' else estado end,
         estado_cambiado_en = case when estado = 'prueba' then now() else estado_cambiado_en end
   where id = v_neg.id;

  return 'APLICADO';
end $$;
revoke all on function public.registrar_pago_suscripcion_mp(text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.registrar_pago_suscripcion_mp(text, text, numeric, date) to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.suscripciones_mp', 'SELECT')
    or has_table_privilege('authenticated', 'public.suscripciones_mp', 'INSERT')
    or has_table_privilege('authenticated', 'public.suscripciones_mp', 'UPDATE')
    or has_function_privilege('authenticated', 'public.registrar_pago_suscripcion_mp(text,text,numeric,date)', 'EXECUTE')
    or has_function_privilege('anon', 'public.registrar_pago_suscripcion_mp(text,text,numeric,date)', 'EXECUTE') then
    raise exception 'SUSCRIPCIONES_GUARD';
  end if;
end $$;
