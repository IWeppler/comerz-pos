-- El Nono Cacho: la Caja Grande desde el primer día.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL CASO (auditoría del 28/9/2026, docs/auditoria-caja-el-nono-cacho-2026-09.md)
--
-- El negocio empezó a usar el sistema el 17/9, pero la Caja Grande como
-- cuenta de sistema con patas automáticas de apertura/cierre existe desde
-- 20260921170000 (21/9). Entonces:
--   * nunca se declaró lo que la Caja Grande ya tenía el 17/9, y
--   * los cierres del 17 al 19/9 nunca le entraron, ni le salieron los fondos
--     de los turnos siguientes,
-- mientras que los gastos de esos días (Ramiro y Dipa desde 20260928140000,
-- los sueldos del 19/9 desde siempre) sí le salen. Resultado: −130.588.
--
-- Decidido con la dueña (Ignacio, 28/9/2026):
--   1. Saldo inicial al 17/9 = 202.000: lo justo para pagar a Ramiro y a Dipa
--      ese día (la dueña: "era igual a la cantidad de egresos"). Fechado el
--      17/9 16:29, antes del primer turno. `registrar_saldo_inicial_cuenta`
--      fecha en now() y pide sesión de admin, por eso va a mano con la misma
--      forma (origen AJUSTE, evento AJUSTE_SALDO_INICIAL, impacto 0).
--   2. Las patas de Caja Grande de los turnos del 17 al 19/9, con la misma
--      forma que escribe el sistema desde el 21/9: el cierre entra
--      (+declarado) y el fondo del turno siguiente sale (−monto_inicial).
--      Van SIN turno_caja_id (el vínculo está en origen_id) y con la
--      operacion_id de la pata de caja diaria que les corresponde.
--
-- Una excepción, a propósito: el fondo de 1.000 del primer turno (17/9 16:30)
-- NO sale de la Caja Grande. Es el primer turno del sistema, con un fondo
-- simbólico; sacarlo de una Caja Grande que tenía exactamente lo de los dos
-- pagos la dejaría en −1.000 esa tarde.
--
-- Lo que se ve después, y es la verdad: el 19/9 entre las 20:35 y las 20:47
-- la Caja Grande queda NEGATIVA (~−253.400) porque se le cargaron 750.000 de
-- sueldos antes de recibir el cierre de esa tarde. Parte de esos sueldos se
-- pagó con otra plata (al menos "Diferencia Sueldo Ani Transferencia"). No se
-- esconde: es un dato para la dueña.
--
-- Lo que NO cambia: la caja diaria, los turnos, el resultado (todo impacto 0).

begin;

do $caja_grande$
declare
  v_neg    constant uuid := '106f0b93-9211-47f9-945f-4691d634f6f3';
  v_motivo constant text :=
    'Caja Grande desde el 17/9 (auditoría 28/9/2026): saldo inicial y cierres anteriores a la Caja Grande automática';
  v_saldo_inicial constant numeric := 202000;
  v_fecha_inicial constant timestamptz := '2026-09-17 16:29:00-03';
  v_desde constant timestamptz := '2026-09-17 00:00:00-03';
  v_hasta constant timestamptz := '2026-09-21 00:00:00-03';

  v_caja uuid;
  v_cg   uuid;
  v_cg_antes   numeric;
  v_caja_antes numeric;
  v_res_antes  numeric;
  v_entra numeric := 0;
  v_sale  numeric := 0;
  v_primero uuid;
  v_op uuid;
  v_n int;
  t record;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260928150000: El Nono Cacho no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_caja from public.cuentas_financieras
   where negocio_id = v_neg and codigo = 'CAJA_DIARIA';
  select id into v_cg from public.cuentas_financieras
   where negocio_id = v_neg and tipo = 'CAJA_GENERAL';
  if v_caja is null or v_cg is null then
    raise exception 'GUARD: faltan las cuentas CAJA_DIARIA / CAJA_GENERAL';
  end if;

  if exists (select 1 from public.movimientos_financieros
              where negocio_id = v_neg and cuenta_financiera_id = v_cg
                and evento = 'AJUSTE_SALDO_INICIAL') then
    raise exception 'GUARD: la Caja Grande ya tiene saldo inicial';
  end if;

  -- Ningún turno de ese período tiene ya su pata en la Caja Grande.
  if exists (select 1 from public.movimientos_financieros m
               join public.turnos_caja tc on tc.id = m.origen_id
              where m.negocio_id = v_neg and m.cuenta_financiera_id = v_cg
                and m.origen_tipo = 'TURNO_CAJA'
                and tc.fecha_apertura >= v_desde and tc.fecha_apertura < v_hasta) then
    raise exception 'GUARD: algún turno del 17 al 19/9 ya tiene pata en la Caja Grande';
  end if;

  select coalesce(sum(importe), 0) into v_cg_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg;
  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(impacto_resultado), 0) into v_res_antes from public.movimientos_financieros
   where negocio_id = v_neg;
  if v_cg_antes <> -130588 then
    raise exception 'GUARD: la Caja Grande está en % (se esperaba −130.588)', v_cg_antes;
  end if;

  -- 1. Saldo inicial.
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id,
    evento, importe, impacto_resultado, descripcion, datos, fecha_movimiento
  ) values (
    gen_random_uuid(), v_neg, v_cg, 'AJUSTE', v_cg,
    'AJUSTE_SALDO_INICIAL', v_saldo_inicial, 0,
    'Saldo que la Caja Grande ya tenía al empezar a usar el sistema',
    jsonb_build_object('cuenta_nombre', 'Caja Grande', 'motivo', v_motivo),
    v_fecha_inicial
  );

  -- 2. Patas de los turnos del 17 al 19/9.
  select id into v_primero from public.turnos_caja
   where negocio_id = v_neg order by fecha_apertura limit 1;

  select count(*) into v_n from public.turnos_caja
   where negocio_id = v_neg and fecha_apertura >= v_desde and fecha_apertura < v_hasta
     and estado = 'CERRADO' and cuenta_financiera_id = v_caja;
  if v_n <> 6 then
    raise exception 'GUARD: hay % turnos del 17 al 19/9 (se esperaban 6)', v_n;
  end if;

  for t in
    select * from public.turnos_caja
     where negocio_id = v_neg and fecha_apertura >= v_desde and fecha_apertura < v_hasta
       and estado = 'CERRADO' and cuenta_financiera_id = v_caja
     order by fecha_apertura
  loop
    if t.id <> v_primero and t.monto_inicial > 0 then
      select operacion_id into v_op from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja and origen_tipo = 'TURNO_CAJA'
         and origen_id = t.id and evento = 'APERTURA_TURNO'
       order by id limit 1;
      insert into public.movimientos_financieros (
        operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
        registrado_por
      ) values (
        coalesce(v_op, gen_random_uuid()), v_neg, v_cg, 'TURNO_CAJA', t.id, 'APERTURA_TURNO',
        -t.monto_inicial, 0, null, 'Fondo entregado a la caja diaria',
        jsonb_build_object('turno_caja_id', t.id, 'cuenta_contraparte_id', v_caja,
                           'retroactivo', true, 'motivo', v_motivo),
        t.fecha_apertura, t.abierta_por
      );
      v_sale := v_sale + t.monto_inicial;
    end if;

    if t.monto_declarado > 0 then
      select operacion_id into v_op from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja and origen_tipo = 'TURNO_CAJA'
         and origen_id = t.id and evento = 'CIERRE_TURNO'
       order by id limit 1;
      insert into public.movimientos_financieros (
        operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
        registrado_por
      ) values (
        coalesce(v_op, gen_random_uuid()), v_neg, v_cg, 'TURNO_CAJA', t.id, 'CIERRE_TURNO',
        t.monto_declarado, 0, null, 'Efectivo recibido del cierre de la caja diaria',
        jsonb_build_object('turno_caja_id', t.id, 'cuenta_contraparte_id', v_caja,
                           'declarado', t.monto_declarado, 'retroactivo', true, 'motivo', v_motivo),
        t.fecha_cierre, t.cerrada_por
      );
      v_entra := v_entra + t.monto_declarado;
    end if;
  end loop;

  -- ───────────────────────────────────────────────────────────────────────
  -- GUARDS
  -- ───────────────────────────────────────────────────────────────────────
  if v_entra <> 997900 or v_sale <> 168600 then
    raise exception 'GUARD: cierres % / fondos % (se esperaban 997.900 / 168.600)', v_entra, v_sale;
  end if;

  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg)
     <> v_cg_antes + v_saldo_inicial + v_entra - v_sale then
    raise exception 'GUARD: la Caja Grande no quedó en el saldo calculado';
  end if;

  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió la caja diaria';
  end if;

  if (select coalesce(sum(impacto_resultado), 0) from public.movimientos_financieros
       where negocio_id = v_neg) <> v_res_antes then
    raise exception 'GUARD: cambió el resultado';
  end if;

  -- El 17/9 la Caja Grande nunca queda negativa: los 202.000 alcanzan justo.
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
$caja_grande$;

commit;
