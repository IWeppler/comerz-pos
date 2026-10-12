-- Pagos en el checkout del catálogo, T1: modelo de datos.
-- Auditoría y decisiones: docs/pagos-auditoria.md (OK de Nacho del 12/10/2026).
--
-- Aditiva: tablas nuevas, columnas nuevas con default y dos orígenes nuevos de
-- `movimientos_stock`. Nada existente cambia de significado y nada lo lee
-- todavía: el módulo nace apagado (`negocios.pagos_online_habilitado = false`).
--
--  1. Flag por comercio: `negocios.pagos_online_habilitado`. Lo escribe solo el
--     super admin (la única policy de UPDATE de `negocios`). NO va por
--     `planes.reglas.features`: `tieneFeature` da true a un negocio sin plan.
--  2. Cobros en `configuracion_pos`: el alias de MERCADO PAGO de la tienda y su
--     titular, qué medios ofrece y en cuánto vence una orden impaga. La
--     transferencia del catálogo va SOLO a la cuenta de MP conectada (decisión
--     de Nacho, 12/10/2026): es lo único que se puede conciliar solo. No se
--     reusa `alias_transferencia`: la usa el resumen de CC y puede ser un banco.
--     Sin "% de descuento por transferencia": eso es una promoción
--     METODO_PAGO, que el servidor ya recalcula.
--     `metodos_pago.uso_tienda` marca los dos métodos que el sistema crea al
--     conectar MP (cobro por checkout y transferencia al CVU de MP): la venta
--     online cobra con ellos y el POS y el catálogo NO los ofrecen.
--  3. `ordenes_tienda` + `ordenes_tienda_items` + `ordenes_tienda_numeradores`:
--     la orden del catálogo. Solo se escribe por RPC (T4/T7); el panel la lee
--     con el permiso nuevo `tienda.ver_ordenes`.
--  4. `eventos_pago`: log crudo, append-only, idempotente por clave única.
--  5. `mercadopago_conexiones` y `mercadopago_oauth_estados`: sin policies y sin
--     GRANT, como `arca_credenciales`. Solo service_role. Los tokens van
--     cifrados en la app (AES-256-GCM, `MP_CLAVE_CIFRADO`).
--  6. Orígenes de stock ORDEN_TIENDA (la orden descuenta al nacer) y
--     ORDEN_TIENDA_LIBERADA (vuelve al vencer o cancelarse): en el CHECK y en
--     la lista del trigger, derivada del cuerpo VIVO.
--
-- Reversión: supabase/reversals/20261012133049_tienda_ordenes_y_pagos.sql

-- ─── 1. Flag ─────────────────────────────────────────────────────────────
alter table public.negocios
  add column pagos_online_habilitado boolean not null default false;
comment on column public.negocios.pagos_online_habilitado is
  'Módulo de pagos del catálogo (órdenes, transferencia, Mercado Pago). Opt-in, lo prende el super admin. No depende del plan.';

-- ─── 2. Configuración de cobros ──────────────────────────────────────────
alter table public.configuracion_pos
  add column alias_mercadopago_tienda text
    constraint configuracion_pos_alias_mercadopago_tienda_check check (
      alias_mercadopago_tienda is null
      or alias_mercadopago_tienda ~ '^[A-Za-z0-9.-]{6,20}$'
      or alias_mercadopago_tienda ~ '^[0-9]{22}$'),
  add column transferencia_titular text
    check (transferencia_titular is null or length(btrim(transferencia_titular)) between 2 and 80),
  add column cobro_online_transferencia boolean not null default false,
  add column cobro_online_mp boolean not null default false,
  add column minutos_vence_transferencia integer not null default 120
    check (minutos_vence_transferencia between 30 and 1440),
  add column minutos_vence_mp integer not null default 60
    check (minutos_vence_mp between 15 and 1440);
comment on column public.configuracion_pos.minutos_vence_transferencia is
  'Cuánto espera una orden por transferencia sin confirmar antes de vencer y devolver el stock. Default 2 h (decisión 12/10/2026).';
comment on column public.configuracion_pos.minutos_vence_mp is
  'Cuánto vive la preference de Mercado Pago (expiration_date_to) y la orden impaga.';
comment on column public.configuracion_pos.alias_mercadopago_tienda is
  'Alias o CVU de la cuenta de Mercado Pago CONECTADA, el único destino de la transferencia del catálogo. Distinto de alias_transferencia (resumen de CC), que puede ser un banco.';

alter table public.metodos_pago
  add column uso_tienda text check (uso_tienda in ('MP_CHECKOUT', 'TRANSFERENCIA_MP'));
comment on column public.metodos_pago.uso_tienda is
  'Método reservado para cobrar órdenes de la tienda online (lo crea el sistema al conectar Mercado Pago). Null = método común del POS. El POS y los botones del catálogo filtran los no null.';
create unique index metodos_pago_negocio_uso_tienda_uidx on public.metodos_pago (negocio_id, uso_tienda)
  where uso_tienda is not null;
-- El catálogo lee metodos_pago por columna: sin este GRANT, el filtro que lo
-- excluye de los botones daría 403 y se caería la tienda entera.
grant select (uso_tienda) on public.metodos_pago to anon;

-- ─── 3. Órdenes ──────────────────────────────────────────────────────────
create table public.ordenes_tienda (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id) on delete cascade,
  numero integer not null check (numero > 0),
  -- Lo que viaja en la URL pública (/orden/<token>). El id no se expone.
  token_publico text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  estado text not null default 'PENDIENTE_PAGO' check (estado in (
    'PENDIENTE_PAGO', 'EN_PROCESO', 'PAGADA', 'REVISAR', 'VENCIDA', 'CANCELADA',
    'REEMBOLSADA', 'CONTRACARGO', 'EN_DISPUTA', 'PAGADA_SIN_STOCK', 'ENTREGADA')),
  medio text not null check (medio in ('TRANSFERENCIA', 'MP_CHECKOUT', 'MP_CREDITO')),
  cliente_nombre text not null check (length(btrim(cliente_nombre)) between 1 and 120),
  cliente_telefono text not null check (cliente_telefono ~ '^[0-9]{8,15}$'),
  cliente_email text check (cliente_email is null or length(cliente_email) <= 254),
  modalidad_entrega text not null check (modalidad_entrega in ('RETIRO', 'ENVIO')),
  localidad text check (localidad is null or length(localidad) <= 120),
  direccion text check (direccion is null or length(direccion) <= 200),
  nota text check (nota is null or length(nota) <= 500),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  descuento numeric(14,2) not null default 0 check (descuento >= 0),
  recargo numeric(14,2) not null default 0 check (recargo >= 0),
  envio numeric(14,2) not null default 0 check (envio >= 0),
  total numeric(14,2) not null check (total > 0),
  -- Congelado al crear: la promo puede cambiar o borrarse después.
  promociones_aplicadas jsonb not null default '[]'::jsonb,
  mp_preference_id text,
  mp_payment_id text,
  vence_en timestamptz not null,
  pagada_en timestamptz,
  -- Idempotencia de la devolución de stock: se marca en el MISMO update que
  -- cambia el estado, y solo si estaba en null.
  stock_liberado_en timestamptz,
  venta_id uuid references public.ventas(id) on delete set null,
  -- Hash del IP para el tope de órdenes por origen (T4). Nunca el IP en claro.
  ip_hash text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (negocio_id, numero),
  constraint ordenes_tienda_total_cuadra check (total = subtotal - descuento + recargo + envio),
  constraint ordenes_tienda_envio_con_direccion check (
    modalidad_entrega = 'RETIRO' or (localidad is not null and direccion is not null))
);
comment on table public.ordenes_tienda is
  'Orden del catálogo público. Nace PENDIENTE_PAGO con el stock ya descontado (origen ORDEN_TIENDA). Se escribe solo por RPC; el estado de pago de MP lo decide el webhook, nunca el regreso de la clienta. Ver docs/pagos-auditoria.md.';
comment on column public.ordenes_tienda.venta_id is
  'La venta que registró la orden al pagarse: automática con el webhook de MP o al confirmar la transferencia (registrar_venta_orden_tienda). Null = todavía no pagada.';

create index ordenes_tienda_negocio_estado_idx on public.ordenes_tienda (negocio_id, estado, creado_en desc);
create index ordenes_tienda_negocio_vence_idx on public.ordenes_tienda (negocio_id, vence_en)
  where estado in ('PENDIENTE_PAGO', 'EN_PROCESO');
create index ordenes_tienda_negocio_venta_idx on public.ordenes_tienda (negocio_id, venta_id)
  where venta_id is not null;
create index ordenes_tienda_negocio_ip_idx on public.ordenes_tienda (negocio_id, ip_hash, creado_en desc);
create unique index ordenes_tienda_mp_payment_uidx on public.ordenes_tienda (mp_payment_id)
  where mp_payment_id is not null;

create table public.ordenes_tienda_items (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id) on delete cascade,
  orden_id uuid not null references public.ordenes_tienda(id) on delete cascade,
  -- Sin FK a producto ni variante: la orden es historia y sobrevive a un borrado.
  producto_id uuid not null,
  variante_id uuid not null,
  nombre text not null,
  variante text,
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0),
  cantidad numeric(14,3) not null check (cantidad > 0),
  subtotal numeric(14,2) not null check (subtotal >= 0)
);
create index ordenes_tienda_items_negocio_orden_idx on public.ordenes_tienda_items (negocio_id, orden_id);
create index ordenes_tienda_items_negocio_variante_idx on public.ordenes_tienda_items (negocio_id, variante_id);

-- "Orden #00123": serie propia por negocio. Un upsert con returning es atómico
-- bajo concurrencia; max()+1 no lo es.
create table public.ordenes_tienda_numeradores (
  negocio_id uuid primary key references public.negocios(id) on delete cascade,
  ultimo integer not null default 0 check (ultimo >= 0)
);

-- ─── 4. Log de pagos ─────────────────────────────────────────────────────
create table public.eventos_pago (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  -- Sin FK a la orden: el log sobrevive a lo que registra.
  orden_id uuid,
  origen text not null check (origen in ('MP_WEBHOOK', 'MANUAL', 'VENCIMIENTO', 'SISTEMA')),
  -- mp:<payment_id>:<status> · manual:<orden_id> · vence:<orden_id>.
  -- El mismo webhook cinco veces choca acá y no produce un segundo efecto.
  clave_idempotencia text not null unique check (length(clave_idempotencia) between 3 and 200),
  mp_payment_id text,
  estado_mp text,
  monto numeric(14,2),
  moneda text,
  -- Solo los campos que se usan; nunca datos de tarjeta ni tokens.
  payload jsonb not null default '{}'::jsonb,
  resultado text not null check (resultado in (
    'APLICADO', 'DUPLICADO', 'RECHAZADO_MONTO', 'RECHAZADO_COLLECTOR',
    'PAGO_DUPLICADO', 'IGNORADO', 'ERROR')),
  usuario_id uuid,
  creado_en timestamptz not null default now()
);
create index eventos_pago_negocio_orden_idx on public.eventos_pago (negocio_id, orden_id, creado_en desc);
create index eventos_pago_negocio_resultado_idx on public.eventos_pago (negocio_id, resultado, creado_en desc);

-- ─── 5. Mercado Pago: conexión y estados de OAuth ────────────────────────
create table public.mercadopago_conexiones (
  negocio_id uuid primary key references public.negocios(id) on delete cascade,
  mp_user_id text not null,
  -- Formato v1:<iv>:<tag>:<cifrado> (shared/lib/cifrado.ts). Nunca en claro.
  access_token_cifrado text not null check (access_token_cifrado like 'v1:%'),
  refresh_token_cifrado text not null check (refresh_token_cifrado like 'v1:%'),
  expira_en timestamptz not null,
  estado text not null default 'ACTIVA' check (estado in ('ACTIVA', 'REQUIERE_RECONEXION', 'DESCONECTADA')),
  ultimo_error text check (ultimo_error is null or length(ultimo_error) <= 500),
  conectado_en timestamptz not null default now(),
  conectado_por uuid,
  renovado_en timestamptz,
  actualizado_en timestamptz not null default now()
);
comment on table public.mercadopago_conexiones is
  'Una cuenta de Mercado Pago por negocio (OAuth). Sin policies ni GRANT: solo service_role, igual que arca_credenciales. El panel ve el estado por RPC, nunca los tokens.';
create index mercadopago_conexiones_mp_user_idx on public.mercadopago_conexiones (mp_user_id);

create table public.mercadopago_oauth_estados (
  -- sha256 del state: el valor crudo solo viaja en la URL.
  state_hash text primary key check (length(state_hash) = 64),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  usuario_id uuid not null,
  code_verifier_cifrado text not null check (code_verifier_cifrado like 'v1:%'),
  expira_en timestamptz not null,
  usado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index mercadopago_oauth_estados_negocio_idx on public.mercadopago_oauth_estados (negocio_id, creado_en desc);

-- ─── RLS y permisos de tabla ─────────────────────────────────────────────
alter table public.ordenes_tienda enable row level security;
alter table public.ordenes_tienda_items enable row level security;
alter table public.ordenes_tienda_numeradores enable row level security;
alter table public.eventos_pago enable row level security;
alter table public.mercadopago_conexiones enable row level security;
alter table public.mercadopago_oauth_estados enable row level security;

revoke all on public.ordenes_tienda, public.ordenes_tienda_items,
  public.ordenes_tienda_numeradores, public.eventos_pago,
  public.mercadopago_conexiones, public.mercadopago_oauth_estados
  from public, anon, authenticated;

-- El panel solo LEE; toda escritura es por RPC (T4, T5, T7).
grant select on public.ordenes_tienda, public.ordenes_tienda_items, public.eventos_pago
  to authenticated;

create policy aislamiento_negocio on public.ordenes_tienda as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
create policy ordenes_tienda_select on public.ordenes_tienda as permissive for select to authenticated
  using ((select public.tiene_permiso('tienda.ver_ordenes')));

create policy aislamiento_negocio on public.ordenes_tienda_items as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
create policy ordenes_tienda_items_select on public.ordenes_tienda_items as permissive for select to authenticated
  using (exists (select 1 from public.ordenes_tienda o where o.id = orden_id));

create policy aislamiento_negocio on public.eventos_pago as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
create policy eventos_pago_select on public.eventos_pago as permissive for select to authenticated
  using ((select public.tiene_permiso('tienda.ver_ordenes')));

-- numeradores, conexiones y estados de OAuth: RLS prendida y SIN policies.

-- ─── Permiso nuevo ───────────────────────────────────────────────────────
-- Las órdenes tienen nombre y teléfono de la clienta: no las ve cualquiera.
-- Se da a los roles que ya cobran (`ventas.cobrar`): nadie pierde nada y el
-- que confirma una transferencia es el que la tiene que ver.
insert into public.permisos (clave, modulo, descripcion) values
  ('tienda.ver_ordenes', 'tienda', 'Ver las órdenes del catálogo online y sus pagos')
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select distinct rp.rol_id, nuevo.id, rp.negocio_id
  from public.rol_permisos rp
  join public.permisos cobrar on cobrar.id = rp.permiso_id and cobrar.clave = 'ventas.cobrar'
  cross join (select id from public.permisos where clave = 'tienda.ver_ordenes') nuevo
union
select r.id, nuevo.id, r.negocio_id
  from public.roles r
  cross join (select id from public.permisos where clave = 'tienda.ver_ordenes') nuevo
 where r.nombre = 'ADMIN'
on conflict do nothing;

-- ─── 6. Orígenes de stock ────────────────────────────────────────────────
alter table public.movimientos_stock drop constraint movimientos_stock_origen_check;
alter table public.movimientos_stock add constraint movimientos_stock_origen_check
  check (origen = any (array['VENTA', 'ANULACION_VENTA', 'DEVOLUCION_PARCIAL', 'REVERSO_VENTA',
    'REMITO', 'CARGA_RAPIDA', 'IMPORTACION', 'EDICION_VARIANTES', 'BAJA', 'BAJA_PRODUCTO',
    'FOTO_INICIAL', 'DESCONOCIDO', 'ORDEN_TIENDA', 'ORDEN_TIENDA_LIBERADA']));

do $$
declare
  v_def text;
  v_buscar constant text := E'''BAJA'', ''BAJA_PRODUCTO'', ''DESCONOCIDO''\n  ) then';
  v_nuevo constant text := E'''BAJA'', ''BAJA_PRODUCTO'', ''DESCONOCIDO'',\n    ''ORDEN_TIENDA'', ''ORDEN_TIENDA_LIBERADA''\n  ) then';
  v_veces int;
begin
  v_def := pg_get_functiondef('public.registrar_movimiento_stock()'::regprocedure);
  v_veces := (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar);
  if v_veces <> 1 then
    raise exception 'REGISTRAR_MOVIMIENTO_STOCK_ANCLA: matchea % veces', v_veces;
  end if;
  execute replace(v_def, v_buscar, v_nuevo);

  v_def := pg_get_functiondef('public.registrar_movimiento_stock()'::regprocedure);
  if position('''ORDEN_TIENDA_LIBERADA''' in v_def) = 0
    or position('SECURITY DEFINER' in v_def) = 0
    or position('comerz.omitir_movimiento' in v_def) = 0
    or position('comerz.referencia_movimiento' in v_def) = 0 then
    raise exception 'REGISTRAR_MOVIMIENTO_STOCK_GUARD';
  end if;
end $$;

-- ─── Guards ──────────────────────────────────────────────────────────────
do $$
declare
  t text;
  v_admins int;
  v_admins_con int;
  v_cobran int;
  v_cobran_con int;
begin
  foreach t in array array['ordenes_tienda', 'ordenes_tienda_items', 'ordenes_tienda_numeradores',
                           'eventos_pago', 'mercadopago_conexiones', 'mercadopago_oauth_estados'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'PAGOS_GUARD_RLS: %', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,REFERENCES')
      or has_table_privilege('authenticated', 'public.' || t, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'PAGOS_GUARD_GRANT: %', t;
    end if;
  end loop;

  -- Lo que guarda tokens o el contador: ni lectura para authenticated.
  foreach t in array array['ordenes_tienda_numeradores', 'mercadopago_conexiones', 'mercadopago_oauth_estados'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'SELECT')
      or has_any_column_privilege('authenticated', 'public.' || t, 'SELECT')
      or exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'PAGOS_GUARD_TOKENS: %', t;
    end if;
  end loop;

  foreach t in array array['ordenes_tienda', 'ordenes_tienda_items', 'eventos_pago'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t
                    and policyname = 'aislamiento_negocio' and permissive = 'RESTRICTIVE'
                    and qual like '%current_negocio_id%') then
      raise exception 'PAGOS_GUARD_AISLAMIENTO: %', t;
    end if;
  end loop;

  -- El flag no lo puede leer anon (la tienda lo va a preguntar por RPC).
  if has_column_privilege('anon', 'public.negocios', 'pagos_online_habilitado', 'SELECT') then
    raise exception 'PAGOS_GUARD_FLAG_ANON';
  end if;
  if not has_column_privilege('anon', 'public.metodos_pago', 'uso_tienda', 'SELECT')
    or exists (select 1 from public.metodos_pago where uso_tienda is not null) then
    raise exception 'PAGOS_GUARD_USO_TIENDA';
  end if;
  if exists (select 1 from public.negocios where pagos_online_habilitado) then
    raise exception 'PAGOS_GUARD_FLAG_PRENDIDO';
  end if;
  -- Ningún medio online nace prendido.
  if exists (select 1 from public.configuracion_pos where cobro_online_transferencia or cobro_online_mp) then
    raise exception 'PAGOS_GUARD_MEDIOS_PRENDIDOS';
  end if;

  -- Todo rol que cobra, y todo ADMIN, ve las órdenes.
  select count(distinct rp.rol_id) into v_cobran
    from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
   where p.clave = 'ventas.cobrar';
  select count(distinct rp.rol_id) into v_cobran_con
    from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
   where p.clave = 'tienda.ver_ordenes'
     and rp.rol_id in (select rp2.rol_id from public.rol_permisos rp2
                        join public.permisos p2 on p2.id = rp2.permiso_id
                       where p2.clave = 'ventas.cobrar');
  select count(*) into v_admins from public.roles where nombre = 'ADMIN';
  select count(*) into v_admins_con
    from public.roles r
    join public.rol_permisos rp on rp.rol_id = r.id
    join public.permisos p on p.id = rp.permiso_id and p.clave = 'tienda.ver_ordenes'
   where r.nombre = 'ADMIN';
  if v_cobran <> v_cobran_con or v_admins <> v_admins_con then
    raise exception 'PAGOS_GUARD_PERMISO: cobran %/% admins %/%', v_cobran_con, v_cobran, v_admins_con, v_admins;
  end if;
end $$;
