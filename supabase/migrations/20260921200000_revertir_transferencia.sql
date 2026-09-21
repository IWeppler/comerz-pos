-- Transferencias reversibles: `revierte_a` + RPC `revertir_transferencia_financiera`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA FORMA: UNA TRANSFERENCIA COMPENSATORIA, NUNCA UN DELETE
--
-- `transferencias_financieras` es inmutable por trigger
-- (`trg_transferencias_inmutables`) y la bitácora es append-only. Revertir
-- una transferencia es registrar OTRA en sentido contrario, por el mismo
-- monto, que declara a cuál revierte (`revierte_a`). Las dos quedan; el
-- ledger muestra el pase de ida y el de vuelta; el saldo de cada cuenta
-- vuelve a donde estaba. Es lo que hace un banco.
--
-- Reglas, cada una con guard:
--   * Una transferencia se revierte UNA vez (índice único sobre `revierte_a`).
--   * Una reversa no se revierte (si te arrepentiste de la reversa, hacé la
--     transferencia de nuevo: es una operación nueva, no un doble negativo).
--   * Si alguna de las dos cuentas es arqueada, la reversa necesita un turno
--     ABIERTO de esa cuenta, igual que la transferencia original. La plata
--     vuelve al cajón que está abierto AHORA, no al turno de ayer que ya se
--     firmó — mismo criterio que `20260921130000`.
--   * Permiso: `caja.anular_movimiento` (solo ADMIN hoy). Revertir es hacer
--     desaparecer un movimiento ya registrado; no es lo mismo que transferir.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ SE PARTE LA RPC EN `_impl` + WRAPPER
--
-- La reversa tiene que nacer con `revierte_a` puesto, porque después no se
-- puede tocar (inmutable). Y toda la lógica de validar cuentas, turno, puente
-- y escribir las dos patas ya vive en `registrar_transferencia_financiera`.
-- Duplicarla es tener dos versiones que se desincronizan; el patrón del repo
-- es el de `aprobar_orden_compra`: la lógica pasa a `_impl` con un parámetro
-- más, y las dos RPCs públicas la llaman. El wrapper de registrar queda
-- idéntico hacia afuera (misma firma, mismo permiso `caja.transferir`).
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LA COLUMNA
-- ─────────────────────────────────────────────────────────────────────────

alter table public.transferencias_financieras
  add column revierte_a uuid
    references public.transferencias_financieras(id) on delete restrict;

create unique index transferencias_financieras_revierte_a_key
  on public.transferencias_financieras (revierte_a)
  where revierte_a is not null;

comment on column public.transferencias_financieras.revierte_a is
  'Si esta transferencia es la reversa de otra, la original. Única por original; una reversa no se revierte.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. LA LÓGICA, UNA SOLA VEZ
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_transferencia_financiera_impl(
  p_cuenta_origen_id uuid,
  p_cuenta_destino_id uuid,
  p_monto numeric,
  p_concepto text,
  p_turno_caja_id uuid,
  p_revierte_a uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_transferencia uuid;
  v_operacion uuid := gen_random_uuid();
  v_origen public.cuentas_financieras;
  v_destino public.cuentas_financieras;
  v_turno public.turnos_caja;
  v_turno_origen uuid;
  v_turno_destino uuid;
  v_datos jsonb;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if p_monto is null or p_monto <= 0
     or nullif(btrim(p_concepto), '') is null
     or p_cuenta_origen_id is null or p_cuenta_destino_id is null
     or p_cuenta_origen_id = p_cuenta_destino_id then
    raise exception 'TRANSFERENCIA_INVALIDA';
  end if;

  select * into v_origen from public.cuentas_financieras
   where negocio_id = v_negocio and id = p_cuenta_origen_id and activa
   for update;
  select * into v_destino from public.cuentas_financieras
   where negocio_id = v_negocio and id = p_cuenta_destino_id and activa
   for update;
  if v_origen.id is null or v_destino.id is null then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;
  if v_origen.tipo = 'PUENTE_ACREDITACION' or v_destino.tipo = 'PUENTE_ACREDITACION' then
    raise exception 'CUENTA_PUENTE_RESERVADA';
  end if;

  if v_origen.requiere_arqueo or v_destino.requiere_arqueo then
    if p_turno_caja_id is null then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
    select * into v_turno from public.turnos_caja
     where negocio_id = v_negocio and id = p_turno_caja_id and estado = 'ABIERTO'
     for update;
    if v_turno.id is null
       or (v_turno.cuenta_financiera_id <> p_cuenta_origen_id
           and v_turno.cuenta_financiera_id <> p_cuenta_destino_id) then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
    if v_turno.cuenta_financiera_id = p_cuenta_origen_id then
      v_turno_origen := v_turno.id;
    end if;
    if v_turno.cuenta_financiera_id = p_cuenta_destino_id then
      v_turno_destino := v_turno.id;
    end if;
  end if;

  insert into public.transferencias_financieras (
    negocio_id, cuenta_origen_id, cuenta_destino_id, monto, concepto,
    registrado_por, revierte_a
  ) values (
    v_negocio, p_cuenta_origen_id, p_cuenta_destino_id, p_monto, btrim(p_concepto),
    auth.uid(), p_revierte_a
  ) returning id into v_transferencia;

  v_datos := jsonb_build_object(
    'cuenta_origen_id', p_cuenta_origen_id,
    'cuenta_destino_id', p_cuenta_destino_id
  ) || case when p_revierte_a is null then '{}'::jsonb
            else jsonb_build_object('revierte_a', p_revierte_a) end;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id,
    evento, importe, impacto_resultado, turno_caja_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values
  (
    v_operacion, v_negocio, p_cuenta_origen_id, 'TRANSFERENCIA', v_transferencia,
    'REGISTRO', -p_monto, 0, v_turno_origen,
    format('Transferencia a %s: %s', v_destino.nombre, btrim(p_concepto)),
    v_datos, now(), auth.uid()
  ),
  (
    v_operacion, v_negocio, p_cuenta_destino_id, 'TRANSFERENCIA', v_transferencia,
    'REGISTRO', p_monto, 0, v_turno_destino,
    format('Transferencia desde %s: %s', v_origen.nombre, btrim(p_concepto)),
    v_datos, now(), auth.uid()
  );

  return v_transferencia;
end;
$$;

-- Interna: solo la llaman las dos RPCs públicas, que son las que chequean el
-- permiso. OJO: Supabase tiene DEFAULT PRIVILEGES que le dan EXECUTE a anon y
-- authenticated sobre toda función nueva de public, así que revocar de PUBLIC
-- solo no alcanza — hay que nombrarlos. El guard de abajo lo verifica.
revoke all on function public.registrar_transferencia_financiera_impl(
  uuid, uuid, numeric, text, uuid, uuid
) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. LAS DOS PUERTAS
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_transferencia_financiera(
  p_cuenta_origen_id uuid,
  p_cuenta_destino_id uuid,
  p_monto numeric,
  p_concepto text,
  p_turno_caja_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  if security.current_negocio_id() is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.transferir') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return public.registrar_transferencia_financiera_impl(
    p_cuenta_origen_id, p_cuenta_destino_id, p_monto, p_concepto, p_turno_caja_id, null
  );
end;
$$;

create or replace function public.revertir_transferencia_financiera(
  p_transferencia_id uuid,
  p_motivo text,
  p_turno_caja_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_original public.transferencias_financieras;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.anular_movimiento') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO';
  end if;

  -- Row lock: dos reversas simultáneas de la misma transferencia se
  -- serializan acá, y la segunda cae en YA_REVERTIDA (además del unique).
  select * into v_original
    from public.transferencias_financieras
   where id = p_transferencia_id and negocio_id = v_negocio
   for update;
  if v_original.id is null then
    raise exception 'TRANSFERENCIA_NO_ENCONTRADA';
  end if;
  if v_original.revierte_a is not null then
    raise exception 'ES_UNA_REVERSA'
      using hint = 'Una reversa no se revierte: registrá la transferencia de nuevo.';
  end if;
  if exists (
    select 1 from public.transferencias_financieras
     where revierte_a = v_original.id
  ) then
    raise exception 'TRANSFERENCIA_YA_REVERTIDA';
  end if;

  return public.registrar_transferencia_financiera_impl(
    v_original.cuenta_destino_id,
    v_original.cuenta_origen_id,
    v_original.monto,
    format('Reversa de "%s": %s', v_original.concepto, btrim(p_motivo)),
    p_turno_caja_id,
    v_original.id
  );
end;
$$;

revoke all on function public.revertir_transferencia_financiera(uuid, text, uuid) from public;
grant execute on function public.revertir_transferencia_financiera(uuid, text, uuid) to authenticated;

comment on function public.revertir_transferencia_financiera(uuid, text, uuid) is
  'Registra la transferencia compensatoria (destino → origen, mismo monto) con revierte_a apuntando a la original. Una vez por original; una reversa no se revierte. Permiso caja.anular_movimiento.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
begin
  if pg_get_functiondef('public.registrar_transferencia_financiera_impl(uuid,uuid,numeric,text,uuid,uuid)'::regprocedure)
     not like '%CUENTA_PUENTE_RESERVADA%' then
    raise exception 'GUARD: el impl perdió el freno de la cuenta puente';
  end if;
  if pg_get_functiondef('public.registrar_transferencia_financiera(uuid,uuid,numeric,text,uuid)'::regprocedure)
     not like '%caja.transferir%' then
    raise exception 'GUARD: registrar dejó de pedir caja.transferir';
  end if;
  if pg_get_functiondef('public.revertir_transferencia_financiera(uuid,text,uuid)'::regprocedure)
     not like '%caja.anular_movimiento%' then
    raise exception 'GUARD: revertir no pide caja.anular_movimiento';
  end if;
  -- El impl no es invocable por cualquiera.
  if has_function_privilege('authenticated',
       'public.registrar_transferencia_financiera_impl(uuid,uuid,numeric,text,uuid,uuid)', 'execute') then
    raise exception 'GUARD: el impl quedó ejecutable por authenticated';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'transferencias_financieras_revierte_a_key'
  ) then
    raise exception 'GUARD: falta el único de revierte_a';
  end if;
end
$guard$;

commit;
