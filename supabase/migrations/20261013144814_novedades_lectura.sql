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
-- Esta es la parte 2/2. Test: supabase/tests/novedades.sql
-- Reversión: supabase/reversals/20261013144754_novedades_tablas.sql


do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.mis_notificaciones()'::regprocedure) <> 'b207845a986a604cbe91c37110cb61c3'
     or (select md5(prosrc) from pg_proc where oid = 'public.notificaciones_sin_leer()'::regprocedure) <> 'a10eaf3a0cb75612e738091a03eb82a6'
     or (select md5(prosrc) from pg_proc where oid = 'public.marcar_notificaciones_leidas(text[])'::regprocedure) <> 'bc1c68d233120bf755700d2b6bc403d3' then
    raise exception 'NOVEDADES_CUERPO_VIVO_DISTINTO';
  end if;
end $$;

-- ─── Lectura ─────────────────────────────────────────────────────────────
create or replace function public.mis_notificaciones()
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_usuario uuid := auth.uid();
  v_rol text := public.rol_actual();
  v_lista jsonb := '[]'::jsonb;
  v_novedades jsonb;
begin
  if v_usuario is null then
    return jsonb_build_object('tu_negocio', '[]'::jsonb, 'novedades', '[]'::jsonb, 'sin_leer', 0);
  end if;

  -- Novedades: de Comerz para todos, haya negocio activo o no.
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', n.clave, 'icono', n.icono, 'titulo', n.titulo, 'cuerpo', n.cuerpo,
           'fecha', n.fecha, 'leida', n.leida) order by n.fecha desc), '[]'::jsonb)
    into v_novedades
    from public._novedades_para(v_usuario) n;

  if v_negocio is not null then
    -- Retención perezosa (sin cron).
    delete from public.notificaciones where negocio_id = v_negocio and actualizado_en < now() - interval '60 days';

    with avisos as (
      select n.clave, n.tipo, n.titulo, n.detalle, n.href, n.actualizado_en as fecha
        from public.notificaciones n
       where n.negocio_id = v_negocio
      union all
      select e.clave, e.tipo, e.titulo, e.detalle, e.href, e.fecha
        from public._estados_notificaciones(v_negocio) e
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'clave', a.clave, 'tipo', a.tipo, 'categoria', public.categoria_notificacion(a.tipo),
             'titulo', a.titulo, 'detalle', a.detalle, 'href', a.href, 'fecha', a.fecha,
             'leida', l.leida_en is not null and l.leida_en >= a.fecha)
           order by a.fecha desc), '[]'::jsonb)
      into v_lista
      from avisos a
      left join public.notificaciones_leidas l
        on l.usuario_id = v_usuario and l.negocio_id = v_negocio and l.clave = a.clave
     where public._rol_recibe_notificacion(v_negocio, v_rol, public.categoria_notificacion(a.tipo))
       -- Oculta ("limpiar leídas") salvo que haya cambiado después.
       and not (coalesce(l.oculta, false) and l.leida_en >= a.fecha);
  end if;

  return jsonb_build_object(
    'tu_negocio', v_lista,
    'novedades', v_novedades,
    'sin_leer', (select count(*) from jsonb_array_elements(v_lista) e where not (e->>'leida')::boolean)
              + (select count(*) from jsonb_array_elements(v_novedades) e where not (e->>'leida')::boolean));
end $$;

create or replace function public.notificaciones_sin_leer()
returns integer language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  with ctx as (
    select security.current_negocio_id() as negocio, auth.uid() as usuario, public.rol_actual() as rol
  ),
  avisos as (
    select n.clave, n.tipo, n.actualizado_en as fecha
      from public.notificaciones n, ctx
     where n.negocio_id = ctx.negocio
    union all
    -- Las vendedoras no reciben avisos del negocio: ni se calculan (el filtro
    -- dentro del lateral se evalúa antes de llamar a la función).
    select e.clave, e.tipo, e.fecha
      from ctx cross join lateral (
        select * from public._estados_notificaciones(ctx.negocio)
         where ctx.rol in ('ADMIN', 'ENCARGADO')
      ) e
  )
  select (select count(*)::int
            from avisos a
            cross join ctx
            left join public.notificaciones_leidas l
              on l.usuario_id = ctx.usuario and l.negocio_id = ctx.negocio and l.clave = a.clave
           where ctx.usuario is not null
             and public._rol_recibe_notificacion(ctx.negocio, ctx.rol, public.categoria_notificacion(a.tipo))
             and (l.leida_en is null or l.leida_en < a.fecha))
       + (select count(*)::int from ctx, public._novedades_para(ctx.usuario) n where not n.leida)
$$;

create or replace function public.marcar_notificaciones_leidas(p_claves text[])
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if auth.uid() is null or p_claves is null then return; end if;

  -- Novedades: por usuario, valgan en el negocio que valgan.
  insert into public.novedades_vistas (usuario_id, novedad_id)
  select auth.uid(), n.id
    from unnest(p_claves[1:200]) c
    join public.novedades n on c = 'novedad:' || n.id and n.publicada_en is not null
  on conflict do nothing;

  if v_negocio is null then return; end if;
  insert into public.notificaciones_leidas (usuario_id, negocio_id, clave, leida_en)
  select auth.uid(), v_negocio, c, clock_timestamp() from unnest(p_claves[1:200]) c
   where length(c) between 3 and 200 and c not like 'novedad:%'
  on conflict (usuario_id, negocio_id, clave) do update set leida_en = clock_timestamp();
end $$;

do $$
begin
  if not has_function_privilege('authenticated', 'public.mis_notificaciones()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.notificaciones_sin_leer()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.marcar_notificaciones_leidas(text[])', 'EXECUTE')
    or has_function_privilege('anon', 'public.mis_notificaciones()', 'EXECUTE') then
    raise exception 'NOVEDADES_GUARD';
  end if;
end $$;
