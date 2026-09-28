-- ---------------------------------------------------------------------------
-- Cobro de cuenta corriente en UNA transacción, idempotente y con tope.
--
-- POR QUÉ. `registrarPagoDeudaAction` escribía el cobro en cuatro pasos
-- sueltos desde Node: `venta_pagos` → DEBITO de mora → CREDITO → update de
-- `clientes.saldo_pendiente`. Tres agujeros, los tres medidos:
--
-- 1. SIN TOPE EN EL SERVER. El único freno era el `max` del input del modal
--    (y el modal del POS ni eso). Un cobro mayor a la deuda entraba entero a
--    la caja y al libro, y el `Math.max(0, ...)` del caché se comía el
--    excedente: el libro decía "a favor" y la pantalla decía $0.
-- 2. SIN IDEMPOTENCIA. Reintentar el mismo cobro lo registraba dos veces.
--    Los dos casos del SaaS son exactamente eso, y los dos de Evens el
--    21/7/2026: SILVINA RODRIGUEZ ($10.350 en efectivo, dos filas a 14
--    segundos) y ROCIO CEJAS ($21.850 por Mercado Pago, a 41 minutos). En los
--    dos el primer cobro ya saldaba la deuda entera, así que el tope solo
--    habría frenado el segundo.
-- 3. LEER Y DESPUÉS ESCRIBIR EL SALDO. El update calculaba el saldo nuevo en
--    Node a partir de una lectura previa: dos cobros simultáneos del mismo
--    cliente leían lo mismo y uno se perdía. Y si fallaba un paso intermedio
--    quedaba plata en la caja sin crédito en la cuenta, o al revés.
--
-- CÓMO.
-- * El `id` del cobro lo pone quien llama y la PK es la clave de
--   idempotencia: mismo patrón que la venta offline (`20260901120000`). Si el
--   id ya existe, vuelve `ya_registrado` como resultado normal, no como
--   excepción, y no se escribe nada.
-- * Row lock sobre el cliente ANTES de todo: serializa dos cobros del mismo
--   cliente, y el chequeo de idempotencia y el tope se hacen con el saldo ya
--   bloqueado. Un `select` previo sin lock no sirve (ver CLAUDE.md).
-- * El tope es contra el saldo RELEÍDO bajo lock + la mora de este cobro.
--   `COBRO_SUPERA_DEUDA` lleva en el detail JSON `deuda` y `monto`.
-- * El saldo se actualiza con delta en el mismo statement
--   (`saldo_pendiente + mora - monto`), SIN `greatest(0, ...)`: con el tope
--   no puede quedar negativo, y el recorte a cero es justamente lo que
--   escondía el excedente.
--
-- Lo que se queda en Node, a propósito: el recargo por método, la comisión y
-- la mora. Viven en TypeScript (`recargo-metodo.ts`,
-- `calcular-saldo-con-recargo.ts`) con sus tests, y duplicarlos acá haría una
-- segunda versión que se desincroniza. La función es SECURITY INVOKER, así
-- que no abre nada que la RLS no permita ya: quien la llama podía insertar
-- esas mismas filas directo en las tres tablas. Igual se validan los signos.
-- ---------------------------------------------------------------------------

create or replace function public.registrar_cobro_cc(
  p_pago jsonb,
  p_mora jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio      uuid := security.current_negocio_id();
  v_usuario      uuid := auth.uid();
  v_pago_id      uuid := nullif(p_pago->>'id', '')::uuid;
  v_cliente      uuid := nullif(p_pago->>'cliente_id', '')::uuid;
  v_monto        numeric := (p_pago->>'monto_base')::numeric;
  v_mora         numeric := coalesce((p_mora->>'monto')::numeric, 0);
  v_saldo        numeric;
  v_deuda        numeric;
  v_existente    public.venta_pagos%rowtype;
  v_saldo_nuevo  numeric;
  v_vencimiento  date;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if v_pago_id is null or v_cliente is null then
    raise exception 'COBRO_CC_DATOS_INVALIDOS';
  end if;

  if v_monto is null or v_monto <= 0 or v_mora < 0 then
    raise exception 'COBRO_CC_DATOS_INVALIDOS';
  end if;

  -- 1. Lock del cliente. Serializa dos cobros simultáneos del mismo cliente y
  -- deja el saldo quieto para el tope.
  select coalesce(c.saldo_pendiente, 0)
    into v_saldo
    from public.clientes c
   where c.id = v_cliente
     and c.negocio_id = v_negocio
     for update;

  if not found then
    raise exception 'CLIENTE_NO_ENCONTRADO';
  end if;

  -- 2. Idempotencia. Va DESPUÉS del lock: un reintento concurrente espera al
  -- primero y, cuando entra, ya ve su fila.
  select *
    into v_existente
    from public.venta_pagos vp
   where vp.id = v_pago_id;

  if found then
    return jsonb_build_object(
      'ya_registrado', true,
      'pago_id', v_existente.id,
      'monto_base', v_existente.monto_base,
      'saldo_actual', v_saldo
    );
  end if;

  -- 3. Tope. Lo que entra no puede ser más de lo que se debe, mora de este
  -- cobro incluida. El redondeo al centavo es para que "pagar todo" con la
  -- mora calculada en Node no falle por un decimal de más.
  v_deuda := round(v_saldo + v_mora, 2);
  if round(v_monto, 2) > v_deuda then
    raise exception 'COBRO_SUPERA_DEUDA'
      using detail = jsonb_build_object('deuda', v_deuda, 'monto', v_monto)::text;
  end if;

  -- 4. El cobro en caja. Mismos campos que escribía la action.
  insert into public.venta_pagos (
    id, negocio_id, cliente_id, turno_caja_id,
    metodo_pago_id, metodo_nombre, metodo_tipo,
    monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
    comision_porcentaje, comision_monto, monto_neto,
    acreditacion_dias, tipo_movimiento
  ) values (
    v_pago_id, v_negocio, v_cliente,
    nullif(p_pago->>'turno_caja_id', '')::uuid,
    nullif(p_pago->>'metodo_pago_id', '')::uuid,
    p_pago->>'metodo_nombre',
    p_pago->>'metodo_tipo',
    v_monto,
    coalesce((p_pago->>'recargo_porcentaje')::numeric, 0),
    coalesce((p_pago->>'recargo_monto')::numeric, 0),
    (p_pago->>'monto_bruto')::numeric,
    coalesce((p_pago->>'comision_porcentaje')::numeric, 0),
    coalesce((p_pago->>'comision_monto')::numeric, 0),
    (p_pago->>'monto_neto')::numeric,
    coalesce((p_pago->>'acreditacion_dias')::int, 0),
    'PAGO_CUENTA_CORRIENTE'
  );

  -- 5. La mora materializada como DEBITO propio, atada al cobro y al ticket
  -- que la generó. Va ANTES del crédito: primero se suma, después se paga.
  if v_mora > 0 then
    insert into public.cuenta_corriente_movimientos (
      negocio_id, cliente_id, pago_id, tipo, monto, descripcion, creado_por,
      debito_origen_id, origen_reconstruido
    ) values (
      v_negocio, v_cliente, v_pago_id, 'DEBITO', v_mora,
      p_mora->>'descripcion', v_usuario,
      nullif(p_mora->>'debito_origen_id', '')::uuid, false
    );
  end if;

  -- 6. El crédito, por la BASE (el recargo por método no amortiza deuda).
  insert into public.cuenta_corriente_movimientos (
    negocio_id, cliente_id, pago_id, tipo, monto, descripcion, creado_por
  ) values (
    v_negocio, v_cliente, v_pago_id, 'CREDITO', v_monto,
    p_pago->>'descripcion_cc', v_usuario
  );

  -- 7. El caché, con delta y en el mismo statement. El vencimiento lo resuelve
  -- la regla única, que ya ve la mora y el crédito recién escritos.
  update public.clientes c
     set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + v_mora - v_monto,
         fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)
   where c.id = v_cliente
     and c.negocio_id = v_negocio
  returning c.saldo_pendiente, c.fecha_vencimiento_deuda
    into v_saldo_nuevo, v_vencimiento;

  return jsonb_build_object(
    'ya_registrado', false,
    'pago_id', v_pago_id,
    'monto_base', v_monto,
    'saldo_anterior', v_saldo,
    'saldo_nuevo', v_saldo_nuevo,
    'fecha_vencimiento', v_vencimiento
  );
end;
$function$;

comment on function public.registrar_cobro_cc(jsonb, jsonb) is
  'Cobro de cuenta corriente en una transacción: venta_pagos + mora + crédito + saldo. Idempotente por p_pago.id (ya_registrado). Rechaza con COBRO_SUPERA_DEUDA un monto mayor al saldo + mora. SECURITY INVOKER: el aislamiento es la RLS de quien cobra.';

-- Supabase da EXECUTE a anon y authenticated por default privileges: el
-- revoke de public solo no alcanza (ver 20260921200000).
revoke all on function public.registrar_cobro_cc(jsonb, jsonb) from public, anon;
grant execute on function public.registrar_cobro_cc(jsonb, jsonb) to authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.registrar_cobro_cc(jsonb, jsonb)', 'execute') then
    raise exception 'GUARD: anon no puede ejecutar registrar_cobro_cc';
  end if;

  if pg_get_functiondef('public.registrar_cobro_cc(jsonb, jsonb)'::regprocedure)
     ~* 'greatest\s*\(\s*0' then
    raise exception 'GUARD: registrar_cobro_cc no puede recortar el saldo a cero';
  end if;
end;
$guard$;
