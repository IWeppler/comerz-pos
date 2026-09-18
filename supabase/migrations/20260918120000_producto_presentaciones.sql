-- ---------------------------------------------------------------------------
-- Presentaciones comerciales: UN stock, varias formas de venderlo.
--
-- QUÉ RESUELVE. "Crema por kg" y "Crema balde 4,7 kg" son la misma
-- mercadería, y hasta acá la única forma de tenerlas en el sistema era como
-- dos productos o dos variantes — o sea, DOS stocks que describen una sola
-- pila. Vender el balde no bajaba los kilos, el remito entraba a uno solo y el
-- quiebre se descubría en el mostrador. Y la planilla ya lo fabricaba sola:
-- `peso` y `presentacion` son columnas de VARIANTE en columnas-por-rubro.ts.
--
-- EL MODELO. El stock sigue viviendo en `producto_variantes.stock`, en la
-- unidad de `productos.unidad_medida`, y esta tabla NO tiene stock: una
-- presentación dice cuántas unidades de ESE stock consume una venta
-- (`factor`) y a qué precio se vende. "Disponibles" de una presentación es
-- `floor(stock / factor)`, derivado en lectura, nunca guardado.
--
-- La unidad base NO es una fila: es la presentación implícita con factor 1,
-- que todo producto tiene. Así "Kg" de la crema no se duplica ni se puede
-- borrar, y los 3.095 productos actuales no necesitan una sola fila para
-- seguir vendiéndose igual. Cero filas = cero cambio, mismo criterio que
-- `listas_precios` (20260908150000).
--
-- DÓNDE CUELGA. Del PRODUCTO, con `variante_id` opcional:
--   * el factor se define contra `productos.unidad_medida`, que es del
--     producto; "Pack x10" de globos vale para los 8 colores, y una fila por
--     color son 8 copias que se desincronizan igual que el precio copiado
--     (1.252 copias medidas el 8/9);
--   * pero el EAN de un pack es de (color, pack), y una presentación puede
--     existir para una sola variante. `variante_id` puesto = solo esa;
--     null = todas las del producto. Al resolver, gana la específica.
--
-- EL PRECIO NO SALE DEL FACTOR. Un balde de 4,7 kg a $12.000/kg no vale
-- $56.400: vale lo que el comercio decida ($45.000). Por eso `regla_precio`:
--   FIJO     → `precio` es el de la presentación, punto.
--   HEREDADO → precio base efectivo de la variante × factor. Explícito, para
--              los packs "sin descuento" y para que un cambio de precio base
--              (remito, ajuste masivo) los re-precie solos.
-- Derivarlo por default sería el mismo error que copiar el precio a las
-- variantes "por las dudas": un número que nadie fijó.
--
-- QUÉ NO TOCA. `ajustar_stock_variante(s)`, el trigger de `movimientos_stock`,
-- `idx_variante_identidad`, `guardar_variantes_producto`, `anular_venta`,
-- `registrar_devolucion`: todos siguen en unidad base. La conversión
-- (`cantidad_base`) pasa ANTES de llamarlos, y el resultado es un delta como
-- cualquier otro.
--
-- `ventas_items` gana columnas para saber QUÉ se vendió (presentación, factor
-- congelado, cantidad en presentaciones, precio cobrado por presentación),
-- pero `cantidad` sigue siendo UNIDAD BASE: es lo que hace que ventas.cantidad,
-- margen_realizado, curva_de_precio, quiebres, exportaciones y devoluciones no
-- cambien una línea. Todas nullable o con default, así `registrar_venta` (que
-- todavía no las escribe) sigue válida tal cual está.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------

create table if not exists public.producto_presentaciones (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null default security.current_negocio_id(),
  producto_id   uuid not null references public.productos(id) on delete cascade,
  -- null = aplica a todas las variantes del producto. Cascade: una
  -- presentación atada a una variante muere con ella; el historial no la
  -- necesita porque ventas_items congela nombre y factor.
  variante_id   uuid null references public.producto_variantes(id) on delete cascade,

  nombre        text not null,
  -- Cuántas unidades de STOCK (productos.unidad_medida) consume UNA
  -- presentación. numeric(12,3), misma resolución que el stock.
  factor        numeric(12,3) not null,

  regla_precio  text not null default 'FIJO'
                check (regla_precio in ('FIJO', 'HEREDADO')),
  precio        numeric null,
  -- Costo por presentación, opcional. null = costo base de la variante ×
  -- factor. Se guarda porque el remito lo trae así ("3 baldes a $30.000").
  costo         numeric null,
  -- EAN/código propio de la presentación. Coexiste con producto_variantes.sku;
  -- al escanear gana la presentación (ver uq_producto_presentaciones_sku).
  sku           text null,

  -- La que el POS elige al tocar el producto. Como mucho una por
  -- (producto, variante-o-null) entre las activas.
  es_default    boolean not null default false,
  visible_catalogo boolean not null default true,
  activa        boolean not null default true,
  orden         smallint not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint producto_presentaciones_nombre_no_vacio
    check (length(trim(nombre)) > 0),
  constraint producto_presentaciones_factor_positivo
    check (factor > 0),
  -- Un precio FIJO en cero no es gratis: está sin cargar. Mismo freno que
  -- producto_precios.
  constraint producto_presentaciones_precio_fijo
    check (regla_precio <> 'FIJO' or (precio is not null and precio > 0)),
  constraint producto_presentaciones_costo_no_negativo
    check (costo is null or costo >= 0)
);

create index if not exists idx_producto_presentaciones_negocio_producto
  on public.producto_presentaciones (negocio_id, producto_id);

-- El nombre identifica la presentación dentro de su alcance.
create unique index if not exists uq_producto_presentaciones_nombre
  on public.producto_presentaciones (
    producto_id,
    coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(nombre))
  );

-- Una sola default activa por alcance.
create unique index if not exists uq_producto_presentaciones_default
  on public.producto_presentaciones (
    producto_id,
    coalesce(variante_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where es_default and activa;

-- Un código escaneado tiene que resolver a UNA presentación del negocio.
create unique index if not exists uq_producto_presentaciones_sku
  on public.producto_presentaciones (negocio_id, sku)
  where sku is not null and sku <> '';

comment on table public.producto_presentaciones is
  'Formas comerciales de vender el stock de un producto (Balde 4,7 kg, Pack x10). NO tiene stock: consume producto_variantes.stock según factor. La unidad base es la presentación implícita con factor 1 y no es una fila. variante_id null = aplica a todas las variantes. Ver 20260918120000.';
comment on column public.producto_presentaciones.factor is
  'Unidades de stock (productos.unidad_medida) que consume UNA presentación. Entero cuando la unidad no es fraccionable (trigger). NO deriva el precio.';
comment on column public.producto_presentaciones.regla_precio is
  'FIJO: se cobra `precio`. HEREDADO: precio base efectivo de la variante × factor, explícito y recalculado en cada venta. CHECK fail-closed.';
comment on column public.producto_presentaciones.es_default is
  'La que el POS elige al tocar el producto. Como mucho una activa por (producto, variante-o-null); sin default se vende la unidad base.';


-- ---------------------------------------------------------------------------
-- 2. RLS. Escritura con el mismo permiso que editar el producto: una
--    presentación es parte de la ficha, no configuración del comercio. anon NO
--    lee nada todavía: el catálogo público entra en otra fase y con GRANT por
--    columna (costo nunca).
-- ---------------------------------------------------------------------------

alter table public.producto_presentaciones enable row level security;

create policy aislamiento_negocio on public.producto_presentaciones
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy producto_presentaciones_select on public.producto_presentaciones
  for select to authenticated using (true);

create policy producto_presentaciones_insert on public.producto_presentaciones
  for insert to authenticated
  with check ((select public.tiene_permiso('stock.editar_producto')));

create policy producto_presentaciones_update on public.producto_presentaciones
  for update to authenticated
  using ((select public.tiene_permiso('stock.editar_producto')))
  with check ((select public.tiene_permiso('stock.editar_producto')));

create policy producto_presentaciones_delete on public.producto_presentaciones
  for delete to authenticated
  using ((select public.tiene_permiso('stock.editar_producto')));

create trigger trg_producto_presentaciones_updated_at
  before update on public.producto_presentaciones
  for each row execute function public.marcar_updated_at();


-- ---------------------------------------------------------------------------
-- 3. Integridad que cruza tablas (no entra en un CHECK)
--
-- a) Producto y variante tienen que ser del mismo negocio y la variante del
--    mismo producto. Con RLS por negocio el primero ya está; el segundo no.
-- b) Factor entero cuando la unidad de stock no admite fracción: "pack x2,5
--    globos" no existe. Espejo de esFraccionable() en shared/lib/unidad-venta.ts:
--    los dos tienen que decir lo mismo.
-- c) Cualquier cambio toca productos.updated_at, para que el delta del
--    catálogo (catalogo-delta.ts) lo traiga: ese sync pregunta por
--    productos.updated_at y producto_variantes.updated_at, y esta tabla no es
--    ninguna de las dos.
-- ---------------------------------------------------------------------------

create or replace function public.producto_presentaciones_validar()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_unidad text;
begin
  select p.unidad_medida into v_unidad
    from public.productos p
   where p.id = new.producto_id;

  if v_unidad is null then
    raise exception 'PRESENTACION_PRODUCTO_INEXISTENTE';
  end if;

  if new.variante_id is not null and not exists (
    select 1 from public.producto_variantes v
     where v.id = new.variante_id and v.producto_id = new.producto_id
  ) then
    raise exception 'PRESENTACION_VARIANTE_DE_OTRO_PRODUCTO';
  end if;

  -- Mismo conjunto que UNIDADES_FRACCIONABLES en unidad-venta.ts.
  if v_unidad not in ('KG', 'GRAMO', 'LITRO', 'METRO')
     and new.factor <> trunc(new.factor) then
    raise exception 'PRESENTACION_FACTOR_ENTERO'
      using detail = format('unidad %s, factor %s', v_unidad, new.factor);
  end if;

  return new;
end;
$$;

create trigger trg_producto_presentaciones_validar
  before insert or update on public.producto_presentaciones
  for each row execute function public.producto_presentaciones_validar();

create or replace function public.producto_presentaciones_tocar_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.productos
     set updated_at = now()
   where id = coalesce(new.producto_id, old.producto_id);
  return null;
end;
$$;

comment on function public.producto_presentaciones_tocar_producto() is
  'AFTER INSERT/UPDATE/DELETE en producto_presentaciones: bumpea productos.updated_at para que catalogo-delta.ts traiga el producto. DEFINER porque el que edita presentaciones ya pudo con el producto (mismo permiso), y el UPDATE solo toca updated_at de la fila padre.';

create trigger trg_producto_presentaciones_tocar_producto
  after insert or update or delete on public.producto_presentaciones
  for each row execute function public.producto_presentaciones_tocar_producto();


-- ---------------------------------------------------------------------------
-- 4. La conversión, en un solo lugar del lado SQL. Espejo de cantidadBase()
--    en shared/lib/unidad-venta.ts.
-- ---------------------------------------------------------------------------

create or replace function public.cantidad_base(p_cantidad numeric, p_factor numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(coalesce(p_cantidad, 0) * coalesce(p_factor, 1), 3);
$$;

comment on function public.cantidad_base(numeric, numeric) is
  'cantidad_stock = cantidad_presentacion × factor, redondeada a la resolución del stock (3 decimales). Es la ÚNICA cuenta que convierte presentaciones a unidad base del lado SQL.';


-- ---------------------------------------------------------------------------
-- 5. Historia: qué se vendió. `cantidad` sigue en unidad base.
-- ---------------------------------------------------------------------------

alter table public.ventas_items
  add column if not exists presentacion_id        uuid null,
  add column if not exists presentacion_nombre    text null,
  add column if not exists factor                 numeric(12,3) not null default 1,
  add column if not exists cantidad_presentacion  numeric(12,3) null,
  add column if not exists precio_presentacion    numeric(12,2) null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ventas_items'::regclass
       and conname = 'ventas_items_factor_positivo'
  ) then
    alter table public.ventas_items
      add constraint ventas_items_factor_positivo check (factor > 0);
  end if;

  -- Con presentación, la cantidad en presentaciones es obligatoria y la
  -- base tiene que ser su conversión. Sin presentación no hay cantidad en
  -- presentaciones (factor 1, cantidad = base).
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ventas_items'::regclass
       and conname = 'ventas_items_presentacion_coherente'
  ) then
    alter table public.ventas_items
      add constraint ventas_items_presentacion_coherente check (
        (presentacion_id is null and cantidad_presentacion is null and factor = 1)
        or
        (presentacion_id is not null
          and cantidad_presentacion is not null
          and cantidad_presentacion > 0
          and cantidad = public.cantidad_base(cantidad_presentacion, factor))
      );
  end if;

  -- Un aparato con IMEI es una unidad, no un pack.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ventas_items'::regclass
       and conname = 'ventas_items_serie_sin_presentacion'
  ) then
    alter table public.ventas_items
      add constraint ventas_items_serie_sin_presentacion check (
        unidad_serie_id is null or presentacion_id is null
      );
  end if;
end $$;

comment on column public.ventas_items.cantidad is
  'UNIDAD BASE (productos.unidad_medida), siempre. Con presentación es cantidad_presentacion × factor. Es la columna que leen reportes, devoluciones y anulaciones.';
comment on column public.ventas_items.presentacion_id is
  'Presentación vendida, sin FK (el historial sobrevive a que se borre). null = unidad base.';
comment on column public.ventas_items.factor is
  'Factor CONGELADO al vender. Si el balde pasa de 4,7 a 5 kg, esta venta sigue diciendo 4,7. 1 sin presentación.';
comment on column public.ventas_items.cantidad_presentacion is
  'Cuántas presentaciones se vendieron (entero). null sin presentación.';
comment on column public.ventas_items.precio_presentacion is
  'Lo cobrado por UNA presentación, exacto. precio_unitario/precio_final siguen siendo por unidad base (derivados: precio_presentacion / factor).';


-- ---------------------------------------------------------------------------
-- 6. Guard: la migración falla si se aplicó sobre un schema donde el stock no
--    es numeric — ahí un factor 4,7 truncaría en silencio.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'producto_variantes'
       and column_name = 'stock' and data_type = 'numeric'
  ) then
    raise exception 'GUARD: producto_variantes.stock no es numeric; ver 20260819175959';
  end if;
end $$;
