-- Categorías de gastos: `categorias_egreso` + `egresos.categoria_id`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ ES Y QUÉ NO ES
--
-- `egresos.tipo` (OPERATIVO | RETIRO_SOCIO | COMPRA_MERCADERIA | DEVOLUCION)
-- ya es un eje, y decide algo que mueve números: si resta de la ganancia. La
-- categoría es OTRO eje, descriptivo, DEBAJO de OPERATIVO: alquiler, sueldos,
-- servicios. No reemplaza al tipo ni lo toca — un CHECK impide categorizar lo
-- que no es gasto operativo, porque un retiro del dueño "categoría Sueldos" es
-- exactamente la confusión que el tipo existe para evitar, y una compra de
-- mercadería o una devolución ya dicen todo lo que hay que decir con el tipo.
--
-- La categoría es OPCIONAL, sin default. Un gasto sin categoría se muestra
-- como "Sin categoría", que es la verdad. Obligarla sería la decisión que se
-- guarda cuando nadie mira: la vendedora que registra "agua" con la fila en
-- el mostrador elige lo primero de la lista, y después el reporte por
-- categoría dice cualquier cosa con cara de dato. Los 59 gastos operativos
-- que ya existen quedan en null, no en "Otros": inventarles categoría es el
-- mismo error.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR NEGOCIO, CON SIEMBRA
--
-- Cada negocio tiene las suyas (una librería no gasta en lo mismo que una
-- tienda de ropa), pero nacen con un puñado genérico para que la primera vez
-- que alguien abre el selector haya algo que elegir y no un formulario de
-- alta. Los nombres son los conceptos que ya aparecen en los 84 egresos
-- operativos reales (agua, flete, super, bolsas, "pago semanal Eva") más los
-- fijos que todo comercio tiene. Se pueden renombrar, desactivar y agregar.
--
-- Desactivar, no borrar: el FK es ON DELETE SET NULL para que borrar una
-- categoría nunca borre un gasto ni lo deje huérfano con error, pero la UI
-- desactiva (`activa = false`) y el historial conserva el nombre.
--
-- ─────────────────────────────────────────────────────────────────────────
-- RECATEGORIZAR ES UNA CORRECCIÓN QUE NO MUEVE PLATA
--
-- `egresos` no tenía policy de UPDATE: ningún camino de la app lo editaba. Se
-- abre UNA rendija: cambiar `categoria_id` (y el `concepto`, que es el otro
-- texto descriptivo). Un trigger rechaza cualquier UPDATE que toque monto,
-- tipo, cuenta, turno o remito — eso es plata, y plata se anula y se vuelve a
-- registrar (RPC `anular_egreso`, que viene aparte). Quién puede: quien lo
-- registró con `caja.registrar_egreso`, o un ADMIN.
--
-- La bitácora financiera NO se entera de una recategorización, a propósito:
-- `registrar_bitacora_egreso` compara monto/tipo/cuenta/turno/remito/concepto
-- y la categoría no está en la lista. El ledger dice qué plata se movió; la
-- categoría se lee VIVA desde `egresos` en cada consulta, así que
-- recategorizar un gasto de julio mueve el gasto de julio de columna, que es
-- lo que se espera de una etiqueta.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LA TABLA
-- ─────────────────────────────────────────────────────────────────────────

create table public.categorias_egreso (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null default security.current_negocio_id()
              references public.negocios(id) on delete cascade,
  nombre      text not null,
  orden       integer not null default 100,
  activa      boolean not null default true,
  es_sistema  boolean not null default false,
  creado_por  uuid,
  creado_en   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint categorias_egreso_nombre_no_vacio
    check (length(btrim(nombre)) > 0),
  constraint categorias_egreso_nombre_corto
    check (length(nombre) <= 60)
);

-- Sin duplicados por mayúsculas: "Sueldos" y "sueldos" son la misma.
create unique index categorias_egreso_negocio_nombre_key
  on public.categorias_egreso (negocio_id, lower(btrim(nombre)));
create index categorias_egreso_negocio_orden_idx
  on public.categorias_egreso (negocio_id, activa, orden, nombre);

comment on table public.categorias_egreso is
  'Categorías de gastos por negocio. Eje DESCRIPTIVO debajo de egresos.tipo = OPERATIVO; no decide nada de plata. Opcional en el egreso, sin default.';

create trigger trg_categorias_egreso_updated_at
  before update on public.categorias_egreso
  for each row execute function public.marcar_updated_at();

alter table public.categorias_egreso enable row level security;

create policy aislamiento_negocio on public.categorias_egreso
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

-- Leer: cualquiera del negocio (el selector del egreso lo necesita).
create policy categorias_egreso_select on public.categorias_egreso
  for select to authenticated
  using (true);

-- Crear: quien registra gastos, para poder darla de alta desde el mismo
-- selector (mismo patrón que la cuenta destino del método de pago).
create policy categorias_egreso_insert on public.categorias_egreso
  for insert to authenticated
  with check ((select public.tiene_permiso('caja.registrar_egreso')));

-- Renombrar, ordenar, desactivar, borrar: ADMIN.
create policy categorias_egreso_update on public.categorias_egreso
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy categorias_egreso_delete on public.categorias_egreso
  for delete to authenticated
  using ((select public.is_admin()));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. LA COLUMNA
-- ─────────────────────────────────────────────────────────────────────────

alter table public.egresos
  add column categoria_id uuid
    references public.categorias_egreso(id) on delete set null;

alter table public.egresos
  add constraint egresos_categoria_solo_operativo
  check (categoria_id is null or tipo = 'OPERATIVO');

create index egresos_negocio_categoria_idx
  on public.egresos (negocio_id, categoria_id)
  where categoria_id is not null;

comment on column public.egresos.categoria_id is
  'Categoría descriptiva del gasto. Solo para tipo OPERATIVO (CHECK). Null = sin categoría, que es un valor válido y no un pendiente.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. SIEMBRA POR NEGOCIO
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.sembrar_categorias_egreso(p_negocio_id uuid)
returns void
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  if p_negocio_id is null
     or not exists (select 1 from public.negocios where id = p_negocio_id) then
    raise exception 'NEGOCIO_INEXISTENTE';
  end if;

  insert into public.categorias_egreso (negocio_id, nombre, orden, es_sistema)
  values
    (p_negocio_id, 'Alquiler',              10, true),
    (p_negocio_id, 'Sueldos',               20, true),
    (p_negocio_id, 'Servicios',             30, true),
    (p_negocio_id, 'Impuestos',             40, true),
    (p_negocio_id, 'Insumos y librería',    50, true),
    (p_negocio_id, 'Fletes y envíos',       60, true),
    (p_negocio_id, 'Mantenimiento',         70, true),
    (p_negocio_id, 'Comida y refrigerio',   80, true),
    (p_negocio_id, 'Publicidad',            90, true),
    (p_negocio_id, 'Otros',                100, true)
  on conflict do nothing;
end;
$$;

revoke all on function public.sembrar_categorias_egreso(uuid) from public;

select public.sembrar_categorias_egreso(id) from public.negocios;

create or replace function public.sembrar_categorias_egreso_nuevo_negocio()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  perform public.sembrar_categorias_egreso(new.id);
  return new;
end;
$$;

revoke all on function public.sembrar_categorias_egreso_nuevo_negocio() from public;

create trigger trg_negocios_sembrar_categorias_egreso
  after insert on public.negocios
  for each row execute function public.sembrar_categorias_egreso_nuevo_negocio();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. LA RENDIJA: RECATEGORIZAR
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.egresos_solo_descriptivo_editable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if row(old.negocio_id, old.monto, old.tipo, old.cuenta_origen_id,
         old.turno_caja_id, old.orden_compra_id, old.fecha, old.creado_por)
     is distinct from
     row(new.negocio_id, new.monto, new.tipo, new.cuenta_origen_id,
         new.turno_caja_id, new.orden_compra_id, new.fecha, new.creado_por) then
    raise exception 'EGRESO_SOLO_CATEGORIA_Y_CONCEPTO_EDITABLES'
      using hint = 'Para corregir monto, tipo o cuenta, anulá el gasto y registralo de nuevo.';
  end if;
  return new;
end;
$$;

create trigger trg_egresos_solo_descriptivo_editable
  before update on public.egresos
  for each row execute function public.egresos_solo_descriptivo_editable();

create policy egresos_update_descriptivo on public.egresos
  for update to authenticated
  using (
    (select public.is_admin())
    or (creado_por = auth.uid()
        and (select public.tiene_permiso('caja.registrar_egreso')))
  )
  with check (
    (select public.is_admin())
    or (creado_por = auth.uid()
        and (select public.tiene_permiso('caja.registrar_egreso')))
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 5. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_sin int;
begin
  select count(*) into v_sin
    from public.negocios n
   where not exists (select 1 from public.categorias_egreso c where c.negocio_id = n.id);
  if v_sin > 0 then
    raise exception 'GUARD: % negocios sin categorías sembradas', v_sin;
  end if;

  -- Ningún egreso quedó categorizado por accidente.
  if exists (select 1 from public.egresos where categoria_id is not null) then
    raise exception 'GUARD: el backfill no debía asignar categorías';
  end if;

  -- La rendija rechaza tocar plata (probado sobre una fila real; la excepción
  -- revierte el UPDATE). En una base vacía no hay fila y no se prueba.
  if exists (select 1 from public.egresos) then
    begin
      update public.egresos set monto = monto + 1
       where id = (select id from public.egresos limit 1);
      raise exception 'GUARD: el trigger dejó cambiar el monto de un egreso';
    exception
      when raise_exception then
        if sqlerrm not like 'EGRESO_SOLO_CATEGORIA%' then raise; end if;
    end;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'egresos'
       and policyname = 'egresos_update_descriptivo'
  ) then
    raise exception 'GUARD: falta la policy de UPDATE de egresos';
  end if;
end
$guard$;

commit;
