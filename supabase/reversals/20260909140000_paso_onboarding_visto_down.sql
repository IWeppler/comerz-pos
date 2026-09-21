-- Revierte 20260909140000: el embudo vuelve a no saber si la persona llegó a
-- ver el formulario del negocio.
--
-- Se borra la tabla y con ella el historial: es telemetría del alta, no un
-- dato del comercio, y no hay nada que reconstruir desde otro lado — ese es
-- justamente el motivo por el que la tabla existía.
--
-- El embudo se recrea con la forma anterior (DROP y no REPLACE: sacar una
-- columna del RETURNS TABLE también cambia el tipo de retorno).
drop function if exists public.registrar_paso_onboarding(text);
drop table if exists public.onboarding_pasos_vistos;

drop function if exists public.embudo_de_alta();

create function public.embudo_de_alta()
returns table (
  id uuid,
  email text,
  registrado timestamptz,
  confirmado timestamptz,
  ultima_sesion timestamptz,
  negocio_creado timestamptz,
  miembro_de_algun_negocio boolean,
  invitacion_pendiente boolean,
  es_super_admin boolean
)
language sql
stable
security definer
set search_path to 'public', 'auth', 'security'
as $$
  select
    u.id,
    u.email::text,
    u.created_at,
    u.email_confirmed_at,
    u.last_sign_in_at,
    (
      select min(n.created_at)
      from public.usuarios_negocios un
      join public.negocios n on n.id = un.negocio_id
      where un.usuario_id = u.id and un.es_owner
    ),
    exists (
      select 1 from public.usuarios_negocios un where un.usuario_id = u.id
    ),
    exists (
      select 1
      from public.invitaciones i
      where lower(i.email) = lower(u.email) and i.estado = 'PENDIENTE'
    ),
    security.es_super_admin(u.id)
  from auth.users u
  where security.is_super_admin()
  order by u.created_at desc;
$$;

revoke all on function public.embudo_de_alta() from public, anon;
grant execute on function public.embudo_de_alta() to authenticated;
