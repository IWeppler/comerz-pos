-- Declarar la plata que una cuenta YA tenía cuando empezó a usarse en Comerz.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL CASO REAL QUE LO MOTIVA
--
-- La cuenta "Caja Grande" de El Nono Cacho tiene saldo **−$750.000**. Fui a
-- ver los movimientos: son **7, y los 7 son egresos. Ninguna entrada.** Son
-- sueldos del 19/9 — Ani $50.000, Eva $150.000, Claudia $150.000, Agu
-- $50.000, LULU $120.000, Debo $150.000 y una diferencia de $80.000. La dueña
-- usó esa caja para pagar y nunca declaró la plata que había adentro.
--
-- El negativo es correcto como registro y confuso como pantalla: dice
-- "Comerz cree que debo plata" cuando lo que falta es un dato de arranque.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO SE ESCONDE Y POR QUÉ NO ES UN INGRESO
--
-- No se corrige el pasado ni se tapa el negativo: se AGREGA un movimiento que
-- dice lo que había. `impacto_resultado = 0`, porque declarar plata que ya
-- estaba no es plata que el negocio ganó — si contara como resultado, la
-- ganancia del mes saltaría por un dato de inventario.
--
-- Es el mismo tipo de asiento de una sola pata que ya existe en este ledger
-- (`CIERRE_TURNO` saca la plata del cajón sin contrapartida declarada): el
-- modelo no tiene cuenta de patrimonio, y agregarla para esto sería construir
-- media contabilidad por un caso de arranque.
--
-- ─────────────────────────────────────────────────────────────────────────
-- TRES RESTRICCIONES, Y LAS TRES IMPORTAN
--
-- 1. **Nunca para una cuenta con arqueo.** En la caja diaria el saldo inicial
--    es el fondo del turno y ya tiene su camino (abrir caja). Dejar dos
--    formas de poner plata en el cajón rompe lo único de esta pantalla que
--    alguien firma.
-- 2. **Una sola vez por cuenta.** Es el punto de partida, no un ajuste
--    recurrente. Si después hay que mover plata, eso es una transferencia o
--    un egreso — operaciones que sí tienen contrapartida.
-- 3. **Solo ADMIN.** Es la única forma de hacer aparecer plata en el sistema
--    sin que venga de una venta.

begin;

alter table public.movimientos_financieros
  drop constraint movimientos_financieros_origen_tipo_check,
  add constraint movimientos_financieros_origen_tipo_check
    check (origen_tipo in (
      'VENTA_PAGO','EGRESO','TRANSFERENCIA','ACREDITACION','TURNO_CAJA','AJUSTE'
    ));

alter table public.movimientos_financieros
  drop constraint movimientos_financieros_evento_check,
  add constraint movimientos_financieros_evento_check
    check (evento in (
      'MIGRACION_ESTADO_INICIAL','REGISTRO','REGISTRO_ANULADO','ANULACION',
      'REACTIVACION','CORRECCION_REVERSA','CORRECCION_APLICADA',
      'CORRECCION_SIN_IMPACTO','ELIMINACION_REVERSA',
      'TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA',
      'ACREDITACION_SALIDA','ACREDITACION_ENTRADA',
      'APERTURA_TURNO','CIERRE_TURNO','AJUSTE_ARQUEO',
      'CORRECCION_HISTORICA','AJUSTE_SALDO_INICIAL'
    ));

create or replace function public.registrar_saldo_inicial_cuenta(
  p_cuenta_id uuid,
  p_monto numeric,
  p_detalle text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_cuenta  record;
  v_id      uuid := gen_random_uuid();
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;

  select c.id, c.nombre, c.requiere_arqueo, c.codigo, c.activa
    into v_cuenta
    from public.cuentas_financieras c
   where c.negocio_id = v_negocio
     and c.id = p_cuenta_id;

  if not found or not v_cuenta.activa then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;

  if v_cuenta.codigo = 'POR_ACREDITAR' then
    raise exception 'CUENTA_PUENTE_RESERVADA';
  end if;

  -- Ver el encabezado: en la caja diaria el saldo inicial es el fondo del
  -- turno.
  if v_cuenta.requiere_arqueo then
    raise exception 'CAJA_ARQUEADA_USA_FONDO_DE_TURNO';
  end if;

  if exists (
    select 1 from public.movimientos_financieros m
     where m.negocio_id = v_negocio
       and m.cuenta_financiera_id = p_cuenta_id
       and m.evento = 'AJUSTE_SALDO_INICIAL'
  ) then
    raise exception 'SALDO_INICIAL_YA_REGISTRADO';
  end if;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id,
    evento, importe, impacto_resultado, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values (
    v_id, v_negocio, p_cuenta_id, 'AJUSTE', p_cuenta_id,
    'AJUSTE_SALDO_INICIAL', p_monto, 0,
    coalesce(nullif(btrim(p_detalle), ''),
             'Saldo que la cuenta ya tenia al empezar a usarse'),
    jsonb_build_object('cuenta_nombre', v_cuenta.nombre),
    now(), auth.uid()
  );

  return v_id;
end;
$$;

revoke all on function public.registrar_saldo_inicial_cuenta(uuid, numeric, text)
  from public, anon;
grant execute on function public.registrar_saldo_inicial_cuenta(uuid, numeric, text)
  to authenticated;

comment on function public.registrar_saldo_inicial_cuenta(uuid, numeric, text) is
  'Declara la plata que una cuenta ya tenia. impacto_resultado 0: no es un ingreso. Una sola vez por cuenta, nunca para una cuenta con arqueo, solo ADMIN. Ver 20260921140000.';

-- ─────────────────────────────────────────────────────────────────────────
-- GUARD: las tres restricciones tienen que RECHAZAR de verdad.
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_cuerpo text;
begin
  select pg_get_functiondef(p.oid) into v_cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'registrar_saldo_inicial_cuenta';

  if v_cuerpo not like '%CAJA_ARQUEADA_USA_FONDO_DE_TURNO%' then
    raise exception 'GUARD: el saldo inicial dejo de excluir las cuentas con arqueo';
  end if;
  if v_cuerpo not like '%SALDO_INICIAL_YA_REGISTRADO%' then
    raise exception 'GUARD: el saldo inicial dejo de ser una sola vez por cuenta';
  end if;
  if v_cuerpo not like '%is_admin%' then
    raise exception 'GUARD: el saldo inicial dejo de pedir ADMIN';
  end if;
  -- Declarar plata que ya estaba NO es resultado del periodo.
  if v_cuerpo not like '%AJUSTE_SALDO_INICIAL%, p_monto, 0,%'
     and v_cuerpo not like '%p_monto, 0,%' then
    raise exception 'GUARD: el saldo inicial dejo de tener impacto_resultado 0';
  end if;
end;
$guard$;

commit;
