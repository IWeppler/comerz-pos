-- Anular un gasto: RPC `anular_egreso`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ SE BORRA LA FILA (Y POR QUÉ ESO NO PIERDE NADA)
--
-- Hay dos formas de anular un egreso: marcarlo (`estado = 'ANULADO'`) o
-- borrarlo. Marcarlo suena más prolijo y es la opción PELIGROSA acá:
-- `egresos` la suman DIRECTO, sin ninguna columna de estado, el arqueo del
-- turno (`flujo_caja_turno`, `calcular_egresos_turno`), el historial
-- (`efectivo_actual_turnos`), el resumen gerencial, el panel
-- (`get-dashboard-metrics`), las exportaciones al contador y el saldo de
-- remitos (`resumen_remitos_financiero`). Siete consumidores que tendrían que
-- aprender a filtrar, y el que se olvide sigue contando un gasto que no
-- existe. Es exactamente la forma de bug que `movimientos_stock` eligió el
-- trigger para evitar: un camino que se olvida de registrar.
--
-- Borrarlo hace que los siete dejen de contarlo sin tocar ninguno. Y NO
-- pierde el registro: `registrar_bitacora_egreso` ya modela el DELETE con
-- `ELIMINACION_REVERSA`, guardando el snapshot completo del egreso en
-- `datos.anterior`. La bitácora es append-only: el gasto anulado sigue ahí,
-- con quién lo anuló, cuándo y por qué. Lo que desaparece es el gasto de las
-- CUENTAS, que es lo que "anular" quiere decir.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LAS REGLAS
--
--   * Permiso `caja.anular_movimiento` (solo ADMIN hoy).
--   * Motivo obligatorio. Viaja al trigger por `comerz.motivo_anulacion`
--     (transaction-local, `is_local => true`, mismo mecanismo que
--     `comerz.origen_movimiento` en stock) porque el DELETE no tiene forma
--     de llevar un argumento.
--   * Si la cuenta es ARQUEADA, el turno del egreso tiene que estar ABIERTO.
--     Un turno cerrado ya se contó y se firmó; sacarle un gasto le cambia el
--     esperado a un arqueo que alguien dio por bueno. Es la misma regla que
--     `20260921130000` para registrar, en espejo. Para la caja general o una
--     cuenta digital no hay turno que respetar.
--   * NO se anula un egreso de tipo DEVOLUCION: ese lo escribió una anulación
--     o devolución de VENTA, y "la plata no se le devolvió a la clienta" es
--     una corrección de la venta, no del gasto. Hacerlo acá dejaría la venta
--     anulada con su reintegro desaparecido y ningún rastro en el ticket.
--
-- La reversa en el ledger se fecha en el EGRESO, no en `now()`: es la misma
-- regla de `20260921180000` para las correcciones. Un gasto de julio que se
-- anula en septiembre nunca fue gasto de julio. `registrado_en` dice cuándo
-- se anuló.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LA BITÁCORA LEE EL MOTIVO Y FECHA EN EL EGRESO
--
-- Solo cambia la rama DELETE del cuerpo de `20260921180000`.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_bitacora_egreso()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  op uuid := gen_random_uuid();
  cambio boolean;
  v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      op, new.negocio_id, new.cuenta_origen_id, 'EGRESO', new.id, 'REGISTRO',
      -new.monto, public.egreso_impacto_resultado(new.tipo, new.monto),
      new.turno_caja_id, new.orden_compra_id, new.concepto,
      public.snapshot_financiero_egreso(new), new.fecha,
      coalesce(auth.uid(), new.creado_por)
    );
    return new;

  elsif tg_op = 'DELETE' then
    v_motivo := nullif(btrim(current_setting('comerz.motivo_anulacion', true)), '');
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      op, old.negocio_id, old.cuenta_origen_id, 'EGRESO', old.id, 'ELIMINACION_REVERSA',
      old.monto, -public.egreso_impacto_resultado(old.tipo, old.monto),
      old.turno_caja_id, old.orden_compra_id,
      case when v_motivo is null then old.concepto
           else format('%s — anulado: %s', old.concepto, v_motivo) end,
      jsonb_build_object('anterior', public.snapshot_financiero_egreso(old),
                         'motivo', v_motivo,
                         'anulado_en', now()),
      old.fecha, auth.uid()
    );
    return old;
  end if;

  cambio := row(old.negocio_id, old.cuenta_origen_id, old.monto, old.tipo,
                old.concepto, old.turno_caja_id, old.orden_compra_id)
            is distinct from
            row(new.negocio_id, new.cuenta_origen_id, new.monto, new.tipo,
                new.concepto, new.turno_caja_id, new.orden_compra_id);
  if not cambio then
    return new;
  end if;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values
  (
    op, old.negocio_id, old.cuenta_origen_id, 'EGRESO', old.id, 'CORRECCION_REVERSA',
    old.monto, -public.egreso_impacto_resultado(old.tipo, old.monto),
    old.turno_caja_id, old.orden_compra_id, old.concepto,
    jsonb_build_object('anterior', public.snapshot_financiero_egreso(old),
                       'nuevo', public.snapshot_financiero_egreso(new)),
    new.fecha, auth.uid()
  ),
  (
    op, new.negocio_id, new.cuenta_origen_id, 'EGRESO', new.id, 'CORRECCION_APLICADA',
    -new.monto, public.egreso_impacto_resultado(new.tipo, new.monto),
    new.turno_caja_id, new.orden_compra_id, new.concepto,
    jsonb_build_object('anterior', public.snapshot_financiero_egreso(old),
                       'nuevo', public.snapshot_financiero_egreso(new)),
    new.fecha, auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.registrar_bitacora_egreso() from public;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. LA RPC
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.anular_egreso(
  p_egreso_id uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_egreso public.egresos;
  v_cuenta public.cuentas_financieras;
  v_turno public.turnos_caja;
  v_filas int;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.anular_movimiento') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO';
  end if;

  -- DEFINER: cada consulta filtra negocio_id a mano.
  select * into v_egreso
    from public.egresos
   where id = p_egreso_id and negocio_id = v_negocio
   for update;
  if v_egreso.id is null then
    raise exception 'EGRESO_NO_ENCONTRADO';
  end if;

  if v_egreso.tipo = 'DEVOLUCION' then
    raise exception 'EGRESO_ES_REINTEGRO_DE_VENTA'
      using hint = 'Ese reintegro lo generó una anulación o devolución de venta; se corrige desde la venta.';
  end if;

  select * into v_cuenta
    from public.cuentas_financieras
   where id = v_egreso.cuenta_origen_id and negocio_id = v_negocio;

  if coalesce(v_cuenta.requiere_arqueo, false) then
    if v_egreso.turno_caja_id is null then
      raise exception 'EGRESO_DE_CAJA_SIN_TURNO';
    end if;
    select * into v_turno
      from public.turnos_caja
     where id = v_egreso.turno_caja_id and negocio_id = v_negocio
       for update;
    if v_turno.id is null or v_turno.estado <> 'ABIERTO' then
      raise exception 'TURNO_CERRADO'
        using hint = 'El turno de ese gasto ya se cerró y se firmó. Registrá un ingreso de corrección en el turno abierto.';
    end if;
  end if;

  perform set_config('comerz.motivo_anulacion', btrim(p_motivo), true);

  delete from public.egresos
   where id = v_egreso.id and negocio_id = v_negocio;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'EGRESO_NO_ANULADO';
  end if;

  return jsonb_build_object(
    'egreso_id', v_egreso.id,
    'monto', v_egreso.monto,
    'tipo', v_egreso.tipo,
    'cuenta_origen_id', v_egreso.cuenta_origen_id,
    'turno_caja_id', v_egreso.turno_caja_id
  );
end;
$$;

revoke all on function public.anular_egreso(uuid, text) from public;
grant execute on function public.anular_egreso(uuid, text) to authenticated;

comment on function public.anular_egreso(uuid, text) is
  'Borra el egreso; la bitácora conserva el snapshot (ELIMINACION_REVERSA, fechada en el egreso, con motivo). Exige turno abierto si la cuenta es arqueada. No anula reintegros de venta (tipo DEVOLUCION). Permiso caja.anular_movimiento.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_def text := pg_get_functiondef('public.anular_egreso(uuid,text)'::regprocedure);
  v_negocio int := (
    select count(*) from regexp_matches(v_def, 'negocio_id = v_negocio', 'g')
  );
begin
  if v_def not like '%caja.anular_movimiento%' then
    raise exception 'GUARD: anular_egreso no pide caja.anular_movimiento';
  end if;
  -- DEFINER: las cuatro consultas (egreso, cuenta, turno, delete) filtran negocio.
  if v_negocio < 4 then
    raise exception 'GUARD: anular_egreso tiene % filtros de negocio, se esperaban 4', v_negocio;
  end if;
  if v_def not like '%DEVOLUCION%' then
    raise exception 'GUARD: anular_egreso dejó anular reintegros de venta';
  end if;
  if pg_get_functiondef('public.registrar_bitacora_egreso()'::regprocedure)
     not like '%comerz.motivo_anulacion%' then
    raise exception 'GUARD: la bitácora no lee el motivo de anulación';
  end if;
end
$guard$;

commit;
