-- ─────────────────────────────────────────────────────────────────────────────
-- Avisos de cuenta corriente (fase 2 de 4): la deuda por vencimiento en un
-- viaje y el registro de qué aviso se mandó a quién.
--
-- Por qué (5/10/2026): Librería Colores cierra el 5 y cobra hasta el 15. La
-- pantalla (fase 3) muestra "a quién avisar hoy" (lógica en
-- features/clients/lib/avisos-cc.ts) y cada envío abre WhatsApp con el mensaje
-- de siempre. Hace falta:
--
--   1. `cc_deuda_por_vencimiento()`: la deuda viva de TODOS los clientes del
--      negocio agrupada por fecha de vencimiento, en una llamada. Sale de
--      `cc_deudas_vivas`, la misma regla que el vencimiento, la mora y el
--      resumen: el aviso no puede decir un número distinto que el cobro.
--      INVOKER: el aislamiento es la RLS de quien llama, y además filtra por
--      `current_negocio_id()`.
--
--   2. `cc_avisos`: quién marcó qué aviso como enviado. Una fila por cliente,
--      tipo y vencimiento (UNIQUE): marcar dos veces no duplica, y la pantalla
--      descuenta lo ya avisado del ciclo. Es HISTORIA: append-only (sin
--      UPDATE ni DELETE para nadie) y sin FK dura al cliente, que tiene que
--      sobrevivirlo. Guarda el monto avisado (foto del momento).
--      "Enviado" = alguien tocó Enviar y se abrió WhatsApp; el sistema no
--      sabe si el mensaje salió. Es lo que hay sin la API de Meta.
--
-- Permiso: `clientes.ver_modulo`, el mismo acceso que hoy tiene el botón
-- "Recordar" del detalle del cliente (no se le saca a nadie lo que ya hacía).
-- Reversión: supabase/reversals/20261005150000_cc_avisos.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. La tabla.
create table public.cc_avisos (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null default security.current_negocio_id()
                references public.negocios(id) on delete cascade,
  -- Sin FK: el registro sobrevive al cliente.
  cliente_id  uuid not null,
  tipo        text not null
                constraint cc_avisos_tipo_check
                check (tipo in ('CIERRE', 'PREVIO', 'MORA')),
  -- El vencimiento del ciclo: junto con el tipo identifica el aviso.
  vence_el    date not null,
  monto       numeric(14, 2) not null constraint cc_avisos_monto_check check (monto >= 0),
  enviado_por uuid not null default auth.uid(),
  enviado_en  timestamptz not null default now(),
  constraint cc_avisos_unico unique (negocio_id, cliente_id, tipo, vence_el)
);

comment on table public.cc_avisos is
  'Avisos de cuenta corriente marcados como enviados (por WhatsApp, a mano). Append-only, sin FK al cliente. Uno por cliente, tipo y vencimiento del ciclo. Lógica de qué toca: features/clients/lib/avisos-cc.ts.';

-- La pantalla pide los del ciclo: negocio + vencimiento (+ tipo).
create index cc_avisos_negocio_vence_idx
  on public.cc_avisos (negocio_id, vence_el, tipo);

alter table public.cc_avisos enable row level security;

create policy aislamiento_negocio on public.cc_avisos
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy cc_avisos_select on public.cc_avisos
  for select to authenticated
  using ((select public.tiene_permiso('clientes.ver_modulo')));

-- Se registra a nombre de quien lo manda, nunca de otro.
create policy cc_avisos_insert on public.cc_avisos
  for insert to authenticated
  with check (
    (select public.tiene_permiso('clientes.ver_modulo'))
    and enviado_por = (select auth.uid())
  );

revoke all on public.cc_avisos from public, anon, authenticated;
grant select, insert on public.cc_avisos to authenticated;
grant all on public.cc_avisos to service_role;

-- 2. La deuda viva por cliente y por vencimiento, del negocio actual.
create or replace function public.cc_deuda_por_vencimiento()
returns table (cliente_id uuid, vence_el date, vivo numeric)
language sql
stable
security invoker
set search_path to 'public', 'security', 'pg_temp'
as $function$
  select c.id, d.vence_el, round(sum(d.vivo), 2)
    from public.clientes c
   cross join lateral public.cc_deudas_vivas(c.id) d
   where c.negocio_id = (select security.current_negocio_id())
     and c.saldo_pendiente > 0
     and d.vivo > 0
   group by c.id, d.vence_el;
$function$;

comment on function public.cc_deuda_por_vencimiento() is
  'Deuda viva de los clientes del negocio actual agrupada por vencimiento (cc_deudas_vivas). Para la lista de avisos de cuenta corriente. INVOKER.';

revoke execute on function public.cc_deuda_por_vencimiento() from public, anon;
grant execute on function public.cc_deuda_por_vencimiento() to authenticated, service_role;

-- Guards: forma de las policies y permisos.
do $$
begin
  if (select count(*) from pg_policies where tablename = 'cc_avisos') <> 3 then
    raise exception 'cc_avisos: se esperaban 3 policies';
  end if;
  if not exists (
    select 1 from pg_policies
     where tablename = 'cc_avisos' and policyname = 'aislamiento_negocio'
       and permissive = 'RESTRICTIVE' and cmd = 'ALL'
       and qual like '%SELECT security.current_negocio_id()%'
       and with_check like '%SELECT security.current_negocio_id()%'
  ) then
    raise exception 'cc_avisos: la policy de aislamiento no tiene la forma esperada';
  end if;
  if has_table_privilege('anon', 'public.cc_avisos', 'select')
     or has_table_privilege('anon', 'public.cc_avisos', 'insert')
     or has_table_privilege('authenticated', 'public.cc_avisos', 'update')
     or has_table_privilege('authenticated', 'public.cc_avisos', 'delete') then
    raise exception 'cc_avisos: anon con acceso o authenticated con UPDATE/DELETE';
  end if;
  if has_function_privilege('anon', 'public.cc_deuda_por_vencimiento()', 'execute') then
    raise exception 'cc_deuda_por_vencimiento: anon puede ejecutarla';
  end if;
end $$;
