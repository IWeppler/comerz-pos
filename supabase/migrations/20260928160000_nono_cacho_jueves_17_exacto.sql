-- El Nono Cacho: el jueves 17 reimputa exactamente el sobrante.
--
-- 20260928140000 pasó a la Caja Grande Ramiro (102.000) y Dipa (100.000),
-- 202.000 contra un sobrante de 182.452: el turno quedó en −19.548. Decidido
-- con la dueña (Ignacio, 28/9/2026): de Ramiro, 82.452 salieron de la Caja
-- Grande y 19.548 de la caja chica. El turno queda en 0.
--
-- En consecuencia el saldo inicial de la Caja Grande (20260928150000), que era
-- "lo justo para esos pagos", baja de 202.000 a 182.452. La Caja Grande no
-- cambia de saldo: sale 19.548 menos y había 19.548 menos.
--
-- Todo es reversa + re-emisión; nada se borra. Se apagan dentro de la
-- transacción tres frenos que protegen a los turnos CERRADOS (el turno del
-- jueves lo está), con guard de que quedan activos.

begin;

alter table public.turnos_caja disable trigger trg_bloquear_edicion_turno_cerrado;
alter table public.egresos disable trigger trg_egresos_solo_descriptivo_editable;
alter table public.egresos disable trigger trg_egresos_validar_turno;

do $jueves$
declare
  v_neg    constant uuid := '106f0b93-9211-47f9-945f-4691d634f6f3';
  v_motivo constant text :=
    'Jueves 17 exacto (auditoría 28/9/2026): de Ramiro, 82.452 con Caja Grande y 19.548 con la caja chica';
  v_ramiro constant uuid := '443a99b9-d243-407a-9e23-b2e468569c7b';
  v_parte_caja constant integer := 19548;

  v_caja uuid;
  v_cg   uuid;
  v_turno record;
  v_egr  record;
  v_si   record;
  v_neto numeric;
  v_cg_antes numeric;
  v_caja_antes numeric;
  v_res_antes numeric;
  v_gastos_antes numeric;
  v_op uuid;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260928160000: El Nono Cacho no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_caja from public.cuentas_financieras where negocio_id = v_neg and codigo = 'CAJA_DIARIA';
  select id into v_cg   from public.cuentas_financieras where negocio_id = v_neg and tipo = 'CAJA_GENERAL';

  select * into v_turno from public.turnos_caja
   where negocio_id = v_neg and estado = 'CERRADO' and cuenta_financiera_id = v_caja
     and fecha_apertura >= '2026-09-17 16:30:00-03' and fecha_apertura < '2026-09-17 16:31:00-03';
  select * into v_egr from public.egresos
   where negocio_id = v_neg and id = v_ramiro and cuenta_origen_id = v_cg and monto = 102000
     and turno_caja_id is null;
  select * into v_si from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg and evento = 'AJUSTE_SALDO_INICIAL'
     and importe = 202000;
  if v_turno.id is null or v_egr.id is null or v_si.id is null then
    raise exception 'GUARD: el jueves 17 no está como lo dejaron 20260928140000/150000';
  end if;
  if v_turno.diferencia <> -19548 then
    raise exception 'GUARD: el turno del jueves tiene diferencia % (se esperaba −19.548)', v_turno.diferencia;
  end if;

  select coalesce(sum(importe), 0) into v_cg_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg;
  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(impacto_resultado), 0) into v_res_antes from public.movimientos_financieros
   where negocio_id = v_neg;
  select coalesce(sum(monto), 0) into v_gastos_antes from public.egresos where negocio_id = v_neg;

  -- 1. Reversa del faltante del turno (primero: deja en el turno la plata que
  --    después sale por la parte de Ramiro, así el freno de saldo no salta).
  select coalesce(sum(importe), 0) into v_neto
    from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja
     and origen_tipo = 'TURNO_CAJA' and origen_id = v_turno.id
     and (evento = 'AJUSTE_ARQUEO'
          or (evento = 'CORRECCION_REVERSA' and datos->>'evento_corregido' = 'AJUSTE_ARQUEO'));
  if v_neto <> -19548 then
    raise exception 'GUARD: ajuste vigente del jueves = % (se esperaba −19.548)', v_neto;
  end if;

  insert into public.movimientos_financieros (
    negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento
  ) values (
    v_neg, v_caja, 'TURNO_CAJA', v_turno.id, 'CORRECCION_REVERSA',
    -v_neto, -v_neto, v_turno.id,
    'Corrección de arqueo: se revierte "Faltante de arqueo"',
    jsonb_build_object('evento_corregido', 'AJUSTE_ARQUEO', 'motivo', v_motivo),
    v_turno.fecha_cierre
  );

  -- 2. Ramiro se parte: 82.452 queda en la Caja Grande, 19.548 vuelve a la
  --    caja chica del turno.
  update public.egresos
     set monto = monto - v_parte_caja
   where negocio_id = v_neg and id = v_ramiro;

  insert into public.egresos (
    negocio_id, concepto, monto, fecha, creado_por, turno_caja_id, tipo,
    orden_compra_id, cuenta_origen_id, categoria_id
  ) values (
    v_neg, v_egr.concepto || ' (parte pagada con la caja chica)', v_parte_caja,
    v_egr.fecha, v_egr.creado_por, v_turno.id, v_egr.tipo,
    v_egr.orden_compra_id, v_caja, v_egr.categoria_id
  );

  -- 3. Saldo inicial: reversa del de 202.000 y uno nuevo de 182.452, con la
  --    misma fecha.
  v_op := gen_random_uuid();
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, descripcion, datos, fecha_movimiento
  ) values
  (v_op, v_neg, v_cg, 'AJUSTE', v_cg, 'CORRECCION_REVERSA', -v_si.importe, 0,
   'Corrección: se revierte el saldo inicial de 202.000',
   jsonb_build_object('evento_corregido', 'AJUSTE_SALDO_INICIAL', 'movimiento_corregido', v_si.id,
                      'motivo', v_motivo),
   v_si.fecha_movimiento),
  (v_op, v_neg, v_cg, 'AJUSTE', v_cg, 'AJUSTE_SALDO_INICIAL', v_si.importe - v_parte_caja, 0,
   'Saldo que la Caja Grande ya tenía al empezar a usar el sistema',
   jsonb_build_object('cuenta_nombre', 'Caja Grande', 'corrige_movimiento', v_si.id,
                      'motivo', v_motivo),
   v_si.fecha_movimiento);

  -- 4. El turno.
  update public.turnos_caja
     set efectivo_esperado = monto_declarado,
         diferencia        = 0,
         observacion_cierre = concat_ws(' ', observacion_cierre,
           '[Corregido 28/9/2026: de Ramiro, 19.548 salieron de la caja chica y 82.452 de la Caja Grande]')
   where negocio_id = v_neg and id = v_turno.id;

  -- GUARDS
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja and turno_caja_id = v_turno.id) <> 0 then
    raise exception 'GUARD: el turno del jueves no quedó en cero';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg) <> v_cg_antes then
    raise exception 'GUARD: cambió el saldo de la Caja Grande';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió el saldo de la caja diaria';
  end if;
  if (select coalesce(sum(monto), 0) from public.egresos where negocio_id = v_neg) <> v_gastos_antes then
    raise exception 'GUARD: cambió el total de gastos';
  end if;
  if (select coalesce(sum(impacto_resultado), 0) from public.movimientos_financieros
       where negocio_id = v_neg) <> v_res_antes + v_parte_caja then
    raise exception 'GUARD: el resultado no se movió exactamente por el faltante revertido';
  end if;
  if exists (
    select 1 from (
      select sum(importe) over (order by fecha_movimiento, id) as saldo, fecha_movimiento
        from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg
    ) s
    where s.fecha_movimiento < '2026-09-18 00:00:00-03' and s.saldo < 0
  ) then
    raise exception 'GUARD: la Caja Grande queda negativa el 17/9';
  end if;
end;
$jueves$;

alter table public.egresos enable trigger trg_egresos_validar_turno;
alter table public.egresos enable trigger trg_egresos_solo_descriptivo_editable;
alter table public.turnos_caja enable trigger trg_bloquear_edicion_turno_cerrado;

do $guard_triggers$
begin
  if exists (select 1 from pg_trigger
              where tgname in ('trg_bloquear_edicion_turno_cerrado',
                               'trg_egresos_solo_descriptivo_editable',
                               'trg_egresos_validar_turno')
                and tgenabled <> 'O')
     or (select count(*) from pg_trigger
          where tgname in ('trg_bloquear_edicion_turno_cerrado',
                           'trg_egresos_solo_descriptivo_editable',
                           'trg_egresos_validar_turno')) <> 3 then
    raise exception 'GUARD: algún freno no quedó activo';
  end if;
end;
$guard_triggers$;

commit;
