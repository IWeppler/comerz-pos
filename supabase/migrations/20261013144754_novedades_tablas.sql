-- Notificaciones, N5: "Novedades" de Comerz (docs/notificaciones.md). El super
-- admin escribe una novedad en /admincomerz/novedades y aparece en la campana de
-- TODOS los usuarios, de todos los negocios, al publicarla.
--
--   1. `novedades`: GLOBAL (sin negocio_id, a propósito: es Comerz hablándole a
--      todos). Título, ícono de una lista fija, cuerpo con **negritas** y viñetas
--      ("- "), `publicada_en` (null = borrador). Sin acceso directo: se lee por
--      `mis_notificaciones()` y se escribe por RPC de super admin.
--   2. `novedades_vistas (usuario, novedad)`: leído POR USUARIO, no por negocio
--      (quien tiene dos negocios la ve una vez).
--   3. Un usuario nuevo no recibe como "sin leer" lo publicado antes de que se
--      creara su cuenta: la lista la muestra, el contador no.
--   4. `mis_notificaciones()` suma la clave `novedades`; `notificaciones_sin_leer()`
--      las cuenta; `marcar_notificaciones_leidas()` acepta claves `novedad:<id>`.
--      Reescritas enteras con guard de md5 del cuerpo vivo (N3 / N1).
--   5. RPC de super admin: `novedades_admin()`, `guardar_novedad(...)`,
--      `eliminar_novedad(id)`; cada una exige `security.is_super_admin()`.
-- Partida en dos porque el conector MCP rechazaba el script entero (13/10/2026):
--   20261013144754_novedades_tablas.sql (tablas + RPC del editor, nada existente cambia)
--   20261013144814_novedades_lectura.sql (mis_notificaciones / sin_leer / marcar)
-- Esta es la parte 1/2. Test: supabase/tests/novedades.sql
-- Reversión: supabase/reversals/20261013144754_novedades_tablas.sql


create table public.novedades (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(btrim(titulo)) between 1 and 120),
  icono text not null default 'sparkles' check (icono in ('sparkles', 'rocket', 'wrench', 'megaphone', 'gift')),
  cuerpo text not null default '' check (length(cuerpo) <= 4000),
  publicada_en timestamptz,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index novedades_publicadas_idx on public.novedades (publicada_en desc) where publicada_en is not null;
alter table public.novedades enable row level security;
revoke all on public.novedades from public, anon, authenticated;

create table public.novedades_vistas (
  usuario_id uuid not null,
  novedad_id uuid not null references public.novedades(id) on delete cascade,
  vista_en timestamptz not null default now(),
  primary key (usuario_id, novedad_id)
);
create index novedades_vistas_novedad_idx on public.novedades_vistas (novedad_id);
alter table public.novedades_vistas enable row level security;
revoke all on public.novedades_vistas from public, anon, authenticated;

-- Las últimas 20 publicadas en 120 días, con su estado de leído para este usuario.
create or replace function public._novedades_para(p_usuario uuid)
returns table (clave text, id uuid, titulo text, icono text, cuerpo text, fecha timestamptz, leida boolean)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select 'novedad:' || n.id, n.id, n.titulo, n.icono, n.cuerpo, n.publicada_en,
         exists (select 1 from public.novedades_vistas v where v.usuario_id = p_usuario and v.novedad_id = n.id)
           or n.publicada_en < coalesce((select u.created_at from auth.users u where u.id = p_usuario), '-infinity')
    from public.novedades n
   where n.publicada_en is not null and n.publicada_en > now() - interval '120 days' and p_usuario is not null
   order by n.publicada_en desc
   limit 20
$$;
revoke all on function public._novedades_para(uuid) from public, anon, authenticated;

-- ─── Super admin ─────────────────────────────────────────────────────────
create or replace function public.novedades_admin()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not security.is_super_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'titulo', n.titulo, 'icono', n.icono, 'cuerpo', n.cuerpo,
             'publicada_en', n.publicada_en, 'creado_en', n.creado_en, 'actualizado_en', n.actualizado_en,
             'vistas', (select count(*) from public.novedades_vistas v where v.novedad_id = n.id))
           order by coalesce(n.publicada_en, n.creado_en) desc)
      from public.novedades n), '[]'::jsonb);
end $$;

-- Crea (p_id null) o edita. p_publicar: true publica (conserva la fecha si ya
-- estaba publicada), false la deja / vuelve a borrador.
create or replace function public.guardar_novedad(
  p_id uuid, p_titulo text, p_icono text, p_cuerpo text, p_publicar boolean)
returns uuid language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_id uuid;
begin
  if not security.is_super_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.novedades (titulo, icono, cuerpo, publicada_en, creado_por)
    values (btrim(p_titulo), p_icono, coalesce(p_cuerpo, ''), case when p_publicar then now() end, auth.uid())
    returning id into v_id;
  else
    update public.novedades
       set titulo = btrim(p_titulo), icono = p_icono, cuerpo = coalesce(p_cuerpo, ''),
           publicada_en = case when p_publicar then coalesce(publicada_en, now()) end,
           actualizado_en = now()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'NOVEDAD_INEXISTENTE';
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.eliminar_novedad(p_id uuid)
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if not security.is_super_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  delete from public.novedades where id = p_id;
end $$;

revoke all on function public.novedades_admin() from public, anon;
revoke all on function public.guardar_novedad(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.eliminar_novedad(uuid) from public, anon;
grant execute on function public.novedades_admin() to authenticated;
grant execute on function public.guardar_novedad(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.eliminar_novedad(uuid) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.novedades', 'SELECT')
    or has_table_privilege('anon', 'public.novedades', 'SELECT')
    or has_table_privilege('authenticated', 'public.novedades_vistas', 'SELECT')
    or has_function_privilege('authenticated', 'public._novedades_para(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.guardar_novedad(uuid,text,text,text,boolean)', 'EXECUTE') then
    raise exception 'NOVEDADES_GUARD';
  end if;
end $$;
