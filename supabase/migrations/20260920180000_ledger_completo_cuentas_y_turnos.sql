-- El ledger deja de mentir: las cuentas de los medios digitales y el paso del
-- turno por el cajón.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ HIZO FALTA
--
-- `20260919180000` (Etapa 7) hizo que la pestaña Dinero leyera el ledger, y al
-- aplicarla el 20/9/2026 quedó a la vista que el ledger estaba incompleto. En
-- Evens mostraba **$19.985.473 por acreditar contra $687.182 reales** y
-- **$15.343.079 en la caja diaria contra $163.800 reales**. Dos omisiones
-- distintas, las dos por lo mismo: faltaban las SALIDAS.
--
-- 1. **POR_ACREDITAR no se drenaba.** `cuenta_actual_venta_pago` manda el cobro
--    directo a su cuenta cuando `acreditacion_dias = 0` Y el método tiene
--    `cuenta_destino_id`. De los 30 métodos no-efectivo del SaaS, **ninguno**
--    tenía cuenta, así que TODO caía al puente y se quedaba ahí para siempre.
--    Medido: de los $19,9M del puente de Evens, **$17.453.805 (87%) son
--    TRANSFERENCIA MERCADO PAGO con acreditación en 0 días** — plata que cae en
--    el acto y que nunca debió pasar por un puente. En todo el SaaS son $27,0M
--    de cobros inmediatos contra $4,4M de diferidos, que sí son plata en
--    camino de verdad.
-- 2. **Abrir y cerrar un turno no emitía ningún movimiento.** La bitácora se
--    escribe con triggers sobre `venta_pagos` y `egresos`, así que entraban las
--    ventas y salían los egresos, pero la plata que la cajera cuenta y entrega
--    al cerrar no salía nunca. La caja diaria acumulaba las ventas en efectivo
--    de toda la vida ($15.525.229 en Evens) menos los egresos ($667.150).
--
-- ─────────────────────────────────────────────────────────────────────────
-- LAS CUENTAS NO SE INVENTAN: SE LLAMAN COMO EL MÉTODO
--
-- `20260919120000` se negó a crear cuentas BANCO o BILLETERA ficticias porque
-- "necesitan nombre y realidad operativa del comercio". Sigue valiendo, y por
-- eso acá **no se inventa ningún nombre**: cada cuenta se llama como el método
-- de pago que el comercio ya había nombrado. "TRANSFERENCIA MERCADO PAGO" pasa
-- a ser una BILLETERA con ese nombre; "TARJETA SANTA FE", un BANCO. El comercio
-- puede renombrarlas o fusionarlas desde el panel de cuentas, que ya existe.
--
-- El tipo sale del tipo del método: BILLETERA_VIRTUAL → BILLETERA, y
-- TRANSFERENCIA y TARJETA → BANCO, porque ahí es donde esa plata termina
-- cayendo. Es un punto de partida editable, no una afirmación.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL TURNO, EN TRES MOVIMIENTOS
--
--   APERTURA_TURNO  + monto_inicial      (el fondo que se pone en el cajón)
--   ... ventas, egresos y transferencias, que ya se registraban ...
--   AJUSTE_ARQUEO   ± (declarado − saldo del turno según el ledger)
--   CIERRE_TURNO    − declarado          (la plata se cuenta y se retira)
--
-- Después de cerrar, el saldo del turno queda en CERO. El invariante que tiene
-- que cumplirse siempre, y que esta migración verifica antes de commitear:
-- **el saldo de CAJA_DIARIA es igual a la suma del esperado de los turnos
-- ABIERTOS**, que es exactamente lo que dice `posicion_dinero`.
--
-- El faltante o el sobrante va como movimiento PROPIO y con
-- `impacto_resultado`, en vez de esconderse dentro del cierre: una diferencia
-- de arqueo es plata que se perdió o que apareció, y el ledger tiene que poder
-- decir cuánta. El saldo del turno se calcula DESDE EL LEDGER y no desde
-- `turnos_caja.efectivo_esperado`, que es una foto congelada y que —como
-- descubrió `20260920160000`— estaba mal en 17 turnos.
--
-- El único turno cerrado sin `monto_declarado` se cierra por su saldo y SIN
-- ajuste: nadie contó esa caja, y un faltante inventado es peor que un dato
-- que falta.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LOS EVENTOS NUEVOS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.movimientos_financieros
  drop constraint movimientos_financieros_origen_tipo_check,
  add constraint movimientos_financieros_origen_tipo_check
    check (origen_tipo in ('VENTA_PAGO','EGRESO','TRANSFERENCIA','ACREDITACION','TURNO_CAJA'));

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
      'CORRECCION_HISTORICA'
    ));

-- ─────────────────────────────────────────────────────────────────────────
-- 2. UNA CUENTA POR MÉTODO DIGITAL
-- ─────────────────────────────────────────────────────────────────────────

with nuevas as (
  insert into public.cuentas_financieras (
    negocio_id, codigo, nombre, tipo, es_efectivo, requiere_arqueo,
    es_sistema, activa
  )
  select
    m.negocio_id,
    -- El código es identidad interna, no se muestra. El sufijo evita chocar
    -- con otra cuenta del mismo comercio que ya se llame parecido.
    upper(left(regexp_replace(m.nombre, '[^a-zA-Z0-9]+', '_', 'g'), 24))
      || '_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    m.nombre,
    case m.tipo when 'BILLETERA_VIRTUAL' then 'BILLETERA' else 'BANCO' end,
    false, false, false, true
  from public.metodos_pago m
  where m.tipo <> 'EFECTIVO'
    and m.cuenta_destino_id is null
    and m.negocio_id is not null
  returning id, negocio_id, nombre
)
update public.metodos_pago m
   set cuenta_destino_id = n.id
  from nuevas n
 where m.negocio_id = n.negocio_id
   and m.nombre = n.nombre
   and m.tipo <> 'EFECTIVO'
   and m.cuenta_destino_id is null;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. LOS COBROS INMEDIATOS SALEN DEL PUENTE
--
-- No se escriben movimientos a mano: se toca `venta_pagos.cuenta_destino_id` y
-- el trigger de la bitácora hace lo suyo (CORRECCION_REVERSA en el puente,
-- CORRECCION_APLICADA en la cuenta real). Duplicar acá esa lógica sería tener
-- dos versiones de la misma regla, que es como se desincronizan.
--
-- SOLO los de `acreditacion_dias = 0`. Para un cobro diferido la cuenta actual
-- sigue siendo el puente, así que tocarlo escribiría un par de movimientos que
-- se cancelan entre sí: ruido en una tabla append-only.
--
-- La fecha del movimiento es HOY y no la del cobro, y está bien: hoy es cuando
-- el comercio pasó a tener esa cuenta. El snapshot del cobro viaja en `datos`.
-- ─────────────────────────────────────────────────────────────────────────

-- OJO: no alcanza con tocar la fila para que el trigger la complete.
-- `trg_venta_pagos_asignar_cuenta` es BEFORE INSERT OR UPDATE **OF
-- metodo_pago_id, metodo_tipo**, asi que un update que solo toca
-- `cuenta_destino_id` no lo despierta: la primera version de esta migracion
-- hacia `set cuenta_destino_id = null` y salio no-op silencioso, old = new =
-- null, `v_cambio` en false y cero movimientos. El valor se escribe a mano.
update public.venta_pagos vp
   set cuenta_destino_id = m.cuenta_destino_id
  from public.metodos_pago m
 where m.id = vp.metodo_pago_id
   and m.negocio_id = vp.negocio_id
   and m.cuenta_destino_id is not null
   and vp.metodo_tipo <> 'EFECTIVO'
   and coalesce(vp.acreditacion_dias, 0) = 0
   and vp.cuenta_destino_id is null
   and vp.negocio_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 3bis. EL LEDGER TENÍA EL MISMO BUG QUE EL ARQUEO
--
-- `20260920160000` arregló que el efectivo del turno se descontara dos veces
-- al anular una venta. La bitácora financiera tenía exactamente el mismo error,
-- por el otro camino: al pasar el cobro a ANULADO emitía una reversa de
-- `-importe` sobre la cuenta, y el egreso de la devolución restaba otra vez.
--
-- La regla que queda es la misma de `posicion_dinero`, y por eso el comentario
-- adentro de la función la repite: en EFECTIVO la salida ya la representa el
-- egreso; en digital no hay egreso, así que la reversa es la única forma de
-- decir que el banco dio marcha atrás —salvo que el reintegro haya salido por
-- otro medio, donde el banco no revirtió nada.
--
-- Una CORRECCIÓN (cambiar el medio o el monto de un cobro) sigue revirtiendo
-- siempre: ahí el cobro viejo deja de existir tal como estaba, que es otra cosa.
--
-- Reescrita desde el cuerpo VIVO, que es la regla de `20260904140000`.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_bitacora_venta_pago()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $
declare
  v_operacion     uuid := gen_random_uuid();
  v_cuenta_old    uuid;
  v_cuenta_new    uuid;
  v_importe_old   numeric;
  v_importe_new   numeric;
  v_cambio        boolean;
  v_reversa       numeric;
begin
  if tg_op = 'INSERT' then
    v_cuenta_new := public.cuenta_actual_venta_pago(
      new.negocio_id,
      new.metodo_tipo,
      new.acreditacion_dias,
      new.cuenta_destino_id
    );
    v_importe_new := public.importe_financiero_venta_pago(
      new.metodo_tipo, new.monto_bruto, new.monto_neto
    );

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then 'REGISTRO' else 'REGISTRO_ANULADO' end,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then v_importe_new else 0 end,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then -new.comision_monto else 0 end,
      new.turno_caja_id,
      format('Cobro por %s', new.metodo_nombre),
      public.snapshot_financiero_venta_pago(new),
      new.creado_en,
      auth.uid()
    );

    return new;
  end if;

  if tg_op = 'DELETE' then
    v_cuenta_old := public.cuenta_actual_venta_pago(
      old.negocio_id,
      old.metodo_tipo,
      old.acreditacion_dias,
      old.cuenta_destino_id
    );
    v_importe_old := public.importe_financiero_venta_pago(
      old.metodo_tipo, old.monto_bruto, old.monto_neto
    );

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, old.negocio_id, v_cuenta_old,
      'VENTA_PAGO', old.id, 'ELIMINACION_REVERSA',
      case when old.estado_pago_operacion = 'CONFIRMADO'
        then -v_importe_old else 0 end,
      case when old.estado_pago_operacion = 'CONFIRMADO'
        then old.comision_monto else 0 end,
      old.turno_caja_id,
      format('Eliminacion de cobro por %s', old.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old)
      ),
      now(),
      auth.uid()
    );

    return old;
  end if;

  v_cambio := row(
    old.estado_pago_operacion,
    old.metodo_pago_id,
    old.metodo_nombre,
    old.metodo_tipo,
    old.monto_base,
    old.recargo_monto,
    old.monto_bruto,
    old.comision_monto,
    old.monto_neto,
    old.acreditacion_dias,
    old.cuenta_destino_id,
    old.turno_caja_id
  ) is distinct from row(
    new.estado_pago_operacion,
    new.metodo_pago_id,
    new.metodo_nombre,
    new.metodo_tipo,
    new.monto_base,
    new.recargo_monto,
    new.monto_bruto,
    new.comision_monto,
    new.monto_neto,
    new.acreditacion_dias,
    new.cuenta_destino_id,
    new.turno_caja_id
  );

  if not v_cambio then
    return new;
  end if;

  v_cuenta_old := public.cuenta_actual_venta_pago(
    old.negocio_id,
    old.metodo_tipo,
    old.acreditacion_dias,
    old.cuenta_destino_id
  );
  v_cuenta_new := public.cuenta_actual_venta_pago(
    new.negocio_id,
    new.metodo_tipo,
    new.acreditacion_dias,
    new.cuenta_destino_id
  );
  v_importe_old := public.importe_financiero_venta_pago(
    old.metodo_tipo, old.monto_bruto, old.monto_neto
  );
  v_importe_new := public.importe_financiero_venta_pago(
    new.metodo_tipo, new.monto_bruto, new.monto_neto
  );

  -- LA REVERSA DE UNA ANULACION NO ES CIEGA AL MEDIO (20260920180000).
  -- Misma regla que posicion_dinero: el flujo no mira si la venta se anulo,
  -- mira los movimientos.
  --   EFECTIVO: la plata entro al cajon y sale por el EGRESO de la
  --             devolucion. Revertir ademas el cobro la descuenta dos veces.
  --   DIGITAL:  no hay egreso, asi que la reversa ES la unica forma de
  --             representar que el banco dio marcha atras. Salvo que el
  --             reintegro haya salido por OTRO medio: ahi el banco no
  --             reverso nada y ese cobro sigue viniendo.
  -- Una CORRECCION (cambio de medio o de monto) siempre revierte: ahi el
  -- cobro viejo deja de existir tal como estaba.
  if new.estado_pago_operacion = 'ANULADO'
     and old.estado_pago_operacion = 'CONFIRMADO' then
    if old.metodo_tipo = 'EFECTIVO' then
      v_reversa := 0;
    elsif exists (
      select 1 from public.ventas v
       where v.id = old.venta_id
         and v.negocio_id = old.negocio_id
         and v.reintegro_metodo_id is not null
         and v.reintegro_metodo_id is distinct from old.metodo_pago_id
    ) then
      v_reversa := 0;
    else
      v_reversa := -v_importe_old;
    end if;
  else
    v_reversa := -v_importe_old;
  end if;

  if old.estado_pago_operacion = 'CONFIRMADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, old.negocio_id, v_cuenta_old,
      'VENTA_PAGO', old.id,
      case when new.estado_pago_operacion = 'ANULADO'
        then 'ANULACION' else 'CORRECCION_REVERSA' end,
      v_reversa,
      -- Si no se revierte la plata tampoco se recupera la comision: el banco
      -- se la quedo igual.
      case when v_reversa = 0 then 0 else old.comision_monto end,
      old.turno_caja_id,
      format('Reversa de cobro por %s', old.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  end if;

  if new.estado_pago_operacion = 'CONFIRMADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id,
      case when old.estado_pago_operacion = 'ANULADO'
        then 'REACTIVACION' else 'CORRECCION_APLICADA' end,
      v_importe_new,
      -new.comision_monto,
      new.turno_caja_id,
      format('Cobro corregido por %s', new.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  elsif old.estado_pago_operacion = 'ANULADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id, 'CORRECCION_SIN_IMPACTO', 0, 0,
      new.turno_caja_id,
      'Correccion sobre cobro anulado',
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  end if;

  return new;
end;
$;

revoke all on function public.registrar_bitacora_venta_pago() from public;

-- El único movimiento histórico afectado: una anulación en efectivo de El Nono
-- Cacho por $5.997 que el ledger ya había restado dos veces. Se compensa en vez
-- de corregirse porque la tabla es append-only por diseño (hay un trigger que
-- impide UPDATE y DELETE). Las otras dos ANULACION del ledger son digitales y
-- con reintegro por el mismo medio: bajo la regla nueva siguen siendo correctas.
insert into public.movimientos_financieros (
  negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
  importe, impacto_resultado, turno_caja_id, descripcion, datos,
  fecha_movimiento, registrado_por
)
select m.negocio_id, m.cuenta_financiera_id, m.origen_tipo, m.origen_id,
       'CORRECCION_HISTORICA', -m.importe, -m.impacto_resultado, m.turno_caja_id,
       'Reversa de anulacion en efectivo que el egreso ya representaba',
       jsonb_build_object('compensa_evento_id', m.evento_id, 'migracion', '20260920180000'),
       now(), null
  from public.movimientos_financieros m
  join public.venta_pagos vp on vp.id = m.origen_id
where m.origen_tipo = 'VENTA_PAGO'
  and m.evento = 'ANULACION'
  and vp.metodo_tipo = 'EFECTIVO';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. EL TURNO ENTRA AL LEDGER
--
-- Por TRIGGER y no por una llamada dentro de `cerrarCajaAction`, mismo criterio
-- que `movimientos_stock`: un camino que se olvida de registrar es un agujero
-- que se descubre meses después con los números ya mal. Con trigger no hay
-- camino que lo saltee.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_bitacora_turno_caja()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_saldo numeric;
  v_declarado numeric;
  v_retiro numeric;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.monto_inicial, 0) <> 0 and new.cuenta_financiera_id is not null then
      insert into public.movimientos_financieros (
        negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion,
        fecha_movimiento, registrado_por
      ) values (
        new.negocio_id, new.cuenta_financiera_id, 'TURNO_CAJA', new.id,
        'APERTURA_TURNO', new.monto_inicial, 0, new.id,
        'Fondo inicial del turno', new.fecha_apertura, new.vendedor_id
      );
    end if;
    return new;
  end if;

  -- Solo el paso a CERRADO. Un turno ya cerrado es inmutable
  -- (`bloquear_edicion_turno_cerrado`), así que esto corre una sola vez.
  if old.estado = 'CERRADO' or new.estado <> 'CERRADO'
     or new.cuenta_financiera_id is null then
    return new;
  end if;

  -- El saldo sale del LEDGER, no de `efectivo_esperado`: esa columna es una
  -- foto congelada, y estuvo mal en 17 turnos hasta `20260920160000`.
  select coalesce(sum(m.importe), 0) into v_saldo
    from public.movimientos_financieros m
   where m.negocio_id = new.negocio_id
     and m.turno_caja_id = new.id
     and m.cuenta_financiera_id = new.cuenta_financiera_id;

  v_declarado := new.monto_declarado;

  if v_declarado is not null and v_declarado - v_saldo <> 0 then
    insert into public.movimientos_financieros (
      negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      new.negocio_id, new.cuenta_financiera_id, 'TURNO_CAJA', new.id,
      'AJUSTE_ARQUEO', v_declarado - v_saldo, v_declarado - v_saldo, new.id,
      case when v_declarado > v_saldo then 'Sobrante de arqueo'
           else 'Faltante de arqueo' end,
      jsonb_build_object('esperado_ledger', v_saldo, 'declarado', v_declarado),
      coalesce(new.fecha_cierre, now()), new.cerrada_por
    );
  end if;

  -- Sin declarado no se sabe cuánto se contó: se retira el saldo y no se
  -- inventa ningún ajuste.
  v_retiro := coalesce(v_declarado, v_saldo);

  if v_retiro <> 0 then
    insert into public.movimientos_financieros (
      negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      new.negocio_id, new.cuenta_financiera_id, 'TURNO_CAJA', new.id,
      'CIERRE_TURNO', -v_retiro, 0, new.id,
      'Retiro del efectivo al cerrar el turno',
      jsonb_build_object('declarado', v_declarado, 'esperado_ledger', v_saldo),
      coalesce(new.fecha_cierre, now()), new.cerrada_por
    );
  end if;

  return new;
end;
$$;

revoke all on function public.registrar_bitacora_turno_caja() from public;

-- AFTER, para que corra detrás de `bloquear_edicion_turno_cerrado`.
drop trigger if exists trg_turnos_caja_bitacora_financiera on public.turnos_caja;
create trigger trg_turnos_caja_bitacora_financiera
  after insert or update on public.turnos_caja
  for each row execute function public.registrar_bitacora_turno_caja();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. BACKFILL DE LOS 304 TURNOS
--
-- En orden cronológico, porque el saldo de cada cierre se calcula sobre los
-- movimientos ya escritos de ESE turno (incluida su apertura).
-- ─────────────────────────────────────────────────────────────────────────

do $backfill$
declare
  t record;
  v_saldo numeric;
  v_declarado numeric;
  v_retiro numeric;
begin
  for t in
    select * from public.turnos_caja
     where cuenta_financiera_id is not null
     order by fecha_apertura, id
  loop
    if coalesce(t.monto_inicial, 0) <> 0 then
      insert into public.movimientos_financieros (
        negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion,
        fecha_movimiento, registrado_por
      ) values (
        t.negocio_id, t.cuenta_financiera_id, 'TURNO_CAJA', t.id,
        'APERTURA_TURNO', t.monto_inicial, 0, t.id,
        'Fondo inicial del turno', t.fecha_apertura, t.vendedor_id
      );
    end if;

    if t.estado <> 'CERRADO' then
      continue;
    end if;

    select coalesce(sum(m.importe), 0) into v_saldo
      from public.movimientos_financieros m
     where m.negocio_id = t.negocio_id
       and m.turno_caja_id = t.id
       and m.cuenta_financiera_id = t.cuenta_financiera_id;

    v_declarado := t.monto_declarado;

    if v_declarado is not null and v_declarado - v_saldo <> 0 then
      insert into public.movimientos_financieros (
        negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion, datos,
        fecha_movimiento, registrado_por
      ) values (
        t.negocio_id, t.cuenta_financiera_id, 'TURNO_CAJA', t.id,
        'AJUSTE_ARQUEO', v_declarado - v_saldo, v_declarado - v_saldo, t.id,
        case when v_declarado > v_saldo then 'Sobrante de arqueo'
             else 'Faltante de arqueo' end,
        jsonb_build_object('esperado_ledger', v_saldo, 'declarado', v_declarado,
                           'backfill', true),
        coalesce(t.fecha_cierre, t.fecha_apertura), t.cerrada_por
      );
    end if;

    v_retiro := coalesce(v_declarado, v_saldo);

    if v_retiro <> 0 then
      insert into public.movimientos_financieros (
        negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion, datos,
        fecha_movimiento, registrado_por
      ) values (
        t.negocio_id, t.cuenta_financiera_id, 'TURNO_CAJA', t.id,
        'CIERRE_TURNO', -v_retiro, 0, t.id,
        'Retiro del efectivo al cerrar el turno',
        jsonb_build_object('declarado', v_declarado, 'esperado_ledger', v_saldo,
                           'backfill', true),
        coalesce(t.fecha_cierre, t.fecha_apertura), t.cerrada_por
      );
    end if;
  end loop;
end;
$backfill$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. EL INVARIANTE
--
-- No es un guard de forma: es el número. Si el saldo de la caja diaria de
-- cualquier negocio no coincide con la suma del esperado de sus turnos
-- abiertos, el ledger volvió a decir una cosa distinta que `posicion_dinero` y
-- la migración no se aplica.
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  r record;
begin
  for r in
    select n.nombre,
           c.id cuenta_id,
           coalesce((select sum(m.importe) from public.movimientos_financieros m
                      where m.cuenta_financiera_id = c.id), 0) saldo_ledger,
           coalesce((select sum(
               t.monto_inicial
               + coalesce((select sum(vp.monto_bruto) from public.venta_pagos vp
                            where vp.negocio_id = t.negocio_id
                              and vp.turno_caja_id = t.id
                              and vp.metodo_tipo = 'EFECTIVO'), 0)
               - coalesce((select sum(e.monto) from public.egresos e
                            where e.negocio_id = t.negocio_id
                              and e.turno_caja_id = t.id
                              and e.cuenta_origen_id = t.cuenta_financiera_id), 0)
               + coalesce((select sum(mf.importe) from public.movimientos_financieros mf
                            where mf.negocio_id = t.negocio_id
                              and mf.turno_caja_id = t.id
                              and mf.cuenta_financiera_id = t.cuenta_financiera_id
                              and mf.origen_tipo = 'TRANSFERENCIA'), 0)
             ) from public.turnos_caja t
              where t.negocio_id = c.negocio_id
                and t.cuenta_financiera_id = c.id
                and t.estado <> 'CERRADO'), 0) esperado_abiertos
      from public.cuentas_financieras c
      join public.negocios n on n.id = c.negocio_id
     where c.codigo = 'CAJA_DIARIA'
  loop
    if abs(r.saldo_ledger - r.esperado_abiertos) > 0.01 then
      raise exception
        'GUARD: la caja diaria de % no cierra contra los turnos abiertos (ledger %, esperado %)',
        r.nombre, r.saldo_ledger, r.esperado_abiertos;
    end if;
  end loop;

  if exists (
    select 1 from public.metodos_pago
     where tipo <> 'EFECTIVO' and cuenta_destino_id is null and negocio_id is not null
  ) then
    raise exception 'GUARD: quedo un metodo de pago digital sin cuenta destino';
  end if;
end;
$guard$;

commit;
