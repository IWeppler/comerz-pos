-- Notificaciones, N1: base + aviso de productos agotados (docs/notificaciones.md).
--
-- Sin pg_cron: los HECHOS se escriben en la misma transacción que los produce
-- (acá, un trigger sobre `movimientos_stock`); los ESTADOS se calculan al leer
-- (N3). Leído y "limpiar leídas" son por usuario.
--
--   1. `notificaciones`: hechos del negocio, uno por `clave` (dedupe). Sin
--      acceso directo: se leen por `mis_notificaciones()` (DEFINER, filtra
--      negocio, rol y configuración a mano).
--   2. `notificaciones_leidas`: por usuario y negocio. Sin acceso directo: RPC.
--   3. `configuracion_pos.notificaciones_roles`: qué categoría recibe cada rol
--      (`{"STOCK": ["ADMIN","ENCARGADO"], ...}`). Null = todas para ADMIN y
--      ENCARGADO. Las vendedoras nunca reciben avisos del negocio. Sin GRANT a anon.
--   4. Agotados: cuando una VENTA (o una orden de la tienda) deja un PRODUCTO
--      entero en 0 (todas sus variantes activas), se suma al aviso del día
--      (`stock_agotado:<día AR>`). Medido el 12/10/2026: por variante serían ~32
--      avisos por día en Evens (cada talle); por producto y agrupado, uno por día.
--   5. Retención perezosa: al leer se borran los hechos de más de 60 días.
-- Reversión: supabase/reversals/20261013100000_notificaciones_base.sql

create table public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id() references public.negocios(id) on delete cascade,
  tipo text not null check (tipo in ('STOCK_AGOTADO', 'ORDEN_PAGADA', 'ORDEN_REVISAR', 'ORDEN_SIN_STOCK', 'DEBITO_COBRADO')),
  clave text not null check (length(clave) between 3 and 200),
  titulo text not null check (length(titulo) between 1 and 200),
  detalle text check (detalle is null or length(detalle) <= 600),
  href text check (href is null or href like '/%'),
  datos jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (negocio_id, clave)
);
create index notificaciones_negocio_idx on public.notificaciones (negocio_id, actualizado_en desc);
alter table public.notificaciones enable row level security;
revoke all on public.notificaciones from public, anon, authenticated;

create table public.notificaciones_leidas (
  usuario_id uuid not null,
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  clave text not null check (length(clave) between 3 and 200),
  leida_en timestamptz not null default now(),
  oculta boolean not null default false,
  primary key (usuario_id, negocio_id, clave)
);
alter table public.notificaciones_leidas enable row level security;
revoke all on public.notificaciones_leidas from public, anon, authenticated;

alter table public.configuracion_pos add column notificaciones_roles jsonb;
comment on column public.configuracion_pos.notificaciones_roles is
  'Qué categoría de aviso recibe cada rol: {"STOCK":["ADMIN","ENCARGADO"],"TIENDA":[...],"PLAN":[...],"PLATA":[...]}. Null = todas para ADMIN y ENCARGADO.';

-- Categoría de cada tipo (lo que se configura por rol).
create or replace function public.categoria_notificacion(p_tipo text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case
    when p_tipo like 'STOCK_%' then 'STOCK'
    when p_tipo like 'ORDEN_%' then 'TIENDA'
    when p_tipo like 'DEBITO_%' or p_tipo like 'PLAN_%' or p_tipo like 'PRUEBA_%' then 'PLAN'
    else 'PLATA'
  end
$$;

-- ¿Este rol recibe esta categoría en este negocio? ADMIN y ENCARGADO, según config.
create or replace function public._rol_recibe_notificacion(p_negocio uuid, p_rol text, p_categoria text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select p_rol in ('ADMIN', 'ENCARGADO') and coalesce(
    (select (c.notificaciones_roles -> p_categoria) ? p_rol
       from public.configuracion_pos c
      where c.negocio_id = p_negocio and c.notificaciones_roles ? p_categoria),
    true)
$$;
revoke all on function public._rol_recibe_notificacion(uuid, text, text) from public, anon, authenticated;

-- ─── Agotados ────────────────────────────────────────────────────────────
create or replace function public._notificar_producto_agotado()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_restante numeric;
  v_nombre text;
  v_dia text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD');
  v_clave text;
  v_datos jsonb;
  v_cantidad int;
  v_nombres text;
begin
  -- Corre DENTRO de la venta: un aviso que falla nunca puede tirar la venta.
  begin
  if new.producto_id is null then return null; end if;

  select coalesce(sum(greatest(v.stock, 0)), 0) into v_restante
    from public.producto_variantes v
   where v.producto_id = new.producto_id and v.negocio_id = new.negocio_id and v.activa;
  if v_restante > 0 then return null; end if;

  select p.nombre into v_nombre from public.productos p where p.id = new.producto_id and p.negocio_id = new.negocio_id;
  v_clave := 'stock_agotado:' || v_dia;

  select n.datos into v_datos from public.notificaciones n
   where n.negocio_id = new.negocio_id and n.clave = v_clave for update;
  v_datos := coalesce(v_datos, jsonb_build_object('productos', '[]'::jsonb));
  if exists (select 1 from jsonb_array_elements(v_datos->'productos') e where e->>'id' = new.producto_id::text) then
    return null;
  end if;
  v_datos := jsonb_set(v_datos, '{productos}',
    (v_datos->'productos') || jsonb_build_array(jsonb_build_object('id', new.producto_id, 'nombre', coalesce(v_nombre, 'Producto'))));
  v_cantidad := jsonb_array_length(v_datos->'productos');
  select string_agg(e->>'nombre', ', ') into v_nombres
    from (select e from jsonb_array_elements(v_datos->'productos') e limit 3) x;

  insert into public.notificaciones (negocio_id, tipo, clave, titulo, detalle, href, datos, actualizado_en)
  values (new.negocio_id, 'STOCK_AGOTADO', v_clave,
          case when v_cantidad = 1 then 'Sin stock' else 'Se agotaron ' || v_cantidad || ' productos hoy' end,
          case when v_cantidad = 1 then coalesce(v_nombre, 'Un producto') || ' se quedó sin stock'
               else v_nombres || case when v_cantidad > 3 then ' y ' || (v_cantidad - 3) || ' más' else '' end end,
          '/stock', v_datos, clock_timestamp())
  on conflict (negocio_id, clave) do update
     set titulo = excluded.titulo, detalle = excluded.detalle, datos = excluded.datos, actualizado_en = clock_timestamp();
  exception when others then
    raise warning '[NOTIFICACIONES] aviso de agotado falló: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public._notificar_producto_agotado() from public, anon, authenticated;

create trigger trg_notificar_producto_agotado
  after insert on public.movimientos_stock
  for each row
  when (new.origen in ('VENTA', 'ORDEN_TIENDA') and new.stock_anterior > 0 and new.stock_nuevo <= 0)
  execute function public._notificar_producto_agotado();

-- ─── Lectura ─────────────────────────────────────────────────────────────
-- Hechos del negocio que este usuario recibe (rol + configuración), con su
-- estado de leído. Los estados derivados (N3) y las novedades (N5) se suman acá.
create or replace function public.mis_notificaciones()
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_usuario uuid := auth.uid();
  v_rol text := public.rol_actual();
  v_lista jsonb;
begin
  if v_negocio is null or v_usuario is null then
    return jsonb_build_object('tu_negocio', '[]'::jsonb, 'sin_leer', 0);
  end if;

  -- Retención perezosa (sin cron).
  delete from public.notificaciones where negocio_id = v_negocio and actualizado_en < now() - interval '60 days';

  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', n.clave, 'tipo', n.tipo, 'categoria', public.categoria_notificacion(n.tipo),
           'titulo', n.titulo, 'detalle', n.detalle, 'href', n.href, 'fecha', n.actualizado_en,
           'leida', l.leida_en is not null and l.leida_en >= n.actualizado_en)
         order by n.actualizado_en desc), '[]'::jsonb)
    into v_lista
    from public.notificaciones n
    left join public.notificaciones_leidas l
      on l.usuario_id = v_usuario and l.negocio_id = v_negocio and l.clave = n.clave
   where n.negocio_id = v_negocio
     and public._rol_recibe_notificacion(v_negocio, v_rol, public.categoria_notificacion(n.tipo))
     -- Oculta ("limpiar leídas") salvo que haya cambiado después.
     and not (coalesce(l.oculta, false) and l.leida_en >= n.actualizado_en);

  return jsonb_build_object(
    'tu_negocio', v_lista,
    'sin_leer', (select count(*) from jsonb_array_elements(v_lista) e where not (e->>'leida')::boolean));
end $$;

-- El número del ícono, sin armar la lista ni borrar nada.
create or replace function public.notificaciones_sin_leer()
returns integer language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select count(*)::int
    from public.notificaciones n
    left join public.notificaciones_leidas l
      on l.usuario_id = auth.uid() and l.negocio_id = n.negocio_id and l.clave = n.clave
   where n.negocio_id = security.current_negocio_id()
     and auth.uid() is not null
     and public._rol_recibe_notificacion(n.negocio_id, public.rol_actual(), public.categoria_notificacion(n.tipo))
     and (l.leida_en is null or l.leida_en < n.actualizado_en)
$$;

create or replace function public.marcar_notificaciones_leidas(p_claves text[])
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null or auth.uid() is null or p_claves is null then return; end if;
  insert into public.notificaciones_leidas (usuario_id, negocio_id, clave, leida_en)
  select auth.uid(), v_negocio, c, clock_timestamp() from unnest(p_claves[1:200]) c where length(c) between 3 and 200
  on conflict (usuario_id, negocio_id, clave) do update set leida_en = clock_timestamp();
end $$;

-- "Limpiar leídas": oculta las leídas para este usuario.
create or replace function public.limpiar_notificaciones_leidas()
returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if security.current_negocio_id() is null or auth.uid() is null then return; end if;
  update public.notificaciones_leidas set oculta = true
   where usuario_id = auth.uid() and negocio_id = security.current_negocio_id();
end $$;

revoke all on function public.mis_notificaciones() from public, anon;
revoke all on function public.notificaciones_sin_leer() from public, anon;
revoke all on function public.marcar_notificaciones_leidas(text[]) from public, anon;
revoke all on function public.limpiar_notificaciones_leidas() from public, anon;
grant execute on function public.mis_notificaciones() to authenticated;
grant execute on function public.notificaciones_sin_leer() to authenticated;
grant execute on function public.marcar_notificaciones_leidas(text[]) to authenticated;
grant execute on function public.limpiar_notificaciones_leidas() to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.notificaciones', 'SELECT')
    or has_table_privilege('authenticated', 'public.notificaciones', 'SELECT')
    or has_table_privilege('authenticated', 'public.notificaciones_leidas', 'SELECT')
    or has_column_privilege('anon', 'public.configuracion_pos', 'notificaciones_roles', 'SELECT')
    or has_function_privilege('anon', 'public.mis_notificaciones()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._rol_recibe_notificacion(uuid,text,text)', 'EXECUTE')
    or not exists (select 1 from pg_trigger where tgname = 'trg_notificar_producto_agotado') then
    raise exception 'NOTIFICACIONES_GUARD';
  end if;
end $$;
