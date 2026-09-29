-- Módulo de presupuestos — etapa 2: cotizaciones.
--
-- Spec: AGENTS.md ("Módulo de presupuestos"). Una cotización es un carrito con
-- precio CONGELADO y fecha de vencimiento, que se le manda al cliente. No toca
-- stock, ni caja, ni factura: misma naturaleza que `pedidos`. Lo que la
-- diferencia de un pedido es que el precio es una PROMESA, así que:
--
--   * El precio lo pone la BASE, no el carrito. La RPC recibe producto,
--     variante y cantidad, y resuelve `coalesce(variante.precio,
--     producto.precio)`, la misma cascada que `precioBaseDeVariante` y que
--     `create-sale.ts`. Un precio que viaja desde el navegador es uno que se
--     elige con las DevTools abiertas. La única excepción es la venta libre,
--     igual que en la venta: no hay contra qué revalidarla, se valida la forma.
--
--   * Una cotización emitida NO se edita: una trigger deja cambiar solo el
--     estado. Si cambió algo, es una cotización nueva — igual que una factura.
--     Los renglones no tienen policy de UPDATE ni de DELETE.
--
--   * Las condiciones de financiación se CONGELAN en la cotización
--     (`tasas_financiacion`, `frecuencia`): mientras esté vigente, lo que se le
--     prometió al cliente no cambia porque el comercio toque la configuración.
--
-- Lo que NO hace todavía, y está en AGENTS.md:
--   * Listas de precios y promociones: la cotización sale a precio de lista
--     base. Con lista, el cliente vería un precio más alto que el que pagaría;
--     nunca uno más bajo.
--   * Presentaciones (el balde de 4,7 kg): se rechazan desde el server action.
--   * ACEPTADO: el estado existe en el CHECK, pero la trigger no deja llegar a
--     él. Lo abre la etapa 3, con la RPC que crea el plan.
--
-- Todo detrás de `modulo_presupuestos_habilitado()`: con el módulo apagado
-- (los 13 negocios hoy) no se puede crear nada, ni desde la consola.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. NUMERACIÓN
--
-- Mismo patrón que `siguiente_numero_comprobante`: un solo
-- `insert ... on conflict do update ... returning` serializa por row lock.
-- El número nunca sale de un `select max(numero) + 1`, que con dos
-- vendedoras cotizando a la vez daría el mismo número dos veces.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.presupuesto_numeracion (
  negocio_id uuid primary key default security.current_negocio_id()
    references public.negocios(id),
  ultimo_numero integer not null,
  actualizado_en timestamptz not null default now()
);

alter table public.presupuesto_numeracion enable row level security;

drop policy if exists aislamiento_negocio on public.presupuesto_numeracion;
create policy aislamiento_negocio on public.presupuesto_numeracion
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

drop policy if exists presupuesto_numeracion_quien_cotiza on public.presupuesto_numeracion;
create policy presupuesto_numeracion_quien_cotiza on public.presupuesto_numeracion
  for all to authenticated
  using ((select public.tiene_permiso('presupuestos.crear')))
  with check ((select public.tiene_permiso('presupuestos.crear')));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. COTIZACIONES
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.presupuestos (
  -- Lo genera el modal al abrirse: es la clave de idempotencia (doble click,
  -- reintento tras timeout), mismo criterio que `registrar_cobro_cc`.
  id uuid primary key,
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id),
  numero integer not null,
  estado text not null default 'VIGENTE',
  modalidad_entrega text not null,
  -- SET NULL y no CASCADE: borrar un cliente no puede borrar lo que se le
  -- cotizó. Por eso el nombre va congelado al lado.
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nombre text,
  cliente_telefono text,
  vendedor_id uuid not null default auth.uid() references public.perfiles(id),
  total numeric(14, 2) not null,
  tasas_financiacion jsonb not null default '[]'::jsonb,
  frecuencia text not null,
  vigencia_hasta date not null,
  nota text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  resuelto_en timestamptz,
  resuelto_por uuid references public.perfiles(id),
  constraint presupuestos_numero_unico unique (negocio_id, numero),
  constraint presupuestos_estado_check
    check (estado in ('VIGENTE', 'ACEPTADO', 'RECHAZADO', 'ANULADO')),
  constraint presupuestos_modalidad_check
    check (modalidad_entrega in ('AL_INICIO', 'AL_FINALIZAR')),
  constraint presupuestos_frecuencia_check
    check (frecuencia in ('SEMANAL', 'QUINCENAL', 'MENSUAL')),
  constraint presupuestos_total_check check (total > 0),
  constraint presupuestos_tasas_check check (jsonb_typeof(tasas_financiacion) = 'array'),
  constraint presupuestos_nota_check check (nota is null or char_length(nota) <= 500),
  constraint presupuestos_resuelto_check
    check ((estado = 'VIGENTE') = (resuelto_en is null))
);

comment on table public.presupuestos is
  'Cotizaciones: carrito con precio congelado y vencimiento. No toca stock ni caja. Inmutable salvo el estado (trigger presupuestos_solo_estado_editable). Ver AGENTS.md ("Módulo de presupuestos").';
comment on column public.presupuestos.estado is
  'VIGENTE | ACEPTADO | RECHAZADO | ANULADO. VENCIDO no se guarda: es VIGENTE con vigencia_hasta pasada (estadoVisiblePresupuesto en TS). RECHAZADO = el cliente dijo que no; ANULADO = error de carga.';
comment on column public.presupuestos.tasas_financiacion is
  'Copia de configuracion_pos.plan_tasas_financiacion al momento de cotizar. Es lo que se le prometió al cliente mientras la cotización esté vigente.';

create index if not exists presupuestos_negocio_creado_idx
  on public.presupuestos (negocio_id, creado_en desc);
create index if not exists presupuestos_negocio_estado_idx
  on public.presupuestos (negocio_id, estado);
create index if not exists presupuestos_cliente_idx
  on public.presupuestos (negocio_id, cliente_id) where cliente_id is not null;

alter table public.presupuestos enable row level security;

drop policy if exists aislamiento_negocio on public.presupuestos;
create policy aislamiento_negocio on public.presupuestos
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

drop policy if exists presupuestos_select on public.presupuestos;
create policy presupuestos_select on public.presupuestos
  for select to authenticated
  using ((select public.tiene_permiso('presupuestos.crear')));

-- El módulo apagado corta también acá, no solo en la RPC: con supabase-js en
-- el navegador, un INSERT directo es una llamada de consola.
drop policy if exists presupuestos_insert on public.presupuestos;
create policy presupuestos_insert on public.presupuestos
  for insert to authenticated
  with check (
    vendedor_id = auth.uid()
    and (select public.tiene_permiso('presupuestos.crear'))
    and (select public.modulo_presupuestos_habilitado())
  );

-- Cerrar (rechazar / anular) lo puede quien la hizo o un ADMIN. QUÉ se puede
-- cambiar lo decide la trigger de abajo, no esta policy.
drop policy if exists presupuestos_update on public.presupuestos;
create policy presupuestos_update on public.presupuestos
  for update to authenticated
  using (
    (select public.tiene_permiso('presupuestos.crear'))
    and (vendedor_id = auth.uid() or (select public.is_admin()))
  )
  with check (
    (select public.tiene_permiso('presupuestos.crear'))
    and (vendedor_id = auth.uid() or (select public.is_admin()))
  );

-- Sin policy de DELETE: una cotización que se mandó no se borra, se anula.

create or replace function public.presupuestos_solo_estado_editable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if row(new.id, new.negocio_id, new.numero, new.modalidad_entrega,
         new.cliente_id, new.cliente_nombre, new.cliente_telefono,
         new.vendedor_id, new.total, new.tasas_financiacion, new.frecuencia,
         new.vigencia_hasta, new.nota, new.creado_en)
     is distinct from
     row(old.id, old.negocio_id, old.numero, old.modalidad_entrega,
         old.cliente_id, old.cliente_nombre, old.cliente_telefono,
         old.vendedor_id, old.total, old.tasas_financiacion, old.frecuencia,
         old.vigencia_hasta, old.nota, old.creado_en)
  then
    -- Única excepción: el ON DELETE SET NULL de `cliente_id`. El nombre ya
    -- está congelado al lado, así que la cotización sigue diciendo lo mismo.
    if not (new.cliente_id is null and old.cliente_id is not null
            and row(new.id, new.negocio_id, new.numero, new.modalidad_entrega,
                    new.cliente_nombre, new.cliente_telefono, new.vendedor_id,
                    new.total, new.tasas_financiacion, new.frecuencia,
                    new.vigencia_hasta, new.nota, new.creado_en)
                is not distinct from
                row(old.id, old.negocio_id, old.numero, old.modalidad_entrega,
                    old.cliente_nombre, old.cliente_telefono, old.vendedor_id,
                    old.total, old.tasas_financiacion, old.frecuencia,
                    old.vigencia_hasta, old.nota, old.creado_en)
            and new.estado is not distinct from old.estado)
    then
      raise exception 'PRESUPUESTO_INMUTABLE'
        using hint = 'Una cotización emitida no se edita: se anula y se hace otra.';
    end if;
    return new;
  end if;

  if new.estado is distinct from old.estado then
    if old.estado <> 'VIGENTE' then
      raise exception 'PRESUPUESTO_YA_RESUELTO';
    end if;
    -- ACEPTADO lo abre la etapa 3 (la RPC que crea el plan).
    if new.estado not in ('RECHAZADO', 'ANULADO') then
      raise exception 'PRESUPUESTO_TRANSICION_INVALIDA';
    end if;
    new.resuelto_en := now();
    new.resuelto_por := auth.uid();
  end if;

  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_presupuestos_solo_estado_editable on public.presupuestos;
create trigger trg_presupuestos_solo_estado_editable
  before update on public.presupuestos
  for each row execute function public.presupuestos_solo_estado_editable();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RENGLONES
--
-- Tabla y no jsonb (a diferencia de `pedidos`): acá el precio es la promesa,
-- y la etapa 3 aparta stock por `variante_id`. Sin FK a producto ni variante,
-- igual que `ventas_items`: la cotización tiene que sobrevivir a que el
-- producto se borre, y por eso el nombre va congelado.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.presupuestos_items (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id),
  presupuesto_id uuid not null references public.presupuestos(id) on delete cascade,
  orden integer not null,
  producto_id uuid,
  variante_id uuid,
  es_venta_libre boolean not null default false,
  descripcion text not null,
  variante text,
  unidad_medida text not null default 'UNIDAD',
  cantidad numeric(12, 3) not null,
  precio_unitario numeric(14, 2) not null,
  constraint presupuestos_items_orden_unico unique (presupuesto_id, orden),
  constraint presupuestos_items_cantidad_check check (cantidad > 0),
  constraint presupuestos_items_precio_check check (precio_unitario > 0),
  -- Mismo CHECK que la venta libre de `ventas_items`: un renglón libre no
  -- apunta a ningún producto, y uno de catálogo apunta a producto Y variante.
  constraint presupuestos_items_libre_check check (
    (es_venta_libre and producto_id is null and variante_id is null)
    or (not es_venta_libre and producto_id is not null and variante_id is not null)
  )
);

comment on column public.presupuestos_items.precio_unitario is
  'Precio de UNA unidad, resuelto por la base al cotizar (variante.precio ?? producto.precio). El subtotal es precio_unitario * cantidad.';

create index if not exists presupuestos_items_presupuesto_idx
  on public.presupuestos_items (presupuesto_id);

alter table public.presupuestos_items enable row level security;

drop policy if exists aislamiento_negocio on public.presupuestos_items;
create policy aislamiento_negocio on public.presupuestos_items
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

-- Leer: si el padre es visible (su RLS ya decide).
drop policy if exists presupuestos_items_select on public.presupuestos_items;
create policy presupuestos_items_select on public.presupuestos_items
  for select to authenticated
  using (exists (select 1 from public.presupuestos p where p.id = presupuesto_id));

-- Escribir: SOLO en la misma transacción que creó el padre. `creado_en` es
-- `default now()`, y `now()` es la hora de inicio de la transacción, así que
-- `p.creado_en = now()` solo es cierto adentro de la RPC que la está creando.
-- Con "padre visible" a secas (la forma de las hijas de `ventas`), cualquiera
-- que ve una cotización le podría agregar renglones después desde la consola
-- y cambiarle el contenido a un papel que ya se mandó.
drop policy if exists presupuestos_items_insert on public.presupuestos_items;
create policy presupuestos_items_insert on public.presupuestos_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.presupuestos p
       where p.id = presupuesto_id
         and p.vendedor_id = auth.uid()
         and p.creado_en = now()
    )
  );

-- Sin UPDATE ni DELETE: inmutables. (El DELETE en cascada del padre no pasa
-- nunca, porque el padre tampoco tiene policy de DELETE.)

-- ─────────────────────────────────────────────────────────────────────────
-- 4. LA RPC
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.crear_presupuesto(
  p_id uuid,
  p_items jsonb,
  p_modalidad_entrega text,
  p_cliente_id uuid default null,
  p_cliente_nombre text default null,
  p_vigencia_dias integer default null,
  p_nota text default null
)
returns jsonb
language plpgsql
-- INVOKER a propósito: el aislamiento y el permiso los sigue decidiendo la
-- RLS de quien cotiza (mismo criterio que `registrar_venta`).
security invoker
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_existente public.presupuestos;
  v_config record;
  v_cliente record;
  v_cliente_nombre text;
  v_cliente_telefono text;
  v_vigencia integer;
  v_numero integer;
  v_item jsonb;
  v_orden integer := 0;
  v_total numeric(14, 2) := 0;
  v_prod record;
  v_cantidad numeric;
  v_precio numeric;
  v_descripcion text;
  v_filas jsonb := '[]'::jsonb;
  v_fila jsonb;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.modulo_presupuestos_habilitado() then
    raise exception 'MODULO_NO_HABILITADO';
  end if;
  if not public.tiene_permiso('presupuestos.crear') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'PRESUPUESTO_SIN_ID';
  end if;

  -- Idempotencia: el mismo id ya creado es un reintento, no un error.
  select * into v_existente from public.presupuestos
   where id = p_id and negocio_id = v_negocio;
  if found then
    return jsonb_build_object(
      'id', v_existente.id, 'numero', v_existente.numero,
      'total', v_existente.total, 'ya_registrado', true);
  end if;

  if p_modalidad_entrega is null
     or p_modalidad_entrega not in ('AL_INICIO', 'AL_FINALIZAR') then
    raise exception 'MODALIDAD_INVALIDA';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'PRESUPUESTO_SIN_RENGLONES';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'PRESUPUESTO_DEMASIADOS_RENGLONES';
  end if;

  select plan_tasas_financiacion, plan_frecuencia_default, presupuesto_vigencia_dias
    into v_config
    from public.configuracion_pos
   where negocio_id = v_negocio;
  if not found then
    raise exception 'SIN_CONFIGURACION';
  end if;

  v_vigencia := coalesce(p_vigencia_dias, v_config.presupuesto_vigencia_dias);
  if v_vigencia is null or v_vigencia < 1 or v_vigencia > 365 then
    raise exception 'VIGENCIA_INVALIDA';
  end if;

  -- El cliente: si viene id, el nombre sale de la base (congelado); si no,
  -- se acepta un nombre suelto — se le cotiza a quien entró al local.
  if p_cliente_id is not null then
    select nombre, telefono into v_cliente
      from public.clientes
     where id = p_cliente_id and negocio_id = v_negocio;
    if not found then
      raise exception 'CLIENTE_NO_ENCONTRADO';
    end if;
    v_cliente_nombre := v_cliente.nombre;
    v_cliente_telefono := v_cliente.telefono;
  else
    v_cliente_nombre := nullif(left(regexp_replace(btrim(coalesce(p_cliente_nombre, '')), '\s+', ' ', 'g'), 120), '');
  end if;

  -- Renglones: se resuelven TODOS antes de escribir nada, así el total va
  -- en el INSERT del padre y nunca hace falta un UPDATE (que la trigger
  -- rechazaría).
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_orden := v_orden + 1;

    if coalesce((v_item->>'venta_libre')::boolean, false) then
      -- Espejo de `validarVentaLibre` (features/pos/lib/venta-libre.ts).
      v_descripcion := regexp_replace(btrim(coalesce(v_item->>'descripcion', '')), '\s+', ' ', 'g');
      if v_descripcion = '' or char_length(v_descripcion) > 120 then
        raise exception 'VENTA_LIBRE_INVALIDA' using detail = v_orden::text;
      end if;
      begin
        v_precio := round((v_item->>'precio')::numeric, 2);
        v_cantidad := (v_item->>'cantidad')::numeric;
      exception when others then
        raise exception 'VENTA_LIBRE_INVALIDA' using detail = v_orden::text;
      end;
      if v_precio is null or v_precio <= 0 or v_precio > 99999999 then
        raise exception 'VENTA_LIBRE_INVALIDA' using detail = v_orden::text;
      end if;
      if v_cantidad is null or v_cantidad <= 0 or v_cantidad <> trunc(v_cantidad)
         or v_cantidad > 999999 then
        raise exception 'CANTIDAD_INVALIDA' using detail = v_descripcion;
      end if;

      v_fila := jsonb_build_object(
        'orden', v_orden, 'producto_id', null, 'variante_id', null,
        'es_venta_libre', true, 'descripcion', v_descripcion, 'variante', null,
        'unidad_medida', 'UNIDAD', 'cantidad', v_cantidad, 'precio_unitario', v_precio);
    else
      begin
        select p.id as producto_id, v.id as variante_id, p.nombre,
               v.nombre_display, coalesce(p.unidad_medida, 'UNIDAD') as unidad_medida,
               -- La cascada de `precioBaseDeVariante`: el de la variante si
               -- tiene uno propio, si no el del producto.
               coalesce(v.precio, p.precio) as precio
          into v_prod
          from public.productos p
          join public.producto_variantes v
            on v.producto_id = p.id and v.negocio_id = v_negocio
         where p.negocio_id = v_negocio
           and p.id = (v_item->>'producto_id')::uuid
           and v.id = (v_item->>'variante_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'PRODUCTO_NO_ENCONTRADO' using detail = v_orden::text;
      end;
      if not found then
        raise exception 'PRODUCTO_NO_ENCONTRADO' using detail = v_orden::text;
      end if;

      -- Un producto en $0 no es gratis: está sin cargar (mismo freno que la venta).
      if v_prod.precio is null or v_prod.precio <= 0 then
        raise exception 'SIN_PRECIO' using detail = v_prod.nombre;
      end if;

      begin
        v_cantidad := round((v_item->>'cantidad')::numeric, 3);
      exception when others then
        raise exception 'CANTIDAD_INVALIDA' using detail = v_prod.nombre;
      end;
      -- Espejo de `esFraccionable` (shared/lib/unidad-venta.ts).
      if v_cantidad is null or v_cantidad <= 0 or v_cantidad > 999999
         or (upper(v_prod.unidad_medida) not in ('KG', 'GRAMO', 'LITRO', 'METRO')
             and v_cantidad <> trunc(v_cantidad)) then
        raise exception 'CANTIDAD_INVALIDA' using detail = v_prod.nombre;
      end if;

      v_fila := jsonb_build_object(
        'orden', v_orden, 'producto_id', v_prod.producto_id,
        'variante_id', v_prod.variante_id, 'es_venta_libre', false,
        'descripcion', v_prod.nombre, 'variante', v_prod.nombre_display,
        'unidad_medida', upper(v_prod.unidad_medida), 'cantidad', v_cantidad,
        'precio_unitario', round(v_prod.precio, 2));
    end if;

    v_total := v_total + round((v_fila->>'precio_unitario')::numeric * (v_fila->>'cantidad')::numeric, 2);
    v_filas := v_filas || jsonb_build_array(v_fila);
  end loop;

  if v_total <= 0 then
    raise exception 'PRESUPUESTO_SIN_TOTAL';
  end if;

  insert into public.presupuesto_numeracion as n (negocio_id, ultimo_numero)
  values (v_negocio, 1)
  on conflict (negocio_id) do update
    set ultimo_numero = n.ultimo_numero + 1, actualizado_en = now()
  returning n.ultimo_numero into v_numero;

  insert into public.presupuestos (
    id, negocio_id, numero, modalidad_entrega, cliente_id, cliente_nombre,
    cliente_telefono, vendedor_id, total, tasas_financiacion, frecuencia,
    vigencia_hasta, nota
  ) values (
    p_id, v_negocio, v_numero, p_modalidad_entrega, p_cliente_id,
    v_cliente_nombre, v_cliente_telefono, auth.uid(), v_total,
    v_config.plan_tasas_financiacion, v_config.plan_frecuencia_default,
    -- El día comercial es el de Argentina, no el de UTC: cotizar a las 22 h
    -- no puede vencer un día antes.
    (now() at time zone 'America/Argentina/Buenos_Aires')::date + v_vigencia,
    nullif(left(btrim(coalesce(p_nota, '')), 500), '')
  );

  insert into public.presupuestos_items (
    negocio_id, presupuesto_id, orden, producto_id, variante_id, es_venta_libre,
    descripcion, variante, unidad_medida, cantidad, precio_unitario
  )
  select v_negocio, p_id, (f->>'orden')::int, (f->>'producto_id')::uuid,
         (f->>'variante_id')::uuid, (f->>'es_venta_libre')::boolean,
         f->>'descripcion', f->>'variante', f->>'unidad_medida',
         (f->>'cantidad')::numeric, (f->>'precio_unitario')::numeric
    from jsonb_array_elements(v_filas) f;

  return jsonb_build_object(
    'id', p_id, 'numero', v_numero, 'total', v_total, 'ya_registrado', false);
end;
$$;

comment on function public.crear_presupuesto(uuid, jsonb, text, uuid, text, integer, text) is
  'Crea una cotización. El precio lo resuelve la base (variante.precio ?? producto.precio); del cliente solo viajan producto, variante y cantidad. Idempotente por p_id. Exige el módulo prendido y presupuestos.crear.';

revoke all on function public.crear_presupuesto(uuid, jsonb, text, uuid, text, integer, text) from public, anon;
grant execute on function public.crear_presupuesto(uuid, jsonb, text, uuid, text, integer, text) to authenticated;

-- La trigger no necesita EXECUTE para nadie: la dispara la tabla.
revoke all on function public.presupuestos_solo_estado_editable() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  -- Toda tabla nueva con su aislamiento RESTRICTIVE.
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and tablename in ('presupuestos', 'presupuestos_items', 'presupuesto_numeracion')
         and policyname = 'aislamiento_negocio'
         and permissive = 'RESTRICTIVE') <> 3 then
    raise exception 'GUARD: falta el aislamiento RESTRICTIVE en alguna tabla';
  end if;

  -- Ninguna policy con la forma lenta (`20260816100000`).
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('presupuestos', 'presupuestos_items', 'presupuesto_numeracion')
       and (coalesce(qual, '') like '%same_negocio(%'
            or coalesce(with_check, '') like '%same_negocio(%')
  ) then
    raise exception 'GUARD: policy con same_negocio(columna)';
  end if;

  -- Inmutables: ni DELETE en el padre, ni UPDATE/DELETE en los renglones.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and ((tablename = 'presupuestos' and cmd in ('DELETE', 'ALL') and permissive = 'PERMISSIVE')
            or (tablename = 'presupuestos_items' and cmd in ('UPDATE', 'DELETE', 'ALL') and permissive = 'PERMISSIVE'))
  ) then
    raise exception 'GUARD: una cotización o sus renglones quedaron editables';
  end if;

  -- anon no ejecuta la RPC (Supabase le da EXECUTE por default privileges).
  if has_function_privilege('anon', 'public.crear_presupuesto(uuid, jsonb, text, uuid, text, integer, text)', 'execute') then
    raise exception 'GUARD: anon puede ejecutar crear_presupuesto';
  end if;

  -- La RPC resuelve el precio en la base: si alguien la reescribe leyendo un
  -- precio del payload, esto lo frena.
  if pg_get_functiondef('public.crear_presupuesto(uuid, jsonb, text, uuid, text, integer, text)'::regprocedure)
     not like '%coalesce(v.precio, p.precio)%' then
    raise exception 'GUARD: crear_presupuesto no resuelve el precio en la base';
  end if;
end $$;

commit;
