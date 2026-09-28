-- El Nono Cacho: el jueves 17 arranca de cero y los cambios de efectivo por
-- transferencia dejan de ser gastos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Decidido con la dueña (Ignacio, 28/9/2026), y REEMPLAZA lo que 20260928140000
-- / 150000 / 160000 habían hecho con el jueves 17:
--
-- 1. El jueves 17 el negocio empieza a usar el sistema y la Caja Grande
--    todavía no existe: todo arranca en cero. Los gastos grandes de ese día
--    (Ramiro 102.000, Dipa 100.000) salieron de la única caja que había, la
--    física, así que vuelven a la caja chica del turno. La Caja Grande NO
--    tiene saldo inicial: nace con el cierre de ese turno (269.000).
--    El sobrante de 182.452 era plata que ya estaba en la caja antes de la
--    primera venta del sistema: el fondo real no fue 1.000 sino 183.452. Se
--    corrige el fondo (sin pata en la Caja Grande: esa plata es anterior al
--    sistema) y el turno cierra en 0.
--
-- 2. "Cambio de efectivo por transferencia" es un movimiento ENTRE CUENTAS,
--    no un gasto ni un retiro. Se cargaron seis como egreso (375.000; 115.000
--    como OPERATIVO, que restaban de la ganancia). Pasan a ser transferencias
--    caja chica → Caja Grande, con la misma forma que el cambio del 22/9 que
--    la dueña confirma como bien cargado. El egreso se borra (la bitácora deja
--    su ELIMINACION_REVERSA con el motivo) y la transferencia se registra con
--    la fecha y el turno del egreso: el cajón pierde la misma plata a la
--    misma hora, así que ningún arqueo cambia.
--
-- Efectos: caja diaria sin cambio; Caja Grande +375.000; ganancia +115.000
-- (los cambios que figuraban como gasto); total de gastos −375.000.

begin;

alter table public.turnos_caja disable trigger trg_bloquear_edicion_turno_cerrado;
alter table public.egresos disable trigger trg_egresos_solo_descriptivo_editable;

do $correccion$
declare
  v_neg    constant uuid := '106f0b93-9211-47f9-945f-4691d634f6f3';
  v_motivo_jue constant text :=
    'Jueves 17 desde cero (auditoría 28/9/2026): los gastos salieron de la caja física y el fondo real era 183.452';
  v_motivo_cambio constant text :=
    'Cambio de efectivo por transferencia (auditoría 28/9/2026): es una transferencia a la Caja Grande, no un gasto';
  v_ramiro constant uuid := '443a99b9-d243-407a-9e23-b2e468569c7b';
  v_dipa   constant uuid := 'fe1d3674-4bef-45b5-9c42-3a5342be9a56';
  v_cambios constant uuid[] := array[
    '42d1087e-660a-4f64-b30e-07819e7cecde',  -- jue 17 18:55  60.000 RETIRO_SOCIO
    '94676459-5248-43f1-8db9-fc83e89ada0a',  -- jue 17 20:15  40.000 OPERATIVO
    '507dcf5f-f045-4c98-9a41-1614bdcae9ef',  -- vie 18 12:39 150.000 RETIRO_SOCIO
    'd440beaf-df0b-40f0-b553-37a46193a8ca',  -- vie 18 18:40  50.000 OPERATIVO
    '20ba404a-6200-44ae-9d5e-7a1a8cbfa572',  -- sáb 19 10:28  50.000 RETIRO_SOCIO
    '6ffba2da-3f77-4b9d-b87b-5964827af0b9'   -- sáb 19 11:40  25.000 OPERATIVO
  ]::uuid[];
  v_fondo_real constant numeric := 183452;

  v_caja uuid;
  v_cg   uuid;
  v_turno record;
  v_ap    record;
  v_si    record;
  v_parte record;
  v_neto  numeric;
  v_caja_antes numeric;
  v_cg_antes   numeric;
  v_res_antes  numeric;
  v_gastos_antes numeric;
  v_turnos uuid[];
  v_transf uuid;
  v_op uuid;
  v_n int;
  e record;
  r record;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260928170000: El Nono Cacho no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_caja from public.cuentas_financieras where negocio_id = v_neg and codigo = 'CAJA_DIARIA';
  select id into v_cg   from public.cuentas_financieras where negocio_id = v_neg and tipo = 'CAJA_GENERAL';

  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(importe), 0) into v_cg_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg;
  select coalesce(sum(impacto_resultado), 0) into v_res_antes from public.movimientos_financieros
   where negocio_id = v_neg;
  select coalesce(sum(monto), 0) into v_gastos_antes from public.egresos where negocio_id = v_neg;

  -- ───────────────────────────────────────────────────────────────────────
  -- 1. JUEVES 17
  -- ───────────────────────────────────────────────────────────────────────
  select * into v_turno from public.turnos_caja
   where negocio_id = v_neg and estado = 'CERRADO' and cuenta_financiera_id = v_caja
     and fecha_apertura >= '2026-09-17 16:30:00-03' and fecha_apertura < '2026-09-17 16:31:00-03'
     and monto_inicial = 1000 and monto_declarado = 269000;
  select * into v_ap from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja and origen_tipo = 'TURNO_CAJA'
     and origen_id = v_turno.id and evento = 'APERTURA_TURNO' and importe = 1000;
  select * into v_si from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg and evento = 'AJUSTE_SALDO_INICIAL'
     and importe = 182452
     and not exists (select 1 from public.movimientos_financieros x
                      where x.negocio_id = v_neg and x.evento = 'CORRECCION_REVERSA'
                        and x.datos->>'movimiento_corregido' = movimientos_financieros.id::text);
  select * into v_parte from public.egresos
   where negocio_id = v_neg and cuenta_origen_id = v_caja and turno_caja_id = v_turno.id
     and monto = 19548 and concepto like 'Pago Proveedor Ramiro (parte pagada con la caja chica)';
  if v_turno.id is null or v_ap.id is null or v_si.id is null or v_parte.id is null then
    raise exception 'GUARD: el jueves 17 no está como lo dejó 20260928160000';
  end if;
  if not exists (select 1 from public.egresos where negocio_id = v_neg and id = v_ramiro
                  and cuenta_origen_id = v_cg and monto = 82452)
     or not exists (select 1 from public.egresos where negocio_id = v_neg and id = v_dipa
                     and cuenta_origen_id = v_cg and monto = 100000) then
    raise exception 'GUARD: Ramiro / Dipa no están en la Caja Grande como se esperaba';
  end if;

  -- 1a. Fondo real: reversa del de 1.000 y re-emisión por 183.452 (misma
  -- hora). Sin pata en la Caja Grande.
  v_op := gen_random_uuid();
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
  ) values
  (v_op, v_neg, v_caja, 'TURNO_CAJA', v_turno.id, 'CORRECCION_REVERSA', -v_ap.importe, 0, v_turno.id,
   'Corrección de cierre: se revierte "Fondo inicial del turno"',
   jsonb_build_object('evento_corregido', 'APERTURA_TURNO', 'movimiento_corregido', v_ap.id,
                      'motivo', v_motivo_jue),
   v_ap.fecha_movimiento, v_ap.registrado_por),
  (v_op, v_neg, v_caja, 'TURNO_CAJA', v_turno.id, 'APERTURA_TURNO', v_fondo_real, 0, v_turno.id,
   'Fondo inicial del turno (plata que ya estaba en la caja al empezar a usar el sistema)',
   jsonb_build_object('corrige_movimiento', v_ap.id, 'motivo', v_motivo_jue),
   v_ap.fecha_movimiento, v_ap.registrado_por);

  -- 1b. Ramiro y Dipa vuelven enteros a la caja chica del turno.
  perform set_config('comerz.motivo_anulacion',
    'se une otra vez a "Pago Proveedor Ramiro" (auditoría 28/9/2026)', true);
  delete from public.egresos where negocio_id = v_neg and id = v_parte.id;
  perform set_config('comerz.motivo_anulacion', '', true);

  update public.egresos
     set cuenta_origen_id = v_caja, turno_caja_id = v_turno.id, monto = 102000
   where negocio_id = v_neg and id = v_ramiro;
  update public.egresos
     set cuenta_origen_id = v_caja, turno_caja_id = v_turno.id
   where negocio_id = v_neg and id = v_dipa;

  -- 1c. La Caja Grande no tiene saldo inicial.
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, descripcion, datos, fecha_movimiento
  ) values (
    gen_random_uuid(), v_neg, v_cg, 'AJUSTE', v_cg, 'CORRECCION_REVERSA', -v_si.importe, 0,
    'Corrección: la Caja Grande arranca en cero el 17/9 (se revierte el saldo inicial)',
    jsonb_build_object('evento_corregido', 'AJUSTE_SALDO_INICIAL', 'movimiento_corregido', v_si.id,
                       'motivo', v_motivo_jue),
    v_si.fecha_movimiento
  );

  -- 1d. El arqueo del jueves: el ajuste vigente ya es 0 (160000) y con el
  -- fondo real el esperado es exactamente lo contado.
  select coalesce(sum(importe), 0) into v_neto
    from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja
     and origen_tipo = 'TURNO_CAJA' and origen_id = v_turno.id
     and (evento = 'AJUSTE_ARQUEO'
          or (evento = 'CORRECCION_REVERSA' and datos->>'evento_corregido' = 'AJUSTE_ARQUEO'));
  if v_neto <> 0 then
    raise exception 'GUARD: el ajuste vigente del jueves es % (se esperaba 0)', v_neto;
  end if;

  update public.turnos_caja
     set monto_inicial     = v_fondo_real,
         efectivo_esperado = monto_declarado,
         diferencia        = 0,
         observacion_apertura = concat_ws(' ', observacion_apertura,
           '[Corregido 28/9/2026: abría con 1.000; el fondo real era 183.452, plata que ya estaba en la caja antes de empezar a usar el sistema]'),
         observacion_cierre = concat_ws(' ', observacion_cierre,
           '[Corregido 28/9/2026: Ramiro y Dipa salieron de la caja física; la Caja Grande arranca con este cierre]')
   where negocio_id = v_neg and id = v_turno.id;

  -- ───────────────────────────────────────────────────────────────────────
  -- 2. CAMBIOS DE EFECTIVO POR TRANSFERENCIA
  -- ───────────────────────────────────────────────────────────────────────
  select count(*) into v_n from public.egresos
   where negocio_id = v_neg and id = any(v_cambios) and cuenta_origen_id = v_caja
     and turno_caja_id is not null;
  if v_n <> 6 then
    raise exception 'GUARD: % de 6 cambios siguen como egreso de la caja chica', v_n;
  end if;
  if (select sum(monto) from public.egresos where negocio_id = v_neg and id = any(v_cambios)) <> 375000 then
    raise exception 'GUARD: los cambios no suman 375.000';
  end if;

  select array_agg(distinct turno_caja_id) into v_turnos
    from public.egresos where negocio_id = v_neg and id = any(v_cambios);

  for e in
    select * from public.egresos where negocio_id = v_neg and id = any(v_cambios) order by fecha
  loop
    perform set_config('comerz.motivo_anulacion', v_motivo_cambio, true);
    delete from public.egresos where negocio_id = v_neg and id = e.id;
    perform set_config('comerz.motivo_anulacion', '', true);

    insert into public.transferencias_financieras (
      negocio_id, cuenta_origen_id, cuenta_destino_id, monto, concepto, fecha, registrado_por
    ) values (
      v_neg, v_caja, v_cg, e.monto, e.concepto, e.fecha, e.creado_por
    ) returning id into v_transf;

    v_op := gen_random_uuid();
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values
    (v_op, v_neg, v_caja, 'TRANSFERENCIA', v_transf, 'REGISTRO', -e.monto, 0, e.turno_caja_id,
     'Transferencia a Caja Grande: ' || e.concepto,
     jsonb_build_object('cuenta_origen_id', v_caja, 'cuenta_destino_id', v_cg,
                        'egreso_reemplazado', e.id, 'motivo', v_motivo_cambio),
     e.fecha, e.creado_por),
    (v_op, v_neg, v_cg, 'TRANSFERENCIA', v_transf, 'REGISTRO', e.monto, 0, null,
     'Transferencia desde Caja diaria: ' || e.concepto,
     jsonb_build_object('cuenta_origen_id', v_caja, 'cuenta_destino_id', v_cg,
                        'egreso_reemplazado', e.id, 'motivo', v_motivo_cambio),
     e.fecha, e.creado_por);
  end loop;

  -- ───────────────────────────────────────────────────────────────────────
  -- GUARDS
  -- ───────────────────────────────────────────────────────────────────────
  for r in
    select t.id, coalesce(sum(m.importe), 0) as saldo
      from public.turnos_caja t
      left join public.movimientos_financieros m
        on m.negocio_id = t.negocio_id and m.turno_caja_id = t.id and m.cuenta_financiera_id = v_caja
     where t.id = any(v_turnos || v_turno.id)
     group by t.id
  loop
    if abs(r.saldo) > 0.001 then
      raise exception 'GUARD: el turno % quedó con saldo % en el ledger', r.id, r.saldo;
    end if;
  end loop;

  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió el saldo de la caja diaria';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg) <> v_cg_antes + 375000 then
    raise exception 'GUARD: la Caja Grande no subió exactamente 375.000';
  end if;
  if (select coalesce(sum(impacto_resultado), 0) from public.movimientos_financieros
       where negocio_id = v_neg) <> v_res_antes + 115000 then
    raise exception 'GUARD: la ganancia no subió exactamente 115.000';
  end if;
  if (select coalesce(sum(monto), 0) from public.egresos where negocio_id = v_neg) <> v_gastos_antes - 375000 then
    raise exception 'GUARD: el total de gastos no bajó exactamente 375.000';
  end if;
  if exists (select 1 from public.egresos where negocio_id = v_neg and concepto ilike '%cambio%') then
    raise exception 'GUARD: queda algún cambio cargado como egreso';
  end if;
  -- La Caja Grande arranca en cero: antes del cierre del jueves solo recibe
  -- los dos cambios de ese día (100.000); el resto son pares registro +
  -- reversa de las correcciones de hoy, que netean cero.
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg
         and fecha_movimiento < v_turno.fecha_cierre
         and origen_tipo <> 'TRANSFERENCIA') <> 0 then
    raise exception 'GUARD: la Caja Grande no está en cero antes del cierre del jueves 17';
  end if;
end;
$correccion$;

alter table public.egresos enable trigger trg_egresos_solo_descriptivo_editable;
alter table public.turnos_caja enable trigger trg_bloquear_edicion_turno_cerrado;

do $guard_triggers$
begin
  if (select count(*) from pg_trigger
       where tgname in ('trg_bloquear_edicion_turno_cerrado', 'trg_egresos_solo_descriptivo_editable')
         and tgenabled = 'O') <> 2 then
    raise exception 'GUARD: algún freno no quedó activo';
  end if;
end;
$guard_triggers$;

commit;
