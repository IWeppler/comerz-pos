-- Evens: los dos cobros de cuenta corriente duplicados del 21/7/2026.
--
-- Eran los ÚNICOS saldos a favor del SaaS, y los dos salieron de registrar el
-- mismo cobro dos veces (sin idempotencia ni tope; ver 20260928210000):
--
--   SILVINA RODRIGUEZ  $10.350 Efectivo                    14:35:44 y 14:35:58
--   ROCIO CEJAS        $21.850 TRANSFERENCIA MERCADO PAGO  13:20:34 y 14:02:20
--
-- En los dos el primer cobro ya saldaba la deuda entera ($10.350 y $21.850 de
-- saldo inicial importado por CSV), así que el libro quedó en −monto y el caché
-- en $0. Decidido con el dueño (Ignacio, 28/9/2026): son registros
-- duplicados, la plata entró UNA vez. Se elimina el SEGUNDO cobro de cada par.
--
-- Qué se escribe, y por qué así:
--
-- 1. El CRÉDITO de cuenta corriente del duplicado queda ANULADO (no se borra)
--    y dice por qué: al borrar el cobro, `pago_id` pasa a null por la FK
--    ON DELETE SET NULL, y sin el texto no se sabría de dónde salió. El libro
--    de las dos vuelve a $0 = caché.
--
-- 2. El cobro (`venta_pagos`) se BORRA. Marcarlo ANULADO no alcanza: el arqueo
--    cuenta los cobros en efectivo anulados incluidos (20260920160000, porque
--    la salida la representa el egreso de la devolución), y acá no hubo
--    devolución — el cobro nunca existió. Es el mismo criterio que
--    `anular_egreso`: borrar hace que todos los consumidores dejen de contarlo.
--    La bitácora sí queda: se escribe a mano la ELIMINACION_REVERSA con el
--    trigger apagado, para fecharla el 21/7 (el día del cobro) y no hoy — si
--    no, la corrección de julio caería en septiembre. Mismo criterio que las
--    correcciones de egreso de 20260921180000.
--
-- 3. SILVINA, efectivo, turno cerrado y firmado. Ese turno cerró con esperado
--    = declarado = $105.550, que incluía el duplicado. Sin él el esperado es
--    $95.200 contra $105.550 declarados: un SOBRANTE de $10.350. No se toca
--    el cierre firmado (`turnos_caja.efectivo_esperado` / `diferencia` son lo
--    que la cajera vio y firmó; el historial lo muestra como AJUSTADO con
--    `efectivo_esperado_actual`). En el ledger el turno tiene que seguir
--    sumando cero, así que entra un AJUSTE_ARQUEO de +$10.350 fechado en el
--    cierre, con `impacto_resultado`: es lo que el sistema dice de cualquier
--    sobrante. La caja diaria no cambia de saldo.
--
-- 4. ROCIO, Mercado Pago. Su turno no se entera (el arqueo es solo efectivo).
--    La billetera TRANSFERENCIA MERCADO PAGO baja $21.850: esa plata no entró.

begin;

alter table public.venta_pagos disable trigger trg_venta_pagos_bitacora_financiera;

do $duplicados$
declare
  v_neg    constant uuid := '44468525-8381-4c83-a558-eb7209e386b5';
  v_motivo constant text :=
    'Cobro de cuenta corriente registrado dos veces el 21/7/2026 (sin idempotencia). Eliminado el 28/9/2026 por decisión del dueño';
  v_dup_silvina constant uuid := 'ba2a8998-d4e7-48c2-98b7-ac83ba5f5d71';
  v_dup_rocio   constant uuid := '1c94dc42-ff30-4f7f-b964-559030f6ca9a';
  v_turno_silvina constant uuid := '7484508a-1312-4d58-af0e-439038cfcdd7';

  v_pago   public.venta_pagos%rowtype;
  v_turno  public.turnos_caja%rowtype;
  v_cuenta uuid;
  v_neto   numeric;
  v_caja   uuid;
  v_mp     uuid;
  v_caja_antes numeric;
  v_mp_antes   numeric;
  v_res_antes  numeric;
  v_cliente    record;
begin
  if not exists (select 1 from public.negocios where id = v_neg) then
    raise notice '20260928220000: Evens no existe en esta base; nada que hacer';
    return;
  end if;

  select id into v_caja from public.cuentas_financieras
   where negocio_id = v_neg and codigo = 'CAJA_DIARIA';

  -- GUARD: los dos cobros están como se midieron.
  if (select count(*) from public.venta_pagos vp join public.clientes c on c.id = vp.cliente_id
       where vp.negocio_id = v_neg and vp.tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'
         and vp.estado_pago_operacion = 'CONFIRMADO'
         and ((vp.id = v_dup_silvina and c.nombre = 'SILVINA RODRIGUEZ' and vp.monto_base = 10350 and vp.metodo_tipo = 'EFECTIVO')
           or (vp.id = v_dup_rocio and c.nombre = 'ROCIO CEJAS' and vp.monto_base = 21850 and vp.metodo_nombre = 'TRANSFERENCIA MERCADO PAGO'))) <> 2 then
    raise exception 'GUARD: los cobros duplicados no están como se midieron';
  end if;

  -- GUARD: cada una tiene EXACTAMENTE dos cobros iguales ese día, y el libro
  -- está en −monto con el caché en 0.
  for v_cliente in
    select c.id, c.nombre, c.saldo_pendiente,
           (select coalesce(sum(case when m.tipo = 'DEBITO' then m.monto else -m.monto end), 0)
              from public.cuenta_corriente_movimientos m
             where m.cliente_id = c.id and not m.anulado) as libro,
           (select count(*) from public.venta_pagos vp
             where vp.cliente_id = c.id and vp.tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'
               and vp.estado_pago_operacion = 'CONFIRMADO') as cobros
      from public.clientes c
     where c.negocio_id = v_neg and c.nombre in ('SILVINA RODRIGUEZ', 'ROCIO CEJAS')
  loop
    if v_cliente.cobros <> 2 or v_cliente.saldo_pendiente <> 0
       or v_cliente.libro not in (-10350, -21850) then
      raise exception 'GUARD: % no está como se midió (cobros %, caché %, libro %)',
        v_cliente.nombre, v_cliente.cobros, v_cliente.saldo_pendiente, v_cliente.libro;
    end if;
  end loop;

  -- La cuenta donde el ledger tiene hoy el cobro de Rocío (la billetera).
  select m.cuenta_financiera_id into v_mp
    from public.movimientos_financieros m
   where m.origen_id = v_dup_rocio
   group by m.cuenta_financiera_id
  having sum(m.importe) <> 0;

  select coalesce(sum(importe), 0) into v_caja_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_caja;
  select coalesce(sum(importe), 0) into v_mp_antes from public.movimientos_financieros
   where negocio_id = v_neg and cuenta_financiera_id = v_mp;
  select coalesce(sum(impacto_resultado), 0) into v_res_antes from public.movimientos_financieros
   where negocio_id = v_neg;

  -- 1 y 2. Por cada duplicado: anular el crédito, reversa en el ledger, borrar.
  for v_pago in
    select * from public.venta_pagos
     where negocio_id = v_neg and id in (v_dup_silvina, v_dup_rocio)
  loop
    select m.cuenta_financiera_id, sum(m.importe) into v_cuenta, v_neto
      from public.movimientos_financieros m
     where m.negocio_id = v_neg and m.origen_id = v_pago.id
     group by m.cuenta_financiera_id
    having sum(m.importe) <> 0;

    if v_neto is distinct from v_pago.monto_bruto then
      raise exception 'GUARD: el ledger del cobro % suma % (se esperaba %)',
        v_pago.id, v_neto, v_pago.monto_bruto;
    end if;

    update public.cuenta_corriente_movimientos
       set anulado = true,
           anulado_en = now(),
           descripcion = descripcion || ' [ANULADO 28/9/2026: cobro duplicado del 21/7, la plata entró una sola vez]'
     where negocio_id = v_neg and pago_id = v_pago.id and tipo = 'CREDITO' and not anulado;
    if not found then
      raise exception 'GUARD: el cobro % no tenía crédito vivo', v_pago.id;
    end if;

    insert into public.movimientos_financieros (
      negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento
    ) values (
      v_neg, v_cuenta, 'VENTA_PAGO', v_pago.id, 'ELIMINACION_REVERSA',
      -v_neto, v_pago.comision_monto, v_pago.turno_caja_id,
      format('Eliminacion de cobro duplicado por %s', v_pago.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(v_pago),
        'motivo', v_motivo
      ),
      v_pago.creado_en
    );

    delete from public.venta_pagos where negocio_id = v_neg and id = v_pago.id;
  end loop;

  -- 3. El turno de Silvina: el sobrante que aparece al sacar el duplicado.
  select * into v_turno from public.turnos_caja
   where negocio_id = v_neg and id = v_turno_silvina and estado = 'CERRADO'
     and monto_declarado = 105550 and efectivo_esperado = 105550;
  if v_turno.id is null then
    raise exception 'GUARD: el turno de Silvina no está como se midió';
  end if;

  insert into public.movimientos_financieros (
    negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento
  ) values (
    v_neg, v_caja, 'TURNO_CAJA', v_turno.id, 'AJUSTE_ARQUEO',
    10350, 10350, v_turno.id,
    'Sobrante de arqueo (aparece al eliminar un cobro duplicado)',
    jsonb_build_object('motivo', v_motivo, 'cobro_eliminado', v_dup_silvina),
    v_turno.fecha_cierre
  );

  -- GUARDS
  if exists (
    select 1 from public.clientes c
     where c.negocio_id = v_neg and c.nombre in ('SILVINA RODRIGUEZ', 'ROCIO CEJAS')
       and (select coalesce(sum(case when m.tipo = 'DEBITO' then m.monto else -m.monto end), 0)
              from public.cuenta_corriente_movimientos m
             where m.cliente_id = c.id and not m.anulado) <> c.saldo_pendiente
  ) then
    raise exception 'GUARD: el libro de alguna de las dos no quedó igual al caché';
  end if;

  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja
         and turno_caja_id = v_turno_silvina) <> 0 then
    raise exception 'GUARD: el turno de Silvina no quedó en cero en el ledger';
  end if;

  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_caja) <> v_caja_antes then
    raise exception 'GUARD: cambió el saldo de la caja diaria';
  end if;

  if (select coalesce(sum(importe), 0) from public.movimientos_financieros
       where negocio_id = v_neg and cuenta_financiera_id = v_mp) <> v_mp_antes - 21850 then
    raise exception 'GUARD: la billetera no bajó exactamente $21.850';
  end if;

  if (select coalesce(sum(impacto_resultado), 0) from public.movimientos_financieros
       where negocio_id = v_neg) <> v_res_antes + 10350 then
    raise exception 'GUARD: el resultado no se movió exactamente por el sobrante';
  end if;

  if exists (select 1 from public.venta_pagos where id in (v_dup_silvina, v_dup_rocio)) then
    raise exception 'GUARD: quedó algún cobro duplicado';
  end if;
end;
$duplicados$;

alter table public.venta_pagos enable trigger trg_venta_pagos_bitacora_financiera;

do $guard_trigger$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_venta_pagos_bitacora_financiera'
                    and tgrelid = 'public.venta_pagos'::regclass
                    and tgenabled = 'O') then
    raise exception 'GUARD: la bitácora de venta_pagos no quedó activa';
  end if;
end;
$guard_trigger$;

commit;
