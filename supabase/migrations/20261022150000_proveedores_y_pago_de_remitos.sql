-- Compra de mercadería, etapa 1 (docs/asistente-ia.md, C1): proveedores como
-- entidad, estado de pago del remito y remitos descartados.
--
-- Contexto (auditado el 22/10/2026): ningún gasto quedó nunca asociado a un
-- remito, y `ordenes_compra.proveedor` no guarda el proveedor sino el nombre
-- del ingreso ("INGRESO", "VERANO23", "Parte 5"). Evens considera pagados
-- todos sus remitos. De sus 27 remitos sin ingresar (julio a septiembre), 20
-- son subidas repetidas de remitos ya aprobados.
--
--   1. `proveedores`: nombre (único por negocio, sin distinguir mayúsculas),
--      teléfono, plazo de pago, activo. Sin DELETE: se da de baja con `activo`.
--   2. `ordenes_compra.proveedor_id`: FK compuesta (negocio_id, proveedor_id)
--      para que un remito no pueda apuntar al proveedor de otro negocio. El
--      texto `proveedor` queda como nombre del ingreso.
--   3. `ordenes_compra.pago_modo`: cómo se sigue el pago del remito aprobado.
--        EN_COMERZ             se paga con gastos COMPRA_MERCADERIA atados al
--                              remito; el saldo sale de esos gastos
--                              (`resumen_remitos_financiero`), no se guarda.
--        FUERA_DE_COMERZ       pagado sin salir de una caja de Comerz.
--        ANTERIOR_AL_REGISTRO  aprobado antes de esta migración: nada que pagar.
--        null                  remito aprobado sin respuesta todavía ("¿Lo
--                              pagaste?" pendiente) o remito no aprobado.
--      Solo lo escribe `definir_pago_remito` (SECURITY DEFINER): a
--      `authenticated` se le sacan INSERT/UPDATE de tabla y se le devuelven
--      por columna, sin las de pago. Declarar "pagado por fuera" esconde una
--      deuda; no puede ser un PATCH suelto.
--   4. Estado DESCARTADA: solo desde PENDIENTE, no vuelve atrás (trigger), no
--      mueve stock ni crea gastos, libera el hash de la planilla (un remito
--      descartado no protege nada contra una nueva subida). Como el trigger
--      corre también dentro de `aprobar_orden_compra`, un descartado no se
--      puede aprobar aunque el código viejo lo intente.
--   5. Carga inicial: todos los APROBADA -> ANTERIOR_AL_REGISTRO (sin gastos:
--      un gasto con fecha vieja descuadra cajas cerradas). Los PENDIENTE de
--      Evens (27) y Estilo Bonito (3), creados antes del 1/10 -> DESCARTADA.
--      Kiosco Demo queda como está.
--
-- Reversión: supabase/reversals/20261022150000_proveedores_y_pago_de_remitos.sql

begin;

-- ─── Precondiciones ────────────────────────────────────────────────────────
do $pre$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'proveedores') then
    raise exception 'proveedores ya existe: revisar antes de seguir';
  end if;
  if exists (select 1 from public.ordenes_compra
              where estado not in ('PENDIENTE', 'APROBADA')) then
    raise exception 'hay remitos con un estado desconocido: el CHECK los rechazaría';
  end if;
  if exists (select 1 from public.egresos where orden_compra_id is not null) then
    raise exception 'ya hay gastos asociados a remitos: la carga inicial supone que no';
  end if;
end
$pre$;

-- ─── 1. Proveedores ───────────────────────────────────────────────────────
create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id),
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  telefono text check (telefono is null or length(telefono) <= 40),
  plazo_pago_dias integer
    check (plazo_pago_dias is null or plazo_pago_dias between 0 and 365),
  notas text check (notas is null or length(notas) <= 1000),
  activo boolean not null default true,
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint proveedores_negocio_id_id_key unique (negocio_id, id)
);

create unique index proveedores_nombre_unico
  on public.proveedores (negocio_id, lower(btrim(nombre)));

alter table public.proveedores enable row level security;

create policy aislamiento_negocio on public.proveedores
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy proveedores_leer on public.proveedores
  as permissive for select to authenticated
  using (true);

create policy proveedores_insertar on public.proveedores
  as permissive for insert to authenticated
  with check ((select public.tiene_permiso('stock.ingresar_remito')));

create policy proveedores_editar on public.proveedores
  as permissive for update to authenticated
  using ((select public.tiene_permiso('stock.ingresar_remito')))
  with check ((select public.tiene_permiso('stock.ingresar_remito')));

revoke all on public.proveedores from public, anon, authenticated;
grant select on public.proveedores to authenticated;
grant insert (nombre, telefono, plazo_pago_dias, notas)
  on public.proveedores to authenticated;
grant update (nombre, telefono, plazo_pago_dias, notas, activo, actualizado_en)
  on public.proveedores to authenticated;

-- ─── 2 y 3. Columnas nuevas del remito ─────────────────────────────────────
alter table public.ordenes_compra
  add column proveedor_id uuid,
  add column pago_modo text,
  add column pago_definido_en timestamptz,
  add column pago_definido_por uuid,
  add column descartado_en timestamptz,
  add column descartado_por uuid;

alter table public.ordenes_compra
  add constraint ordenes_compra_proveedor_fkey
    foreign key (negocio_id, proveedor_id)
    references public.proveedores (negocio_id, id),
  add constraint ordenes_compra_estado_check
    check (estado in ('PENDIENTE', 'APROBADA', 'DESCARTADA')),
  add constraint ordenes_compra_pago_modo_check
    check (pago_modo in ('EN_COMERZ', 'FUERA_DE_COMERZ', 'ANTERIOR_AL_REGISTRO')),
  add constraint ordenes_compra_pago_solo_aprobada
    check (pago_modo is null or estado = 'APROBADA');

create index idx_ordenes_compra_negocio_proveedor
  on public.ordenes_compra (negocio_id, proveedor_id)
  where proveedor_id is not null;

-- Las columnas de pago y de descarte no se escriben por PostgREST.
revoke insert, update, truncate, references, trigger
  on public.ordenes_compra from authenticated;
grant insert (proveedor, fecha_remito, total_presupuestado, estado, hash_planilla, proveedor_id)
  on public.ordenes_compra to authenticated;
grant update (proveedor, fecha_remito, total_presupuestado, estado, hash_planilla, proveedor_id)
  on public.ordenes_compra to authenticated;

-- ─── 4. Estado DESCARTADA ──────────────────────────────────────────────────
create function public.validar_estado_remito()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.estado = 'DESCARTADA' and new.estado <> 'DESCARTADA' then
    raise exception 'REMITO_DESCARTADO: este remito se descartó y no se puede ingresar ni reabrir'
      using errcode = 'P0001';
  end if;

  if new.estado = 'DESCARTADA' and old.estado <> 'DESCARTADA' then
    if old.estado <> 'PENDIENTE' then
      raise exception 'REMITO_NO_DESCARTABLE: solo se descarta un remito que no ingresó (estado %)', old.estado
        using errcode = 'P0001';
    end if;
    new.hash_planilla := null;
    new.descartado_en := now();
    new.descartado_por := auth.uid();
  end if;

  return new;
end;
$$;

create trigger trg_validar_estado_remito
  before update of estado on public.ordenes_compra
  for each row execute function public.validar_estado_remito();

-- ─── 3. Declarar el pago ───────────────────────────────────────────────────
-- p_opcion es lo que eligió la persona al aprobar:
--   PAGAR_AHORA    -> EN_COMERZ (el gasto se carga después, aparte: si la caja
--                     está cerrada o no alcanza, el remito queda a pagar)
--   PAGAR_DESPUES  -> EN_COMERZ, exige proveedor (una deuda sin acreedor no sirve)
--   PAGADO_FUERA   -> FUERA_DE_COMERZ
create function public.definir_pago_remito(
  p_orden_id uuid,
  p_opcion text,
  p_proveedor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'security', 'pg_temp'
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_orden record;
  v_modo text;
  v_proveedor uuid;
  v_pagado numeric;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not (select public.tiene_permiso('stock.ingresar_remito')) then
    raise exception 'SIN_PERMISO: hace falta el permiso stock.ingresar_remito'
      using errcode = '42501';
  end if;
  if p_opcion is null or p_opcion not in ('PAGAR_AHORA', 'PAGAR_DESPUES', 'PAGADO_FUERA') then
    raise exception 'OPCION_PAGO_INVALIDA: %', p_opcion using errcode = 'P0001';
  end if;

  v_modo := case when p_opcion = 'PAGADO_FUERA' then 'FUERA_DE_COMERZ' else 'EN_COMERZ' end;

  select o.id, o.estado, o.pago_modo, o.proveedor_id
    into v_orden
    from public.ordenes_compra o
   where o.id = p_orden_id and o.negocio_id = v_negocio
   for update;

  if not found then
    raise exception 'REMITO_NO_ENCONTRADO' using errcode = 'P0001';
  end if;
  if v_orden.estado <> 'APROBADA' then
    raise exception 'REMITO_NO_APROBADO: el pago se declara sobre un remito ya ingresado'
      using errcode = 'P0001';
  end if;

  if p_proveedor_id is not null and not exists (
    select 1 from public.proveedores p
     where p.id = p_proveedor_id and p.negocio_id = v_negocio and p.activo
  ) then
    raise exception 'PROVEEDOR_INVALIDO' using errcode = 'P0001';
  end if;

  v_proveedor := coalesce(p_proveedor_id, v_orden.proveedor_id);

  if p_opcion = 'PAGAR_DESPUES' and v_proveedor is null then
    raise exception 'PROVEEDOR_REQUERIDO: para dejarlo a pagar hay que decir a qué proveedor'
      using errcode = 'P0001';
  end if;

  if v_orden.pago_modo is not null then
    if v_orden.pago_modo = v_modo
       and v_proveedor is not distinct from v_orden.proveedor_id then
      return jsonb_build_object('ya_definido', true, 'pago_modo', v_modo,
                                'proveedor_id', v_proveedor);
    end if;
    if v_orden.pago_modo = 'ANTERIOR_AL_REGISTRO' then
      raise exception 'REMITO_PAGO_ANTERIOR: el remito es anterior al registro de pagos'
        using errcode = 'P0001';
    end if;
    if v_orden.pago_modo <> v_modo then
      select coalesce(sum(e.monto), 0) into v_pagado
        from public.egresos e
       where e.orden_compra_id = p_orden_id
         and e.negocio_id = v_negocio
         and e.tipo = 'COMPRA_MERCADERIA';
      if v_pagado > 0 then
        raise exception 'REMITO_CON_PAGOS: ya tiene % pagado desde Comerz', v_pagado
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  update public.ordenes_compra
     set pago_modo = v_modo,
         proveedor_id = v_proveedor,
         pago_definido_en = now(),
         pago_definido_por = auth.uid()
   where id = p_orden_id and negocio_id = v_negocio;

  return jsonb_build_object('ya_definido', false, 'pago_modo', v_modo,
                            'proveedor_id', v_proveedor);
end;
$$;

revoke all on function public.definir_pago_remito(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.definir_pago_remito(uuid, text, uuid) to authenticated, service_role;

-- ─── 5. Carga inicial ──────────────────────────────────────────────────────
do $carga$
declare
  v_aprobadas int;
  v_filas int;
begin
  select count(*) into v_aprobadas from public.ordenes_compra where estado = 'APROBADA';

  update public.ordenes_compra
     set pago_modo = 'ANTERIOR_AL_REGISTRO', pago_definido_en = now()
   where estado = 'APROBADA' and pago_modo is null;
  get diagnostics v_filas = row_count;
  if v_filas <> v_aprobadas or v_filas < 152 then
    raise exception 'ANTERIOR_AL_REGISTRO: se esperaban % (>= 152), quedaron %', v_aprobadas, v_filas;
  end if;

  update public.ordenes_compra
     set estado = 'DESCARTADA'
   where estado = 'PENDIENTE'
     and creado_en < '2026-10-01'
     and negocio_id in ('44468525-8381-4c83-a558-eb7209e386b5',   -- Evens Indumentaria
                        '055a0286-a7ff-46f4-9910-ba4941140db6');  -- Estilo Bonito
  get diagnostics v_filas = row_count;
  if v_filas <> 30 then
    raise exception 'DESCARTADA: se esperaban 30 (27 Evens + 3 Estilo Bonito), quedaron %', v_filas;
  end if;
end
$carga$;

-- ─── Guards finales ────────────────────────────────────────────────────────
do $guard$
declare
  v int;
begin
  -- Proveedores: RLS, 4 policies, sin anon.
  if not (select relrowsecurity from pg_class where oid = 'public.proveedores'::regclass) then
    raise exception 'proveedores sin RLS';
  end if;
  select count(*) into v from pg_policies where schemaname = 'public' and tablename = 'proveedores';
  if v <> 4 then
    raise exception 'proveedores: se esperaban 4 policies, hay %', v;
  end if;
  if has_table_privilege('anon', 'public.proveedores', 'SELECT') then
    raise exception 'anon no debe leer proveedores';
  end if;
  if has_column_privilege('authenticated', 'public.proveedores', 'negocio_id', 'INSERT') then
    raise exception 'authenticated no debe elegir el negocio de un proveedor';
  end if;

  -- Remitos: las columnas de pago y descarte no se escriben por PostgREST; las
  -- que usa la app siguen escribibles.
  if has_column_privilege('authenticated', 'public.ordenes_compra', 'pago_modo', 'UPDATE')
     or has_column_privilege('authenticated', 'public.ordenes_compra', 'pago_modo', 'INSERT')
     or has_column_privilege('authenticated', 'public.ordenes_compra', 'descartado_en', 'UPDATE') then
    raise exception 'authenticated puede escribir columnas de pago o descarte';
  end if;
  if not (has_column_privilege('authenticated', 'public.ordenes_compra', 'estado', 'UPDATE')
          and has_column_privilege('authenticated', 'public.ordenes_compra', 'hash_planilla', 'UPDATE')
          and has_column_privilege('authenticated', 'public.ordenes_compra', 'proveedor', 'INSERT')
          and has_table_privilege('authenticated', 'public.ordenes_compra', 'SELECT')
          and has_table_privilege('authenticated', 'public.ordenes_compra', 'DELETE')) then
    raise exception 'authenticated perdió un permiso que usa la app sobre ordenes_compra';
  end if;

  -- Una sola firma de la RPC, SECURITY DEFINER, sin anon.
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'definir_pago_remito' and p.prosecdef;
  if v <> 1 then
    raise exception 'definir_pago_remito: se esperaba 1 función SECURITY DEFINER, hay %', v;
  end if;
  if has_function_privilege('anon', 'public.definir_pago_remito(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'anon no debe ejecutar definir_pago_remito';
  end if;

  -- Invariantes de la carga.
  if exists (select 1 from public.ordenes_compra where estado = 'APROBADA' and pago_modo is null) then
    raise exception 'quedó un remito aprobado sin pago_modo';
  end if;
  if exists (select 1 from public.ordenes_compra where estado = 'DESCARTADA' and hash_planilla is not null) then
    raise exception 'un remito descartado conserva el hash de la planilla';
  end if;
  select count(*) into v from public.ordenes_compra where estado = 'PENDIENTE';
  if v <> 2 then
    raise exception 'se esperaban 2 remitos pendientes (Kiosco Demo), hay %', v;
  end if;
  if exists (select 1 from public.egresos where orden_compra_id is not null) then
    raise exception 'la migración no debía crear gastos';
  end if;
end
$guard$;

commit;
