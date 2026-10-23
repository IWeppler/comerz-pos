-- Origen del alta en el negocio: de dónde vino cada comercio nuevo.
--
-- La app ya junta `?ref=` y `utm_*` de /empezar y los deja en
-- `auth.users.raw_user_meta_data->'origen_alta'` (ver shared/lib/origen-alta.ts
-- y docs/alta-y-sesion.md). Acá:
--
--   1. `negocios.origen_alta` (jsonb, null = no se sabe). Congelado: lo escribe
--      un trigger al crear el negocio y después solo el super admin (la única
--      policy de UPDATE sobre `negocios` es la suya). `anon` no la ve: los
--      GRANT de anon sobre `negocios` son por columna.
--   2. El trigger copia el origen de la cuenta de quien crea el negocio, SOLO
--      si es su primer negocio: un segundo negocio de la misma persona no es
--      otro referido. Sin tocar `crear_negocio_con_owner` (cambiar su firma
--      crearía una sobrecarga, y ya hay dos).
--   3. `codigos_referido`: códigos de SOCIOS y campañas (un contador, un
--      revendedor). El código de un COMERCIO no se guarda acá: es su slug, y
--      copiarlo sería un dato duplicado que se desincroniza.
--   4. `funnel_comerz` devuelve el origen y a quién corresponde el `ref`.
--
-- El premio NO está acá: se ata al primer pago (prueba → activo), nunca al
-- alta, y se decide después.

-- 1. Columna ------------------------------------------------------------------

alter table public.negocios add column origen_alta jsonb;

comment on column public.negocios.origen_alta is
  'De dónde vino el comercio: {ref, utm_source, utm_medium, utm_campaign}, copiado de la cuenta del dueño al crear su primer negocio. NULL = no se sabe (no es "orgánico"). Ver 20261023100000.';

create index negocios_origen_ref_idx
  on public.negocios ((origen_alta ->> 'ref'))
  where origen_alta ? 'ref';

-- 2. Trigger ------------------------------------------------------------------

-- ESPEJO de `limpiar()` en shared/lib/origen-alta.ts: mismos cuatro campos,
-- solo strings, minúscula, [a-z0-9._-]{1,64}. `user_metadata` lo escribe el
-- propio usuario, así que se vuelve a limpiar acá.
create or replace function public.negocios_origen_alta_desde_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_meta jsonb;
  v_origen jsonb := '{}'::jsonb;
  v_campo text;
  v_valor text;
begin
  if new.origen_alta is not null or v_uid is null then
    return new;
  end if;

  -- Solo el primer negocio. En BEFORE INSERT la membresía del negocio nuevo
  -- todavía no existe, así que cualquier fila es de un negocio anterior.
  if exists (select 1 from public.usuarios_negocios un where un.usuario_id = v_uid) then
    return new;
  end if;

  select u.raw_user_meta_data -> 'origen_alta' into v_meta
    from auth.users u
   where u.id = v_uid;

  if v_meta is null or jsonb_typeof(v_meta) <> 'object' then
    return new;
  end if;

  foreach v_campo in array array['ref', 'utm_source', 'utm_medium', 'utm_campaign'] loop
    if jsonb_typeof(v_meta -> v_campo) = 'string' then
      v_valor := lower(btrim(v_meta ->> v_campo));
      if v_valor ~ '^[a-z0-9._-]{1,64}$' then
        v_origen := v_origen || jsonb_build_object(v_campo, v_valor);
      end if;
    end if;
  end loop;

  if v_origen <> '{}'::jsonb then
    new.origen_alta := v_origen;
  end if;

  return new;
end;
$$;

revoke all on function public.negocios_origen_alta_desde_usuario() from public, anon, authenticated;

create trigger trg_negocios_origen_alta
  before insert on public.negocios
  for each row execute function public.negocios_origen_alta_desde_usuario();

-- 3. Códigos de socios --------------------------------------------------------

-- Tabla de PLATAFORMA (como `planes`): no es de un negocio, no lleva
-- `negocio_id`. Solo el super admin la ve y la escribe.
create table public.codigos_referido (
  codigo text primary key check (codigo ~ '^[a-z0-9._-]{1,64}$'),
  nombre text not null check (btrim(nombre) <> ''),
  tipo text not null default 'SOCIO' check (tipo in ('SOCIO', 'CAMPANA')),
  notas text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.codigos_referido is
  'Códigos de referido de socios y campañas. El de un comercio es su slug y NO va acá. Un código no puede coincidir con un slug: ver trg_codigos_referido_sin_slug. Ver 20261023100000.';

alter table public.codigos_referido enable row level security;

create policy codigos_referido_super_admin on public.codigos_referido
  for all to authenticated
  using ((select security.is_super_admin()))
  with check ((select security.is_super_admin()));

revoke all on public.codigos_referido from anon, public;
grant select, insert, update, delete on public.codigos_referido to authenticated;

-- Un `ref` se resuelve primero contra los slugs. Un código de socio igual a un
-- slug existente le atribuiría sus altas a un comercio: se frena al cargarlo.
create or replace function public.codigos_referido_sin_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.negocios n where lower(n.slug) = new.codigo) then
    raise exception 'CODIGO_REFERIDO_ES_SLUG: "%" ya es la dirección de un comercio', new.codigo;
  end if;
  return new;
end;
$$;

revoke all on function public.codigos_referido_sin_slug() from public, anon, authenticated;

create trigger trg_codigos_referido_sin_slug
  before insert or update of codigo on public.codigos_referido
  for each row execute function public.codigos_referido_sin_slug();

-- 4. funnel_comerz con el origen ---------------------------------------------

-- Cambia el tipo de retorno: DROP + CREATE (create or replace no puede).
-- Cuerpo tomado de la versión VIVA, más las dos columnas al final.
drop function public.funnel_comerz();

create function public.funnel_comerz()
 returns table(id uuid, nombre text, estado text, alta timestamp with time zone, primera_venta timestamp with time zone, ultima_venta timestamp with time zone, ventas_total bigint, pagos bigint, primer_pago date, origen_alta jsonb, referido_por text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    n.id,
    n.nombre,
    n.estado,
    n.created_at as alta,
    (select min(v.fecha_venta) from public.ventas v
      where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
    (select max(v.fecha_venta) from public.ventas v
      where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
    (select count(*) from public.ventas v
      where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
    (select count(*) from public.pagos_suscripcion p where p.negocio_id = n.id),
    (select min(p.fecha_pago) from public.pagos_suscripcion p where p.negocio_id = n.id),
    n.origen_alta,
    -- A quién corresponde el `ref`: primero un comercio (su slug), después un
    -- socio. NULL si no vino ref o si el código no es de nadie.
    coalesce(
      (select r.nombre from public.negocios r
        where lower(r.slug) = n.origen_alta ->> 'ref' and r.id <> n.id),
      (select c.nombre from public.codigos_referido c
        where c.codigo = n.origen_alta ->> 'ref')
    )
  from public.negocios n
  -- SECURITY DEFINER: sin este filtro cualquiera que llame la funcion ve TODOS
  -- los negocios. El corte es explicito y es lo unico que la protege, porque
  -- definer se saltea RLS.
  where security.is_super_admin()
  order by n.created_at;
$function$;

revoke all on function public.funnel_comerz() from public, anon;
grant execute on function public.funnel_comerz() to authenticated, service_role;

-- Guards ----------------------------------------------------------------------

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'funnel_comerz') <> 1 then
    raise exception 'GUARD: funnel_comerz tiene que quedar una sola';
  end if;

  if pg_get_functiondef('public.funnel_comerz()'::regprocedure) not like '%where security.is_super_admin()%' then
    raise exception 'GUARD: funnel_comerz perdió el corte de super admin';
  end if;

  if has_function_privilege('anon', 'public.funnel_comerz()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.funnel_comerz()', 'EXECUTE') then
    raise exception 'GUARD: permisos de funnel_comerz';
  end if;

  if has_function_privilege('authenticated', 'public.negocios_origen_alta_desde_usuario()', 'EXECUTE')
     or has_function_privilege('anon', 'public.codigos_referido_sin_slug()', 'EXECUTE') then
    raise exception 'GUARD: funciones de trigger abiertas a la API';
  end if;

  if has_column_privilege('anon', 'public.negocios', 'origen_alta', 'SELECT') then
    raise exception 'GUARD: anon no puede leer negocios.origen_alta';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.codigos_referido'::regclass)
     or has_table_privilege('anon', 'public.codigos_referido', 'SELECT') then
    raise exception 'GUARD: codigos_referido tiene que nacer cerrada';
  end if;

  -- Ningún negocio existente cambió: la columna nace vacía.
  if exists (select 1 from public.negocios where origen_alta is not null) then
    raise exception 'GUARD: origen_alta tiene que nacer vacía';
  end if;
end;
$$;
