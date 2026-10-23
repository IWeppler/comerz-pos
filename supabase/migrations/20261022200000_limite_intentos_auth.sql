-- Límite de intentos para login, recuperación de contraseña, registro y reenvío
-- del mail de verificación (auditoría de seguridad del 22/10/2026, punto 4).
--
-- Por qué hace falta uno propio: el login corre en una server action, así que
-- Supabase Auth ve la IP de Vercel y no la de quien prueba claves. Su límite por
-- IP o se comparte entre todos los comercios o no frena a nadie. Acá se cuenta
-- con la IP real (`x-forwarded-for`, que pone Vercel) y por mail.
--
-- Diseño:
--  - `intentos_auth`: una fila por intento, con la clave HASHEADA en Node
--    (sha256 de "ip:…" / "email:…"): no se guardan mails ni IPs en claro.
--  - `auth_cupo_disponible(...)`: ¿todas las claves están por debajo de su tope
--    en la ventana? Con `p_registrar`, además anota el intento (cuenta CADA
--    intento: recuperación, registro, reenvío). El login la llama sin registrar
--    y anota con `auth_registrar_intento` solo los FALLIDOS.
--  - Solo service_role: RLS sin policies y EXECUTE solo para service_role
--    (patrón `mercadopago_conexiones`). anon/authenticated no ven ni tocan nada.
--  - Limpieza oportunista: al anotar, se borran filas de más de 1 día.
--
-- Aditiva: el código desplegado no la usa. El código nuevo, sin esta migración,
-- falla ABIERTO (deja pasar y loguea): ver shared/lib/limite-auth.ts.
-- Reversión: supabase/reversals/20261022200000_limite_intentos_auth.sql

begin;

create table public.intentos_auth (
  id        bigint generated always as identity primary key,
  accion    text not null check (accion in ('LOGIN', 'RECUPERAR', 'REGISTRO', 'VERIFICACION')),
  clave     text not null check (length(clave) between 1 and 128),
  creado_en timestamptz not null default now()
);

create index intentos_auth_accion_clave_creado_idx
  on public.intentos_auth (accion, clave, creado_en desc);
create index intentos_auth_creado_idx
  on public.intentos_auth (creado_en);

alter table public.intentos_auth enable row level security;
revoke all on public.intentos_auth from public, anon, authenticated;

create function public.auth_cupo_disponible(
  p_accion      text,
  p_claves      text[],
  p_maximos     int[],
  p_ventana_seg int,
  p_registrar   boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  i int;
begin
  if p_claves is null or p_maximos is null
     or coalesce(array_length(p_claves, 1), 0) = 0
     or array_length(p_claves, 1) <> array_length(p_maximos, 1)
     or p_ventana_seg is null or p_ventana_seg <= 0 then
    raise exception 'AUTH_CUPO_PARAMETROS_INVALIDOS';
  end if;

  for i in 1 .. array_length(p_claves, 1) loop
    if (select count(*)
          from public.intentos_auth t
         where t.accion = p_accion
           and t.clave = p_claves[i]
           and t.creado_en > now() - make_interval(secs => p_ventana_seg)) >= p_maximos[i] then
      return false;
    end if;
  end loop;

  if p_registrar then
    perform public.auth_registrar_intento(p_accion, p_claves);
  end if;
  return true;
end $$;

create function public.auth_registrar_intento(p_accion text, p_claves text[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  insert into public.intentos_auth (accion, clave)
  select p_accion, c from unnest(p_claves) as c where c is not null and c <> '';

  -- Limpieza oportunista: nada mira más de una hora atrás.
  if random() < 0.02 then
    delete from public.intentos_auth where creado_en < now() - interval '1 day';
  end if;
end $$;

revoke all on function public.auth_cupo_disponible(text, text[], int[], int, boolean) from public, anon, authenticated;
revoke all on function public.auth_registrar_intento(text, text[]) from public, anon, authenticated;
grant execute on function public.auth_cupo_disponible(text, text[], int[], int, boolean) to service_role;
grant execute on function public.auth_registrar_intento(text, text[]) to service_role;
grant select, insert, delete on public.intentos_auth to service_role;

do $guard$
declare
  r text;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.intentos_auth'::regclass) then
    raise exception 'intentos_auth sin RLS';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'intentos_auth') then
    raise exception 'intentos_auth no debe tener policies';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.intentos_auth', 'SELECT')
       or has_table_privilege(r, 'public.intentos_auth', 'INSERT')
       or has_table_privilege(r, 'public.intentos_auth', 'DELETE') then
      raise exception '% tiene acceso a intentos_auth', r;
    end if;
    if has_function_privilege(r, 'public.auth_cupo_disponible(text, text[], int[], int, boolean)', 'EXECUTE')
       or has_function_privilege(r, 'public.auth_registrar_intento(text, text[])', 'EXECUTE') then
      raise exception '% puede ejecutar las funciones de cupo', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.auth_cupo_disponible(text, text[], int[], int, boolean)', 'EXECUTE') then
    raise exception 'service_role no puede ejecutar auth_cupo_disponible';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'quedó una tabla de public sin RLS';
  end if;
end $guard$;

commit;
