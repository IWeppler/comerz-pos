-- El Nono Cacho: gastos pagados con la Caja Grande que quedaron cargados en
-- la caja diaria del turno.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL CASO (auditoría del 28/9/2026, docs/auditoria-caja-el-nono-cacho-2026-09.md)
--
-- El modal de egreso manda el gasto a la caja del turno cuando nadie elige
-- cuenta. Estos gastos se pagaron con la plata de la Caja Grande, así que el
-- esperado del cajón bajó sin que la plata saliera de ahí: al contar, SOBRÓ,
-- y la Caja Grande del sistema quedó con plata que ya no tenía.
--
-- Decidido con la dueña (Ignacio, 28/9/2026):
--   * Jue 17 tarde (+182.452): "Pago Proveedor Ramiro" 102.000 y "Pago a Dipa"
--     100.000 → Caja Grande. El turno queda en −19.548.
--   * Sáb 19 tarde (+75.504 en el ledger): "DESCARTABLE" 78.000 → Caja Grande.
--     Queda en −2.496.
--   * Jue 24 (+44.290): "dulce de leche" 250.000 se PARTE: 205.710 del cajón
--     (lo que el conteo dice que salió de ahí) y 44.290 de la Caja Grande.
--     Queda en 0.
--   * Sáb 26 tarde (+235.000,70): "Sueldo Agu" 150.000 y "Sueldo Analia"
--     100.000 → Caja Grande (los 250.000 que la Caja Grande tenía desde el
--     retiro de las 08:38). "Claudia sueldo" sigue en el cajón. Queda en
--     −14.999,30.
--
-- Cómo:
--   1. El gasto cambia de cuenta (y pierde el turno: un gasto de la Caja
--      Grande no es del cajón). `registrar_bitacora_egreso` escribe solo el
--      par CORRECCION_REVERSA (cajón) / CORRECCION_APLICADA (Caja Grande),
--      fechado en el gasto. El tipo no cambia, así que la ganancia y el total
--      de gastos del panel no cambian.
--   2. El arqueo del turno se rehace: reversa del ajuste vigente (fechada en
--      el cierre, `evento_corregido = AJUSTE_ARQUEO`, que
--      `resumen_financiero_periodo` ya netea por turno) y un ajuste nuevo por
--      la diferencia real. El conteo firmado NO cambia; cambia el esperado.
--   3. `turnos_caja.efectivo_esperado` / `diferencia` se reescriben con el
--      esperado nuevo. En el sábado 19 eso además corrige el esperado
--      firmado de 173.199,50, que tenía una devolución restada dos veces
--      (bug arreglado en 20260920160000; el ledger ya decía 179.196).
--
-- Lo que NO cambia: el total de gastos, la ganancia, el saldo de la caja
-- diaria, el efectivo total del negocio. La Caja Grande del sistema BAJA
-- 574.290 y puede quedar negativa: le faltan el saldo inicial al 17/9 y los
-- cierres anteriores al 21/9, que entran en una migración aparte cuando la
-- dueña dé el número.

begin;

-- Dos frenos que esta corrección necesita saltear, solo dentro de esta
-- transacción (autorizado por Ignacio el 28/9/2026). Guard al final de que
-- quedaron activos; un rollback los deja activos igual.
alter table public.turnos_caja disable trigger trg_bloquear_edicion_turno_cerrado;
alter table public.egresos disable trigger trg_egresos_solo_descriptivo_editable;

do $reimputar$
declare
  v_neg    constant uuid := '106f0b93-9211-47f9-945f-4691d634f6f3';
  v_motivo constant text :=
    'Reimputación de gastos (auditoría 28/9/2026): se pagaron con la Caja Grande, no con la caja del turno';

  v_caja uuid;
  v_cg   uuid;
  v_caja_antes numeric;
  v_cg_antes   numeric;
  v_gastos_antes numeric;
  v_resultado_antes numeric;

  -- Gastos que pasan enteros a la Caja Grande.
  v_enteros constant uuid[] := array[
    '443a99b9-d243-407a-9e23-b2e468569c7b',  -- Pago Proveedor Ramiro 102.000 (jue 17)
    'fe1d3674-4bef-45b5-9c42-3a5342be9a56',  -- Pago a Dipa 100.000 (jue 17)
    'a4633e4c-1ec8-4030-8c08-71f81dd1aed7',  -- DESCARTABLE 78.000 (sáb 19)
    'fcf7f840-02a4-4a40-980a-4f64e24683ad',  -- Sueldo Agu 150.000 (sáb 26)
    '009b0bea-08c0-4914-8725-62a8ea0a5373'   -- Sueldo Analia 100.000 (sáb 26)
  ]::uuid[];
  v_dulce constant uuid := '7d6eca6b-aed3-441a-8b05-0d048879d96c';  -- dulce de leche 250.000 (jue 24)
  v_dulce_cg constant integer := 44290;

  -- Turno → (monto que sale del cajón, ajuste neto esperado antes, después).
  v_turnos jsonb := jsonb_build_array(
    jsonb_build_object('abre', '2026-09-17 16:30:00-03', 'movido', 202000, 'antes', 182452,    'despues', -19548),
    jsonb_build_object('abre', '2026-09-19 16:40:00-03', 'movido', 78000,  'antes', 75504,     'despues', -2496),
    jsonb_build_object('abre', '2026-09-24 09:04:00-03', 'movido', 44290,  'antes', 44290,     'despues', 0),
    jsonb_build_object('abre', '2026-09-26 16:14:00-03', 'movido', 250000, 'antes', 235000.70, 'despues', -14999.30)
  );

  v_t      jsonb;
  v_turno  record;
  v_neto   numeric;
  v_nuevo  numeric;
  v_saldo  numeric;
  v_n      int;
  v_ids    uuid[] := '{}';
  v_dulce_row record;
  r        record;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260928140000: El Nono Cacho no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_caja from public.cuentas_financieras
   where negocio_id = v_neg and codigo = 'CAJA_DIARIA';
  select id into v_cg from public.cuentas_financieras
   where negocio_id = v_neg and tipo = 'CAJA_GENERAL';
  if v_caja is null or v_cg is null then
    raise exception 'GUARD: faltan las cuentas CAJA_DIARIA / CAJA_GENERAL';
  end if;

  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(importe), 0) into v_cg_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg;
  select coalesce(sum(monto), 0) into v_gastos_antes from public.egresos where negocio_id = v_neg;
  select coalesce(sum(impacto_resultado), 0) into v_resultado_antes
    from public.movimientos_financieros where negocio_id = v_neg;

  -- Los gastos tienen que estar exactamente como se auditaron.
  select count(*) into v_n from public.egresos
   where negocio_id = v_neg and id = any(v_enteros) and cuenta_origen_id = v_caja
     and turno_caja_id is not null;
  if v_n <> 5 then
    raise exception 'GUARD: % de 5 gastos siguen en la caja diaria (¿ya se reimputaron?)', v_n;
  end if;
  select * into v_dulce_row from public.egresos
   where negocio_id = v_neg and id = v_dulce and cuenta_origen_id = v_caja and monto = 250000;
  if v_dulce_row.id is null then
    raise exception 'GUARD: el dulce de leche no está como se auditó';
  end if;

  -- ───────────────────────────────────────────────────────────────────────
  -- 1. Gastos
  -- ───────────────────────────────────────────────────────────────────────
  update public.egresos
     set cuenta_origen_id = v_cg,
         turno_caja_id    = null
   where negocio_id = v_neg and id = any(v_enteros);

  update public.egresos
     set monto = monto - v_dulce_cg
   where negocio_id = v_neg and id = v_dulce;

  insert into public.egresos (
    negocio_id, concepto, monto, fecha, creado_por, turno_caja_id, tipo,
    orden_compra_id, cuenta_origen_id, categoria_id
  ) values (
    v_neg, v_dulce_row.concepto || ' (parte pagada con Caja Grande)', v_dulce_cg,
    v_dulce_row.fecha, v_dulce_row.creado_por, null, v_dulce_row.tipo,
    v_dulce_row.orden_compra_id, v_cg, v_dulce_row.categoria_id
  );

  -- ───────────────────────────────────────────────────────────────────────
  -- 2. Arqueos
  -- ───────────────────────────────────────────────────────────────────────
  for v_t in select * from jsonb_array_elements(v_turnos)
  loop
    select * into v_turno from public.turnos_caja
     where negocio_id = v_neg and estado = 'CERRADO'
       and cuenta_financiera_id = v_caja
       and fecha_apertura >= (v_t->>'abre')::timestamptz
       and fecha_apertura <  (v_t->>'abre')::timestamptz + interval '1 minute';
    if v_turno.id is null then
      raise exception 'GUARD: no se encontró el turno que abre %', v_t->>'abre';
    end if;
    v_ids := v_ids || v_turno.id;

    -- Ajuste vigente: los AJUSTE_ARQUEO más sus reversas (el jueves 24 ya
    -- tiene una de la corrección de horarios).
    select coalesce(sum(importe), 0) into v_neto
      from public.movimientos_financieros
     where negocio_id = v_neg and cuenta_financiera_id = v_caja
       and origen_tipo = 'TURNO_CAJA' and origen_id = v_turno.id
       and (evento = 'AJUSTE_ARQUEO'
            or (evento = 'CORRECCION_REVERSA' and datos->>'evento_corregido' = 'AJUSTE_ARQUEO'));
    if abs(v_neto - (v_t->>'antes')::numeric) > 0.01 then
      raise exception 'GUARD: el turno % tiene ajuste %, se esperaba %', v_turno.id, v_neto, v_t->>'antes';
    end if;

    -- Después del paso 1 el turno quedó con saldo = lo movido.
    select coalesce(sum(importe), 0) into v_saldo
      from public.movimientos_financieros
     where negocio_id = v_neg and cuenta_financiera_id = v_caja and turno_caja_id = v_turno.id;
    if abs(v_saldo - (v_t->>'movido')::numeric) > 0.01 then
      raise exception 'GUARD: el turno % quedó con saldo % tras reimputar (se esperaba %)',
        v_turno.id, v_saldo, v_t->>'movido';
    end if;

    v_nuevo := v_neto - (v_t->>'movido')::numeric;
    if abs(v_nuevo - (v_t->>'despues')::numeric) > 0.01 then
      raise exception 'GUARD: el turno % daría diferencia %, se esperaba %', v_turno.id, v_nuevo, v_t->>'despues';
    end if;

    insert into public.movimientos_financieros (
      negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento
    ) values (
      v_neg, v_caja, 'TURNO_CAJA', v_turno.id, 'CORRECCION_REVERSA',
      -v_neto, -v_neto, v_turno.id,
      'Corrección de arqueo: se revierte ' ||
        case when v_neto >= 0 then '"Sobrante de arqueo"' else '"Faltante de arqueo"' end,
      jsonb_build_object('evento_corregido', 'AJUSTE_ARQUEO', 'motivo', v_motivo),
      v_turno.fecha_cierre
    );

    if v_nuevo <> 0 then
      insert into public.movimientos_financieros (
        negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
        registrado_por
      ) values (
        v_neg, v_caja, 'TURNO_CAJA', v_turno.id, 'AJUSTE_ARQUEO',
        v_nuevo, v_nuevo, v_turno.id,
        case when v_nuevo >= 0 then 'Sobrante de arqueo' else 'Faltante de arqueo' end
          || ' (recalculado al reimputar gastos a la Caja Grande)',
        jsonb_build_object('declarado', v_turno.monto_declarado,
                           'esperado_ledger', v_turno.monto_declarado - v_nuevo,
                           'motivo', v_motivo),
        v_turno.fecha_cierre, v_turno.cerrada_por
      );
    end if;

    update public.turnos_caja
       set efectivo_esperado = monto_declarado - v_nuevo,
           diferencia        = v_nuevo,
           observacion_cierre = concat_ws(' ', observacion_cierre,
             format('[Corregido 28/9/2026: %s de gastos pagados con la Caja Grande salieron de este turno; esperado firmado %s, diferencia firmada %s]',
                    (v_t->>'movido'), v_turno.efectivo_esperado, v_turno.diferencia))
     where negocio_id = v_neg and id = v_turno.id;
  end loop;

  -- ───────────────────────────────────────────────────────────────────────
  -- GUARDS FINALES
  -- ───────────────────────────────────────────────────────────────────────

  -- Cada turno tocado queda en cero en el ledger.
  for r in
    select t.id, coalesce(sum(m.importe), 0) as saldo
      from public.turnos_caja t
      left join public.movimientos_financieros m
        on m.negocio_id = t.negocio_id and m.turno_caja_id = t.id
       and m.cuenta_financiera_id = v_caja
     where t.id = any(v_ids)
     group by t.id
  loop
    if abs(r.saldo) > 0.001 then
      raise exception 'GUARD: el turno % quedó con saldo % en el ledger', r.id, r.saldo;
    end if;
  end loop;

  -- La caja diaria no cambia; la Caja Grande baja exactamente lo reimputado.
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió el saldo de la caja diaria';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg) <> v_cg_antes - 574290 then
    raise exception 'GUARD: la Caja Grande no bajó exactamente 574.290';
  end if;

  -- El total de gastos no cambia. La ganancia cambia solo por los ajustes de
  -- arqueo (sobrante que pasa a faltante): los gastos se netean solos.
  if (select coalesce(sum(monto), 0) from public.egresos where negocio_id = v_neg) <> v_gastos_antes then
    raise exception 'GUARD: cambió el total de gastos';
  end if;
  if abs((select coalesce(sum(impacto_resultado), 0) from public.movimientos_financieros
           where negocio_id = v_neg) - (v_resultado_antes - 574290)) > 0.01 then
    raise exception 'GUARD: el resultado no se movió exactamente por los ajustes de arqueo';
  end if;

  -- Invariante de 20260920180000: caja diaria = turnos abiertos.
  if v_caja_antes <> (
    select coalesce(sum(m.importe), 0)
      from public.movimientos_financieros m
      join public.turnos_caja t on t.negocio_id = m.negocio_id and t.id = m.turno_caja_id
     where m.negocio_id = v_neg and m.cuenta_financiera_id = v_caja and t.estado = 'ABIERTO'
  ) then
    raise exception 'GUARD: la caja diaria no es igual a la suma de los turnos abiertos';
  end if;
end;
$reimputar$;

alter table public.egresos enable trigger trg_egresos_solo_descriptivo_editable;
alter table public.turnos_caja enable trigger trg_bloquear_edicion_turno_cerrado;

do $guard_triggers$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.turnos_caja'::regclass
                    and tgname = 'trg_bloquear_edicion_turno_cerrado' and tgenabled = 'O') then
    raise exception 'GUARD: trg_bloquear_edicion_turno_cerrado no quedó activo';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.egresos'::regclass
                    and tgname = 'trg_egresos_solo_descriptivo_editable' and tgenabled = 'O') then
    raise exception 'GUARD: trg_egresos_solo_descriptivo_editable no quedó activo';
  end if;
end;
$guard_triggers$;

commit;
