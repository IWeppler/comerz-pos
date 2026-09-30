-- El Nono Cacho: el cambio de efectivo por transferencia de $85.000 del
-- martes 29/9 a la tarde no se cargó.
--
-- Turno de Débora 29/9 16:47–18:47 (contado el 30/9 a las 09:42). Un cliente
-- transfirió $85.000 y se llevó el efectivo del cajón; en el sistema no quedó
-- nada, así que el arqueo lo mostró como faltante: esperado 116.070, contado
-- 20.050, faltante 96.020.
--
-- Decidido con la dueña (Ignacio, 30/9/2026): se registra como transferencia
-- caja diaria → Caja Grande, con la misma forma que los cambios que ella dio
-- por buenos en la auditoría del 28/9 (20260928170000). Fechada dentro del
-- turno, antes del cierre.
--
-- El cierre firmado (`efectivo_esperado` 116.070, `diferencia` −96.020) NO se
-- toca. Lo que cambia es el ledger del turno: se revierte el ajuste de arqueo
-- y se re-emite por la diferencia real, −11.020, que sigue sin explicar.
--
-- Efectos: caja diaria sin cambio (el turno sigue cerrado en cero); Caja
-- Grande +85.000; resultado +85.000 (el faltante baja de 96.020 a 11.020).

begin;

do $correccion$
declare
  v_neg     constant uuid := '106f0b93-9211-47f9-945f-4691d634f6f3';
  v_turno   constant uuid := '109d741d-5796-49e8-8bf8-e838958bc097';
  v_monto   constant numeric := 85000;
  v_motivo  constant text :=
    'Cambio de efectivo por transferencia de $85.000 del 29/9 que no se cargó (corrección 30/9/2026)';
  v_concepto constant text := 'Cambio por transferencia (cargado en la corrección del 30/9/2026)';

  v_caja uuid;
  v_cg   uuid;
  t      record;
  v_aj   record;
  v_neto_ajuste numeric;
  v_esperado numeric;
  v_nuevo_ajuste numeric;
  v_fecha_transf timestamptz;
  v_transf uuid;
  v_op uuid;
  v_caja_antes numeric;
  v_cg_antes numeric;
  v_res_antes numeric;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260930130000: El Nono Cacho no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_caja from public.cuentas_financieras where negocio_id = v_neg and codigo = 'CAJA_DIARIA';
  select id into v_cg   from public.cuentas_financieras where negocio_id = v_neg and tipo = 'CAJA_GENERAL';

  select * into t from public.turnos_caja
   where negocio_id = v_neg and id = v_turno and estado = 'CERRADO'
     and cuenta_financiera_id = v_caja
     and efectivo_esperado = 116070 and monto_declarado = 20050 and diferencia = -96020;
  if t.id is null then
    raise exception 'GUARD: el turno del 29/9 a la tarde no está como se auditó';
  end if;

  -- El ajuste vigente del turno: tiene que ser exactamente el de −96.020 y
  -- ninguna corrección previa.
  select coalesce(sum(importe), 0) into v_neto_ajuste
    from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja and turno_caja_id = v_turno
     and (evento = 'AJUSTE_ARQUEO'
          or (evento = 'CORRECCION_REVERSA' and datos->>'evento_corregido' = 'AJUSTE_ARQUEO'));
  select * into v_aj from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja and turno_caja_id = v_turno
     and evento = 'AJUSTE_ARQUEO' and importe = -96020;
  if v_neto_ajuste <> -96020 or v_aj.id is null then
    raise exception 'GUARD: el ajuste vigente del turno es % (se esperaba −96.020)', v_neto_ajuste;
  end if;

  -- Idempotencia: el cambio no puede estar ya cargado.
  if exists (select 1 from public.transferencias_financieras
              where negocio_id = v_neg and monto = v_monto
                and fecha between t.fecha_apertura and t.fecha_cierre) then
    raise exception 'GUARD: ya hay una transferencia de 85.000 en ese turno';
  end if;

  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(importe), 0) into v_cg_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg;
  select coalesce(sum(impacto_resultado), 0) into v_res_antes from public.movimientos_financieros
   where negocio_id = v_neg;

  -- Dentro del turno y antes del cierre (el cierre quedó fechado 18:47:49).
  v_fecha_transf := t.fecha_cierre - interval '1 minute';
  if v_fecha_transf <= t.fecha_apertura then
    raise exception 'GUARD: no hay lugar para fechar el cambio dentro del turno';
  end if;

  -- 1. Reversa del ajuste (primero: el freno de saldo de la caja arqueada
  -- mira el saldo del turno, que cerrado es cero).
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
  ) values (
    gen_random_uuid(), v_neg, v_caja, 'TURNO_CAJA', v_turno, 'CORRECCION_REVERSA',
    -v_aj.importe, -v_aj.impacto_resultado, v_turno,
    'Corrección de arqueo: se revierte "Faltante de arqueo"',
    jsonb_build_object('evento_corregido', 'AJUSTE_ARQUEO', 'movimiento_corregido', v_aj.id,
                       'motivo', v_motivo),
    v_aj.fecha_movimiento, null
  );

  -- 2. El cambio: transferencia caja diaria → Caja Grande.
  insert into public.transferencias_financieras (
    negocio_id, cuenta_origen_id, cuenta_destino_id, monto, concepto, fecha, registrado_por
  ) values (
    v_neg, v_caja, v_cg, v_monto, v_concepto, v_fecha_transf, t.vendedor_id
  ) returning id into v_transf;

  v_op := gen_random_uuid();
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
  ) values (
    v_op, v_neg, v_caja, 'TRANSFERENCIA', v_transf, 'REGISTRO', -v_monto, 0, v_turno,
    'Transferencia a Caja Grande: ' || v_concepto,
    jsonb_build_object('cuenta_origen_id', v_caja, 'cuenta_destino_id', v_cg, 'motivo', v_motivo),
    v_fecha_transf, t.vendedor_id
  );
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
  ) values (
    v_op, v_neg, v_cg, 'TRANSFERENCIA', v_transf, 'REGISTRO', v_monto, 0, null,
    'Transferencia desde Caja diaria: ' || v_concepto,
    jsonb_build_object('cuenta_origen_id', v_caja, 'cuenta_destino_id', v_cg, 'motivo', v_motivo),
    v_fecha_transf, t.vendedor_id
  );

  -- 3. El ajuste re-emitido: lo contado menos lo que el ledger del turno
  -- espera ahora (todo menos los ajustes y el cierre).
  select coalesce(sum(importe), 0) into v_esperado
    from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja and turno_caja_id = v_turno
     and evento not in ('AJUSTE_ARQUEO', 'CIERRE_TURNO')
     and not (evento = 'CORRECCION_REVERSA' and datos->>'evento_corregido' = 'AJUSTE_ARQUEO');
  v_nuevo_ajuste := t.monto_declarado - v_esperado;
  if v_esperado <> 31070 or v_nuevo_ajuste <> -11020 then
    raise exception 'GUARD: esperado % / ajuste % (se esperaba 31.070 / −11.020)', v_esperado, v_nuevo_ajuste;
  end if;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
  ) values (
    gen_random_uuid(), v_neg, v_caja, 'TURNO_CAJA', v_turno, 'AJUSTE_ARQUEO',
    v_nuevo_ajuste, v_nuevo_ajuste, v_turno,
    'Faltante de arqueo (recalculado al cargar el cambio de $85.000)',
    jsonb_build_object('motivo', v_motivo, 'declarado', t.monto_declarado,
                       'esperado_ledger', v_esperado, 'corrige_movimiento', v_aj.id),
    v_aj.fecha_movimiento, v_aj.registrado_por
  );

  -- GUARDS
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja and turno_caja_id = v_turno) <> 0 then
    raise exception 'GUARD: el turno no quedó en cero en el ledger';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió el saldo de la caja diaria';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg) <> v_cg_antes + v_monto then
    raise exception 'GUARD: la Caja Grande no subió exactamente 85.000';
  end if;
  if (select coalesce(sum(impacto_resultado), 0) from public.movimientos_financieros
       where negocio_id = v_neg) <> v_res_antes + v_monto then
    raise exception 'GUARD: el resultado no subió exactamente 85.000';
  end if;
end;
$correccion$;

commit;
