-- El Nono Cacho: dos turnos que quedaron abiertos de noche vuelven a su día.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL CASO (auditoría del 28/9/2026 con la dueña)
--
-- * Turno del JUEVES 24 (abre 09:04): su último movimiento es el pago del
--   dulce de leche a las 12:17 del jueves, pero se cerró el VIERNES 25 a las
--   08:14. En la noche no hubo ningún movimiento, así que lo contado el viernes
--   (99.200) es lo que había el jueves. Solo cambia la hora: cierre jueves
--   12:45.
--
-- * Turno del VIERNES 25 a la tarde (abre 16:41): la última venta del viernes
--   es de las 20:39, pero se cerró el SÁBADO 26 a las 08:38. Adentro quedaron
--   12 cobros del sábado entre 08:22 y 08:29 ($76.500 en efectivo, $48.400 por
--   transferencia) y los dos cambios de efectivo por transferencia ($175.000)
--   que se cargaron a las 08:38. El conteo de las 08:38 (300.500) se hizo el
--   sábado, con esa plata adentro.
--
-- Decidido con la dueña (Ignacio, 28/9/2026):
--   1. Jueves: cierre a las 12:45 del jueves, mismo conteo.
--   2. Viernes: cierre a las 20:45 del viernes con contado = esperado. ESA
--      NOCHE NADIE CONTÓ: queda marcado como cierre reconstruido. El efectivo
--      queda en el cajón y es el fondo del sábado.
--      Sábado mañana: empieza a las 08:21 con ese fondo, recibe los cobros y
--      los cambios del sábado, y a las 08:38 tiene el CONTEO REAL (300.500,
--      sobrante +73.479,80, que ahora es del sábado, que es cuando se detectó)
--      y el retiro de $250.000 a la Caja Grande como transferencia explícita
--      —antes el sistema lo daba por hecho al cerrar y reabrir—. Después sigue
--      igual que siempre hasta su cierre de las 12:41.
--   3. Ledger: REVERSA + RE-EMISIÓN, nunca edición. La bitácora es
--      append-only; cada fila corregida queda con su reversa al lado
--      (`CORRECCION_REVERSA`, fechada en la fecha ORIGINAL para que ese día
--      quede neto en cero) y la fila nueva fechada donde corresponde.
--
-- Lo que NO cambia: el efectivo total del negocio, el saldo de la Caja Grande
-- y el de la caja diaria (guards abajo). Solo cambia en qué turno y en qué día
-- cae cada peso.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EFECTO LATERAL QUE HAY QUE CONOCER
--
-- Mover `venta_pagos.turno_caja_id` despierta `registrar_bitacora_venta_pago`,
-- que escribe su propio par CORRECCION_REVERSA / CORRECCION_APLICADA fechado
-- en now(). Es el camino normal de una corrección de cobro y neto da cero en
-- cada cuenta; se deja así en vez de apagar el trigger.
--
-- Y `resumen_financiero_periodo` sumaba sobrantes y faltantes fila por fila
-- con `evento = 'AJUSTE_ARQUEO'`: una reversa no la veía y el sobrante del
-- jueves se habría contado dos veces (viernes y jueves). Se parchea para que
-- neteé por turno las reversas de ajuste. Ver sección 3.

begin;

-- Un turno cerrado es inmutable por `trg_bloquear_edicion_turno_cerrado`
-- (20260728140000), y esta corrección es justamente editar tres turnos
-- cerrados. Se apaga solo dentro de esta transacción y se vuelve a prender
-- antes del commit —mismo método que 20260919120000—; si algo falla, el
-- rollback lo deja prendido. Un guard al final verifica que quedó activo.
-- Autorizado por Ignacio el 28/9/2026.
alter table public.turnos_caja disable trigger trg_bloquear_edicion_turno_cerrado;

do $corregir$
declare
  v_neg   constant uuid := '106f0b93-9211-47f9-945f-4691d634f6f3';
  v_motivo constant text :=
    'Corrección de horarios de cierre (auditoría 28/9/2026): el turno quedó abierto de noche';

  v_caja uuid;
  v_cg   uuid;
  v_thu  record;
  v_fri  record;
  v_sat  record;

  v_thu_cierre constant timestamptz := '2026-09-24 12:45:00-03';
  v_fri_cierre constant timestamptz := '2026-09-25 20:45:00-03';
  v_sat_apertura constant timestamptz := '2026-09-26 08:21:00-03';
  v_corte_sab constant timestamptz := '2026-09-26 00:00:00-03';

  v_caja_antes numeric;
  v_cg_antes   numeric;
  v_x          numeric;   -- efectivo del cajón al cerrar el viernes
  v_ef_movido  numeric;
  v_total_movido numeric;
  v_cambios    numeric;
  v_ajuste     numeric;
  v_ajuste_fri numeric;
  v_retiro     numeric;
  v_esperado_sat numeric;
  v_transf     uuid;
  v_op         uuid;
  v_n          int;
  r            record;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260928130000: El Nono Cacho no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_caja from public.cuentas_financieras
   where negocio_id = v_neg and codigo = 'CAJA_DIARIA';
  select id into v_cg from public.cuentas_financieras
   where negocio_id = v_neg and tipo = 'CAJA_GENERAL';
  if v_caja is null or v_cg is null then
    raise exception 'GUARD: faltan las cuentas CAJA_DIARIA / CAJA_GENERAL';
  end if;

  -- Los tres turnos, identificados por apertura y verificados por sus montos.
  -- Si alguno no está exactamente como se auditó, no se toca nada.
  select * into v_thu from public.turnos_caja
   where negocio_id = v_neg and estado = 'CERRADO'
     and fecha_apertura >= '2026-09-24 09:04:00-03' and fecha_apertura < '2026-09-24 09:05:00-03'
     and monto_inicial = 94900 and monto_declarado = 99200;
  select * into v_fri from public.turnos_caja
   where negocio_id = v_neg and estado = 'CERRADO'
     and fecha_apertura >= '2026-09-25 16:41:00-03' and fecha_apertura < '2026-09-25 16:42:00-03'
     and monto_inicial = 254700 and monto_declarado = 300500;
  select * into v_sat from public.turnos_caja
   where negocio_id = v_neg and estado = 'CERRADO'
     and fecha_apertura >= '2026-09-26 08:39:00-03' and fecha_apertura < '2026-09-26 08:40:00-03'
     and monto_inicial = 50500 and monto_declarado = 286600;
  if v_thu.id is null or v_fri.id is null or v_sat.id is null then
    raise exception 'GUARD: algún turno no coincide con lo auditado (¿ya se corrigió?)';
  end if;
  if v_thu.cuenta_financiera_id <> v_caja or v_fri.cuenta_financiera_id <> v_caja
     or v_sat.cuenta_financiera_id <> v_caja then
    raise exception 'GUARD: los turnos no son de la caja diaria';
  end if;

  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(importe), 0) into v_cg_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_cg;

  -- El jueves no tiene nada después de las 12:45.
  if exists (select 1 from public.movimientos_financieros
              where negocio_id = v_neg and turno_caja_id = v_thu.id
                and origen_tipo <> 'TURNO_CAJA' and fecha_movimiento >= v_thu_cierre)
     or exists (select 1 from public.venta_pagos
                 where negocio_id = v_neg and turno_caja_id = v_thu.id
                   and creado_en >= v_thu_cierre) then
    raise exception 'GUARD: el turno del jueves tiene movimientos después de las 12:45';
  end if;

  -- ───────────────────────────────────────────────────────────────────────
  -- 1. JUEVES 24: reversa + re-emisión del ajuste y del cierre (3 filas)
  -- ───────────────────────────────────────────────────────────────────────
  select count(*) into v_n from public.movimientos_financieros
   where negocio_id = v_neg and origen_tipo = 'TURNO_CAJA' and origen_id = v_thu.id
     and evento in ('AJUSTE_ARQUEO', 'CIERRE_TURNO');
  if v_n <> 3 then
    raise exception 'GUARD: el cierre del jueves tiene % filas en el ledger (se esperaban 3)', v_n;
  end if;

  v_op := gen_random_uuid();
  for r in
    select * from public.movimientos_financieros
     where negocio_id = v_neg and origen_tipo = 'TURNO_CAJA' and origen_id = v_thu.id
       and evento in ('AJUSTE_ARQUEO', 'CIERRE_TURNO')
     order by id
  loop
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento
    ) values (
      v_op, v_neg, r.cuenta_financiera_id, r.origen_tipo, r.origen_id, 'CORRECCION_REVERSA',
      -r.importe, -r.impacto_resultado, r.turno_caja_id,
      'Corrección de horario: se revierte "' || coalesce(r.descripcion, r.evento) || '"',
      jsonb_build_object('evento_corregido', r.evento, 'movimiento_corregido', r.id,
                         'motivo', v_motivo),
      r.fecha_movimiento
    );
  end loop;

  v_op := gen_random_uuid();
  for r in
    select * from public.movimientos_financieros
     where negocio_id = v_neg and origen_tipo = 'TURNO_CAJA' and origen_id = v_thu.id
       and evento in ('AJUSTE_ARQUEO', 'CIERRE_TURNO')
     order by id
  loop
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
      registrado_por
    ) values (
      v_op, v_neg, r.cuenta_financiera_id, r.origen_tipo, r.origen_id, r.evento,
      r.importe, r.impacto_resultado, r.turno_caja_id, r.descripcion,
      r.datos || jsonb_build_object('corrige_movimiento', r.id, 'motivo', v_motivo),
      v_thu_cierre, r.registrado_por
    );
  end loop;

  update public.turnos_caja
     set fecha_cierre = v_thu_cierre,
         observacion_cierre = concat_ws(' ', observacion_cierre,
           '[Corregido 28/9/2026: se cerró el 25/9 08:14; sin movimientos después de las 12:17 del 24/9]')
   where negocio_id = v_neg and id = v_thu.id;

  -- ───────────────────────────────────────────────────────────────────────
  -- 2. VIERNES 25 TARDE → SÁBADO 26 MAÑANA
  -- ───────────────────────────────────────────────────────────────────────

  -- Efectivo del cajón al cerrar el viernes: fondo + cobros del viernes.
  -- (No hubo egresos ni otras transferencias del viernes en ese turno.)
  if exists (select 1 from public.egresos
              where negocio_id = v_neg and turno_caja_id = v_fri.id) then
    raise exception 'GUARD: el turno del viernes tiene egresos; revisar a mano';
  end if;

  select v_fri.monto_inicial + coalesce(sum(vp.monto_bruto), 0) into v_x
    from public.venta_pagos vp
   where vp.negocio_id = v_neg and vp.turno_caja_id = v_fri.id
     and vp.metodo_tipo = 'EFECTIVO' and vp.creado_en < v_corte_sab;
  if abs(v_x - 325520.2) > 0.01 then
    raise exception 'GUARD: efectivo al cierre del viernes = % (se esperaba 325.520,20)', v_x;
  end if;
  if exists (select 1 from public.venta_pagos
              where negocio_id = v_neg and turno_caja_id = v_fri.id
                and creado_en >= v_fri_cierre and creado_en < v_corte_sab) then
    raise exception 'GUARD: hay cobros del viernes después de las 20:45';
  end if;

  select coalesce(sum(monto_bruto) filter (where metodo_tipo = 'EFECTIVO'), 0),
         coalesce(sum(monto_bruto), 0)
    into v_ef_movido, v_total_movido
    from public.venta_pagos
   where negocio_id = v_neg and turno_caja_id = v_fri.id and creado_en >= v_corte_sab;
  if v_ef_movido <> 76500 or v_total_movido <> 124900 then
    raise exception 'GUARD: cobros del sábado en el turno del viernes = % efectivo / % total (se esperaban 76.500 / 124.900)',
      v_ef_movido, v_total_movido;
  end if;

  -- 2a. Reversa del cierre del viernes (ajuste + cierre cajón + cierre CG).
  select count(*), coalesce(sum(importe) filter (where evento = 'AJUSTE_ARQUEO'), 0)
    into v_n, v_ajuste_fri
    from public.movimientos_financieros
   where negocio_id = v_neg and origen_tipo = 'TURNO_CAJA' and origen_id = v_fri.id
     and evento in ('AJUSTE_ARQUEO', 'CIERRE_TURNO');
  if v_n <> 3 then
    raise exception 'GUARD: el cierre del viernes tiene % filas en el ledger (se esperaban 3)', v_n;
  end if;

  v_op := gen_random_uuid();
  for r in
    select * from public.movimientos_financieros
     where negocio_id = v_neg and origen_tipo = 'TURNO_CAJA' and origen_id = v_fri.id
       and evento in ('AJUSTE_ARQUEO', 'CIERRE_TURNO')
     order by id
  loop
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento
    ) values (
      v_op, v_neg, r.cuenta_financiera_id, r.origen_tipo, r.origen_id, 'CORRECCION_REVERSA',
      -r.importe, -r.impacto_resultado, r.turno_caja_id,
      'Corrección de horario: se revierte "' || coalesce(r.descripcion, r.evento) || '"',
      jsonb_build_object('evento_corregido', r.evento, 'movimiento_corregido', r.id,
                         'motivo', v_motivo),
      r.fecha_movimiento
    );
  end loop;

  -- 2b. Reversa de la apertura del sábado (fondo 50.500, cajón + CG).
  select count(*) into v_n from public.movimientos_financieros
   where negocio_id = v_neg and origen_tipo = 'TURNO_CAJA' and origen_id = v_sat.id
     and evento = 'APERTURA_TURNO';
  if v_n <> 2 then
    raise exception 'GUARD: la apertura del sábado tiene % filas (se esperaban 2)', v_n;
  end if;

  v_op := gen_random_uuid();
  for r in
    select * from public.movimientos_financieros
     where negocio_id = v_neg and origen_tipo = 'TURNO_CAJA' and origen_id = v_sat.id
       and evento = 'APERTURA_TURNO'
     order by id
  loop
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento
    ) values (
      v_op, v_neg, r.cuenta_financiera_id, r.origen_tipo, r.origen_id, 'CORRECCION_REVERSA',
      -r.importe, -r.impacto_resultado, r.turno_caja_id,
      'Corrección de horario: se revierte "' || coalesce(r.descripcion, r.evento) || '"',
      jsonb_build_object('evento_corregido', r.evento, 'movimiento_corregido', r.id,
                         'motivo', v_motivo),
      r.fecha_movimiento
    );
  end loop;

  -- 2c. Cierre reconstruido del viernes 20:45: el cajón se "entrega" entero…
  v_op := gen_random_uuid();
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
    registrado_por
  ) values
  (v_op, v_neg, v_caja, 'TURNO_CAJA', v_fri.id, 'CIERRE_TURNO', -v_x, 0, v_fri.id,
   'Cierre reconstruido (sin conteo): el efectivo queda como fondo del sábado',
   jsonb_build_object('declarado', v_x, 'esperado_ledger', v_x, 'reconstruido', true,
                      'motivo', v_motivo),
   v_fri_cierre, v_fri.cerrada_por),
  (v_op, v_neg, v_cg, 'TURNO_CAJA', v_fri.id, 'CIERRE_TURNO', v_x, 0, null,
   'Efectivo recibido del cierre de la caja diaria (reconstruido)',
   jsonb_build_object('turno_caja_id', v_fri.id, 'cuenta_contraparte_id', v_caja,
                      'declarado', v_x, 'reconstruido', true, 'motivo', v_motivo),
   v_fri_cierre, v_fri.cerrada_por);

  -- …y 2d. el sábado lo recibe como fondo a las 08:21.
  v_op := gen_random_uuid();
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
    registrado_por
  ) values
  (v_op, v_neg, v_caja, 'TURNO_CAJA', v_sat.id, 'APERTURA_TURNO', v_x, 0, v_sat.id,
   'Fondo inicial del turno (lo que quedó en el cajón el viernes)',
   jsonb_build_object('motivo', v_motivo), v_sat_apertura, v_sat.vendedor_id),
  (v_op, v_neg, v_cg, 'TURNO_CAJA', v_sat.id, 'APERTURA_TURNO', -v_x, 0, null,
   'Fondo entregado a la caja diaria',
   jsonb_build_object('turno_caja_id', v_sat.id, 'cuenta_contraparte_id', v_caja,
                      'motivo', v_motivo),
   v_sat_apertura, v_sat.vendedor_id);

  update public.turnos_caja
     set fecha_apertura = v_sat_apertura,
         monto_inicial  = v_x,
         observacion_apertura = concat_ws(' ', observacion_apertura,
           '[Corregido 28/9/2026: abría 08:39 con 50.500; incluye las ventas de 08:22-08:29, el conteo de las 08:38 (300.500) y el retiro de 250.000 a Caja Grande]')
   where negocio_id = v_neg and id = v_sat.id;

  -- 2e. Los cobros del sábado pasan al turno del sábado (y sus ventas).
  update public.ventas
     set turno_caja_id = v_sat.id
   where negocio_id = v_neg and turno_caja_id = v_fri.id
     and id in (select venta_id from public.venta_pagos
                 where negocio_id = v_neg and turno_caja_id = v_fri.id
                   and creado_en >= v_corte_sab);

  update public.venta_pagos
     set turno_caja_id = v_sat.id
   where negocio_id = v_neg and turno_caja_id = v_fri.id and creado_en >= v_corte_sab;

  -- 2f. Los dos cambios de efectivo por transferencia de las 08:38.
  select count(*), coalesce(-sum(importe), 0) into v_n, v_cambios
    from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja
     and turno_caja_id = v_fri.id and origen_tipo = 'TRANSFERENCIA';
  if v_n <> 2 or v_cambios <> 175000 then
    raise exception 'GUARD: transferencias del turno del viernes = % filas / % (se esperaban 2 / 175.000)',
      v_n, v_cambios;
  end if;

  for r in
    select * from public.movimientos_financieros
     where negocio_id = v_neg and cuenta_financiera_id = v_caja
       and turno_caja_id = v_fri.id and origen_tipo = 'TRANSFERENCIA'
     order by id
  loop
    v_op := gen_random_uuid();
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
      registrado_por
    ) values
    (v_op, v_neg, r.cuenta_financiera_id, r.origen_tipo, r.origen_id, 'CORRECCION_REVERSA',
     -r.importe, -r.impacto_resultado, r.turno_caja_id,
     'Corrección de turno: se revierte "' || coalesce(r.descripcion, r.evento) || '"',
     jsonb_build_object('evento_corregido', r.evento, 'movimiento_corregido', r.id,
                        'motivo', v_motivo),
     r.fecha_movimiento, r.registrado_por),
    (v_op, v_neg, r.cuenta_financiera_id, r.origen_tipo, r.origen_id, 'CORRECCION_APLICADA',
     r.importe, r.impacto_resultado, v_sat.id,
     r.descripcion,
     r.datos || jsonb_build_object('corrige_movimiento', r.id, 'motivo', v_motivo),
     r.fecha_movimiento, r.registrado_por);
  end loop;

  -- 2g. El conteo real de las 08:38: 300.500 contra lo que el ledger dice que
  -- había en ese momento. Tiene que dar el mismo sobrante que antes figuraba
  -- en el viernes: es la misma plata, contada en el mismo momento.
  v_ajuste :=v_fri.monto_declarado - (v_x + v_ef_movido - v_cambios);
  if abs(v_ajuste - v_ajuste_fri) > 0.01 then
    raise exception 'GUARD: sobrante del conteo de las 08:38 = % (antes figuraba %)', v_ajuste, v_ajuste_fri;
  end if;

  insert into public.movimientos_financieros (
    negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
    registrado_por
  ) values (
    v_neg, v_caja, 'TURNO_CAJA', v_sat.id, 'AJUSTE_ARQUEO', v_ajuste, v_ajuste, v_sat.id,
    case when v_ajuste >= 0 then 'Sobrante de arqueo (conteo de las 08:38)'
         else 'Faltante de arqueo (conteo de las 08:38)' end,
    jsonb_build_object('declarado', v_fri.monto_declarado,
                       'esperado_ledger', v_x + v_ef_movido - v_cambios,
                       'conteo_intermedio', true, 'motivo', v_motivo),
    v_fri.fecha_cierre, v_fri.cerrada_por
  );

  -- 2h. El retiro de las 08:38 a la Caja Grande, como transferencia explícita.
  v_retiro := v_fri.monto_declarado - v_sat.monto_inicial;   -- 300.500 − 50.500
  if v_retiro <> 250000 then
    raise exception 'GUARD: retiro de las 08:38 = % (se esperaba 250.000)', v_retiro;
  end if;

  insert into public.transferencias_financieras (
    negocio_id, cuenta_origen_id, cuenta_destino_id, monto, concepto, fecha,
    registrado_por
  ) values (
    v_neg, v_caja, v_cg, v_retiro,
    'Retiro a Caja Grande al conteo de las 08:38 (reconstruido en la auditoría del 28/9/2026)',
    v_fri.fecha_cierre, v_fri.cerrada_por
  ) returning id into v_transf;

  v_op := gen_random_uuid();
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento,
    registrado_por
  ) values
  (v_op, v_neg, v_caja, 'TRANSFERENCIA', v_transf, 'REGISTRO', -v_retiro, 0, v_sat.id,
   'Transferencia a Caja Grande: retiro al conteo de las 08:38',
   jsonb_build_object('cuenta_origen_id', v_caja, 'cuenta_destino_id', v_cg,
                      'motivo', v_motivo),
   v_fri.fecha_cierre, v_fri.cerrada_por),
  (v_op, v_neg, v_cg, 'TRANSFERENCIA', v_transf, 'REGISTRO', v_retiro, 0, null,
   'Transferencia desde Caja diaria: retiro al conteo de las 08:38',
   jsonb_build_object('cuenta_origen_id', v_caja, 'cuenta_destino_id', v_cg,
                      'motivo', v_motivo),
   v_fri.fecha_cierre, v_fri.cerrada_por);

  -- 2i. Las filas de los dos turnos.
  update public.turnos_caja
     set fecha_cierre      = v_fri_cierre,
         monto_declarado   = v_x,
         monto_final       = v_x,
         efectivo_esperado = v_x,
         diferencia        = 0,
         observacion_cierre = concat_ws(' ', observacion_cierre,
           '[Cierre reconstruido 28/9/2026, SIN CONTEO: se cerró el 26/9 08:38 con ventas del sábado adentro. El conteo real (300.500) pasó al turno del sábado.]')
   where negocio_id = v_neg and id = v_fri.id;

  -- Esperado del sábado con la regla de siempre: fondo + cobros en efectivo
  -- (anulados incluidos) − egresos + transferencias/ingresos del ledger.
  select v_x
         + coalesce((select sum(vp.monto_bruto) from public.venta_pagos vp
                      where vp.negocio_id = v_neg and vp.turno_caja_id = v_sat.id
                        and vp.metodo_tipo = 'EFECTIVO'), 0)
         - coalesce((select sum(e.monto) from public.egresos e
                      where e.negocio_id = v_neg and e.turno_caja_id = v_sat.id
                        and e.cuenta_origen_id = v_caja), 0)
         + coalesce((select sum(m.importe) from public.movimientos_financieros m
                      where m.negocio_id = v_neg and m.turno_caja_id = v_sat.id
                        and m.cuenta_financiera_id = v_caja
                        and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO')), 0)
    into v_esperado_sat;
  if abs(v_esperado_sat - 212212.7) > 0.01 then
    raise exception 'GUARD: esperado del sábado = % (se esperaba 212.212,70)', v_esperado_sat;
  end if;

  update public.turnos_caja
     set efectivo_esperado = v_esperado_sat,
         diferencia        = monto_declarado - v_esperado_sat
   where negocio_id = v_neg and id = v_sat.id;

  -- ───────────────────────────────────────────────────────────────────────
  -- GUARDS FINALES
  -- ───────────────────────────────────────────────────────────────────────

  -- Los tres turnos cerrados quedan en cero en el ledger.
  for r in
    select t.id, coalesce(sum(m.importe), 0) as saldo
      from public.turnos_caja t
      left join public.movimientos_financieros m
        on m.negocio_id = t.negocio_id and m.turno_caja_id = t.id
       and m.cuenta_financiera_id = t.cuenta_financiera_id
     where t.id in (v_thu.id, v_fri.id, v_sat.id)
     group by t.id
  loop
    if abs(r.saldo) > 0.001 then
      raise exception 'GUARD: el turno % quedó con saldo % en el ledger', r.id, r.saldo;
    end if;
  end loop;

  -- Ni la caja diaria ni la Caja Grande cambian de saldo.
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió el saldo de la caja diaria';
  end if;
  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_cg) <> v_cg_antes then
    raise exception 'GUARD: cambió el saldo de la Caja Grande';
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

  -- Ningún cobro fuera del horario de su turno.
  if exists (
    select 1 from public.venta_pagos vp
      join public.turnos_caja t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_neg and t.id in (v_thu.id, v_fri.id, v_sat.id)
       and (vp.creado_en < t.fecha_apertura or vp.creado_en > t.fecha_cierre)
  ) then
    raise exception 'GUARD: quedó un cobro fuera del horario de su turno';
  end if;
end;
$corregir$;

alter table public.turnos_caja enable trigger trg_bloquear_edicion_turno_cerrado;

do $guard_trigger$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.turnos_caja'::regclass
       and tgname = 'trg_bloquear_edicion_turno_cerrado'
       and tgenabled = 'O'
  ) then
    raise exception 'GUARD: trg_bloquear_edicion_turno_cerrado no quedó activo';
  end if;
end;
$guard_trigger$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. resumen_financiero_periodo: sobrantes y faltantes NETOS por turno
--
-- Antes sumaba fila por fila `AJUSTE_ARQUEO`. Con una reversa de por medio
-- eso cuenta el ajuste dos veces (la fila original en su día y la re-emitida
-- en el nuevo). Ahora agrupa por turno las filas de ajuste y sus reversas
-- (`CORRECCION_REVERSA` con `evento_corregido = AJUSTE_ARQUEO`) dentro del
-- período, y clasifica el NETO. Sin correcciones da exactamente lo mismo que
-- antes: cada turno tiene un solo ajuste.
--
-- Parche sobre el cuerpo VIVO con regex tolerante a espacios y guard de
-- "exactamente una vez", mismo método que 20260922100000.
-- ─────────────────────────────────────────────────────────────────────────

do $parche$
declare
  v_oid oid;
  v_def text;
  v_patron constant text :=
    'from\s+public\.movimientos_financieros\s+m\s+where\s+m\.negocio_id\s*=\s*v_negocio\s+and\s+m\.origen_tipo\s*=\s*''TURNO_CAJA''\s+and\s+m\.evento\s*=\s*''AJUSTE_ARQUEO''\s+and\s+m\.fecha_movimiento\s*>=\s*v_ini\s+and\s+m\.fecha_movimiento\s*<\s*v_fin';
  v_nuevo constant text :=
    'from (select mm.origen_id, sum(mm.importe) as importe
              from public.movimientos_financieros mm
             where mm.negocio_id = v_negocio
               and mm.origen_tipo = ''TURNO_CAJA''
               and (mm.evento = ''AJUSTE_ARQUEO''
                    or (mm.evento = ''CORRECCION_REVERSA''
                        and mm.datos->>''evento_corregido'' = ''AJUSTE_ARQUEO''))
               and mm.fecha_movimiento >= v_ini and mm.fecha_movimiento < v_fin
             group by mm.origen_id) m';
  v_veces int;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resumen_financiero_periodo';
  if v_oid is null then
    raise exception 'GUARD: no existe resumen_financiero_periodo';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if v_def like '%evento_corregido%' then
    return;  -- ya parcheada
  end if;

  select count(*) into v_veces from regexp_matches(v_def, v_patron, 'g');
  if v_veces <> 1 then
    raise exception 'GUARD: resumen_financiero_periodo tiene % veces el bloque de arqueo (se esperaba 1)', v_veces;
  end if;

  execute regexp_replace(v_def, v_patron, v_nuevo);

  if pg_get_functiondef(v_oid) not like '%evento_corregido%' then
    raise exception 'GUARD: el parche de resumen_financiero_periodo no quedó aplicado';
  end if;
end;
$parche$;

commit;
