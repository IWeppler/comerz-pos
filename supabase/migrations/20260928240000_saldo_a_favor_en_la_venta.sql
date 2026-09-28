-- ---------------------------------------------------------------------------
-- Saldo a favor, etapas C y B3: se USA en la venta y NACE de una devolución.
--
-- Etapa A (20260928230000) le dio signo a `clientes.saldo_pendiente`
-- (negativo = saldo a favor). Esta migración hace que se pueda gastar y que
-- una devolución pueda dejarlo, sin que el módulo de dinero lo confunda con
-- plata que entra o sale.
--
-- 1. CONSUMO EN LA VENTA (`registrar_venta`). El monto viaja en
--    `p_venta->>'saldo_a_favor_aplicado'` —sin cambiar la firma, así el código
--    que ya está deployado sigue llamando igual— y se valida acá, con el
--    cliente bloqueado: `SALDO_A_FAVOR_INSUFICIENTE` si pide más de lo que
--    tiene (detail JSON `disponible`/`monto`). Escribe un DEBITO marcado
--    `es_saldo_a_favor` y sube el saldo con delta.
--    NO es una fila de `venta_pagos`, a propósito: esa tabla es PLATA QUE
--    ENTRÓ, y esta plata entró antes (con la seña, el pago de más o la venta
--    que se devolvió). Mismo criterio que el fiado. Por eso `monto_cobrado`
--    no la incluye y `ventas.saldo_a_favor_aplicado` es la columna que dice
--    cuánto del ticket se pagó así.
--    SIN RECARGO de cuenta corriente (decidido con el dueño el 28/9/2026): es
--    plata que la clienta ya adelantó. El recargo lo calcula create-sale.ts
--    sobre el subtotal MENOS el saldo a favor aplicado.
--
-- 2. `es_saldo_a_favor` en `cuenta_corriente_movimientos`: marca los
--    movimientos que usan o generan saldo a favor sin ser deuda ni cobro de
--    deuda. Existe para que un consumo no se cuente como fiado en
--    `rentabilidad_por_metodo` (bloque `fiado`), que suma todo DEBITO.
--
-- 3. ANULAR (`anular_venta`):
--    * El saldo a favor que usó la venta VUELVE a la cuenta, siempre, sea cual
--      sea el medio de reintegro: no salió de ninguna caja.
--    * Nuevo `p_reintegro_a_cuenta`: el reintegro de lo cobrado no sale en
--      plata, queda como saldo a favor. Lo puede elegir quien puede anular (no
--      pide `ventas.elegir_medio_devolucion`): no saca plata del cajón.
--    * Lo que el cliente YA había pagado de un fiado queda como saldo a favor:
--      se acredita la deuda ENTERA de la venta y el saldo puede quedar
--      negativo. Antes se acotaba a `least(pendiente, saldo)` y el resto volvía
--      como aviso ("devolvéselo aparte") porque no había dónde ponerlo; con
--      saldo con signo el libro ya dice cuánto es, sin suponer nada.
--      `excedente_ya_pagado` sigue viniendo: ahora es cuánto quedó a favor.
-- 4. DEVOLVER (`registrar_devolucion`): mismo nuevo parámetro y misma regla
--    del fiado. Una venta pagada con saldo a favor, sin medio elegido, vuelve
--    a la cuenta por defecto (antes no tenía ningún camino: sin cobros,
--    `VENTA_CON_PAGO_MIXTO`).
--
-- 5. EL MÓDULO DE DINERO. Un reintegro "a cuenta" deja la plata del cobro en
--    el negocio, igual que un reintegro "por otro medio": el cobro se marca
--    ANULADO ("no fue venta") pero ni el banco lo revirtió ni salió del
--    cajón. Los cuatro lugares que deciden eso con
--    `reintegro_metodo_id distinto del medio del cobro` pasan a aceptar
--    también `reintegro_metodo_tipo = 'SALDO_A_FAVOR'`:
--      `registrar_bitacora_venta_pago` (sin reversa), `posicion_dinero` y
--      `acreditar_cobros_vencidos` (el cobro digital sigue viniendo), y
--      `resumen_financiero_periodo` (el cobro cuenta en `cobrado`).
--    Y `reintegros_al_cliente` EXCLUYE el vale: la vista alimenta el
--    `neto_caja` y los reintegros digitales de `posicion_dinero`, o sea que es
--    "plata que se le devolvió", y un vale no es plata.
--    El efectivo no necesita nada: el arqueo cuenta los cobros anulados y
--    resta los egresos, y un reintegro a cuenta no tiene egreso.
-- ---------------------------------------------------------------------------

begin;

-- 1. Columnas -----------------------------------------------------------------

alter table public.cuenta_corriente_movimientos
  add column if not exists es_saldo_a_favor boolean not null default false;

comment on column public.cuenta_corriente_movimientos.es_saldo_a_favor is
  'Movimiento que usa (DEBITO) o genera (CREDITO) saldo a favor sin ser deuda ni cobro de deuda: pago con saldo a favor, saldo a favor devuelto al anular, reintegro "a cuenta". No se cuenta como fiado.';

alter table public.ventas
  add column if not exists saldo_a_favor_aplicado numeric not null default 0;

alter table public.ventas
  drop constraint if exists ventas_saldo_a_favor_no_negativo;
alter table public.ventas
  add constraint ventas_saldo_a_favor_no_negativo check (saldo_a_favor_aplicado >= 0);

comment on column public.ventas.saldo_a_favor_aplicado is
  'Parte del ticket pagada con saldo a favor del cliente. NO está en monto_cobrado (esa plata entró antes) ni en venta_pagos. 0 = no se usó; las ventas anteriores a la columna tampoco lo usaron, porque no existía.';

alter table public.ventas drop constraint ventas_metodo_pago_check;
alter table public.ventas add constraint ventas_metodo_pago_check
  check (metodo_pago = any (array[
    'EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'PAGO_MIXTO', 'CUENTA_CORRIENTE',
    'SALDO_A_FAVOR'
  ]));

-- Helper de la migración: reemplaza un fragmento que tiene que aparecer
-- EXACTAMENTE una vez. Si el cuerpo vivo no es el que se leyó, falla en vez de
-- aplicar un parche a medias.
create or replace function pg_temp.reemplazar_una_vez(
  p_texto text, p_viejo text, p_nuevo text, p_donde text
) returns text language plpgsql as $f$
declare
  n int := (length(p_texto) - length(replace(p_texto, p_viejo, ''))) / length(p_viejo);
begin
  if n <> 1 then
    raise exception 'GUARD: en % el fragmento "%" aparece % veces (se esperaba 1)',
      p_donde, left(p_viejo, 70), n;
  end if;
  return replace(p_texto, p_viejo, p_nuevo);
end;
$f$;

-- La condición "el reintegro no revirtió este cobro": se amplía para el vale.
create or replace function pg_temp.ampliar_reintegro_por_otro_medio(
  p_texto text, p_donde text
) returns text language plpgsql as $f$
declare
  v_patron constant text :=
    'v\.reintegro_metodo_id is not null\s+and v\.reintegro_metodo_id is distinct from (\w+)\.metodo_pago_id';
  n int := regexp_count(p_texto, v_patron);
begin
  if n <> 1 then
    raise exception 'GUARD: en % la condición de reintegro por otro medio aparece % veces', p_donde, n;
  end if;
  return regexp_replace(
    p_texto, v_patron,
    '(v.reintegro_metodo_tipo = ''SALDO_A_FAVOR'' or (v.reintegro_metodo_id is not null and v.reintegro_metodo_id is distinct from \1.metodo_pago_id))'
  );
end;
$f$;

-- 2. registrar_venta: consumo de saldo a favor -------------------------------

do $registrar_venta$
declare
  v_def text := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
begin
  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  v_recargo_cc numeric;\nbegin',
E'  v_recargo_cc numeric;\n  v_favor numeric;\n  v_cliente_favor uuid;\n  v_saldo_favor numeric;\nbegin',
    'registrar_venta (declare)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  if p_cc is not null then\n',
E'  -- SALDO A FAVOR (20260928240000). Va ANTES del fiado: primero se usa lo\n'
|| E'  -- que la clienta ya tenía, después se fía el resto. No es una fila de\n'
|| E'  -- venta_pagos: esa plata entró antes. El tope es contra el saldo releído\n'
|| E'  -- con el cliente bloqueado.\n'
|| E'  v_favor := coalesce((p_venta->>''saldo_a_favor_aplicado'')::numeric, 0);\n'
|| E'  if v_favor < 0 then\n'
|| E'    raise exception ''SALDO_A_FAVOR_INVALIDO'';\n'
|| E'  end if;\n'
|| E'  if v_favor > 0 then\n'
|| E'    v_cliente_favor := nullif(p_venta->>''cliente_id'', '''')::uuid;\n'
|| E'    if v_cliente_favor is null then\n'
|| E'      raise exception ''SALDO_A_FAVOR_SIN_CLIENTE'';\n'
|| E'    end if;\n'
|| E'\n'
|| E'    select coalesce(c.saldo_pendiente, 0) into v_saldo_favor\n'
|| E'      from public.clientes c\n'
|| E'     where c.id = v_cliente_favor\n'
|| E'       and c.negocio_id = v_negocio\n'
|| E'       for update;\n'
|| E'    if not found then\n'
|| E'      raise exception ''CLIENTE_NO_ENCONTRADO'';\n'
|| E'    end if;\n'
|| E'\n'
|| E'    if round(v_favor, 2) > round(-v_saldo_favor, 2) then\n'
|| E'      raise exception ''SALDO_A_FAVOR_INSUFICIENTE''\n'
|| E'        using detail = jsonb_build_object(\n'
|| E'          ''disponible'', greatest(-v_saldo_favor, 0), ''monto'', v_favor)::text;\n'
|| E'    end if;\n'
|| E'\n'
|| E'    insert into public.cuenta_corriente_movimientos (\n'
|| E'      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n'
|| E'      monto_recargo, recargo_porcentaje, es_saldo_a_favor\n'
|| E'    ) values (\n'
|| E'      v_negocio, v_cliente_favor, v_venta_id, ''DEBITO'', v_favor,\n'
|| E'      coalesce(nullif(p_venta->>''saldo_a_favor_descripcion'', ''''), ''Pago con saldo a favor''),\n'
|| E'      v_vendedor, 0, 0, true\n'
|| E'    );\n'
|| E'\n'
|| E'    update public.clientes c\n'
|| E'       set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + v_favor,\n'
|| E'           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente_favor)\n'
|| E'     where c.id = v_cliente_favor\n'
|| E'       and c.negocio_id = v_negocio;\n'
|| E'\n'
|| E'    update public.ventas\n'
|| E'       set saldo_a_favor_aplicado = v_favor\n'
|| E'     where id = v_venta_id;\n'
|| E'  end if;\n'
|| E'\n'
|| E'  if p_cc is not null then\n',
    'registrar_venta (bloque de saldo a favor)');

  execute v_def;
end;
$registrar_venta$;

-- 3. anular_venta: saldo a favor que vuelve + reintegro a cuenta --------------

do $anular_venta$
declare
  v_def text := pg_get_functiondef(
    'public.anular_venta(uuid,text,uuid,text,text,uuid)'::regprocedure);
begin
  v_def := pg_temp.reemplazar_una_vez(v_def,
E'p_reintegro_metodo_id uuid DEFAULT NULL::uuid)\n RETURNS jsonb',
E'p_reintegro_metodo_id uuid DEFAULT NULL::uuid, p_reintegro_a_cuenta boolean DEFAULT false)\n RETURNS jsonb',
    'anular_venta (firma)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  v_por_fuera numeric := 0;\nbegin',
E'  v_por_fuera numeric := 0;\n  v_favor numeric := 0;\n  v_a_cuenta numeric := 0;\nbegin',
    'anular_venta (declare)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;\n',
E'    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;\n'
|| E'\n'
|| E'  -- Reintegro A CUENTA (20260928240000): lo cobrado no sale en plata, queda\n'
|| E'  -- como saldo a favor. No pide ventas.elegir_medio_devolucion: no saca plata\n'
|| E'  -- del cajón.\n'
|| E'  if p_reintegro_a_cuenta then\n'
|| E'    if p_reintegro_metodo_id is not null then\n'
|| E'      raise exception ''REINTEGRO_AMBIGUO'';\n'
|| E'    end if;\n'
|| E'    v_rein_id := null;\n'
|| E'    v_rein_tipo := ''SALDO_A_FAVOR'';\n'
|| E'    v_rein_nombre := ''A cuenta del cliente'';\n'
|| E'  end if;\n',
    'anular_venta (reintegro a cuenta)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  returning cliente_id, coalesce(monto_pendiente, 0)\n       into v_cliente, v_pendiente;',
E'  returning cliente_id, coalesce(monto_pendiente, 0), coalesce(saldo_a_favor_aplicado, 0)\n       into v_cliente, v_pendiente, v_favor;',
    'anular_venta (returning)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    raise exception ''VENTA_NO_ANULABLE'';\n  end if;\n',
E'    raise exception ''VENTA_NO_ANULABLE'';\n  end if;\n'
|| E'\n'
|| E'  if v_rein_tipo = ''SALDO_A_FAVOR'' and v_cliente is null then\n'
|| E'    raise exception ''A_CUENTA_SIN_CLIENTE'';\n'
|| E'  end if;\n',
    'anular_venta (a cuenta sin cliente)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  if v_rein_id is null then\n    v_egreso    := v_efectivo;',
E'  if v_rein_tipo = ''SALDO_A_FAVOR'' then\n'
|| E'    -- A cuenta: no sale plata del cajón ni del banco; lo cobrado (sin el\n'
|| E'    -- recargo por método, que no se devuelve) queda a favor del cliente.\n'
|| E'    v_egreso    := 0;\n'
|| E'    v_por_fuera := 0;\n'
|| E'    v_a_cuenta  := v_efectivo + v_otros;\n'
|| E'  elsif v_rein_id is null then\n    v_egreso    := v_efectivo;',
    'anular_venta (egreso)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'      v_credito := least(v_pendiente, greatest(v_saldo, 0));\n      v_excedente := v_pendiente - v_credito;',
E'      -- La deuda ENTERA de la venta: si el cliente ya había pagado parte, el\n'
|| E'      -- saldo queda negativo y eso es su saldo a favor. `v_excedente` dice\n'
|| E'      -- cuánto quedó a favor por esta anulación.\n'
|| E'      v_credito := v_pendiente;\n'
|| E'      v_excedente := greatest(0, v_pendiente - greatest(v_saldo, 0));',
    'anular_venta (crédito de la deuda)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'           set saldo_pendiente = greatest(0, coalesce(saldo_pendiente, 0) - v_credito)\n         where id = v_cliente;',
E'           set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_credito,\n'
|| E'               fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)\n'
|| E'         where id = v_cliente;',
    'anular_venta (saldo de la deuda)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  return jsonb_build_object(\n    ''efectivo_devuelto''',
E'  -- El saldo a favor que usó la venta vuelve a la cuenta, siempre: no salió\n'
|| E'  -- de ninguna caja, así que no tiene medio de reintegro.\n'
|| E'  if v_favor > 0 then\n'
|| E'    if v_cliente is null then\n'
|| E'      raise exception ''SALDO_A_FAVOR_SIN_CLIENTE'';\n'
|| E'    end if;\n'
|| E'    insert into public.cuenta_corriente_movimientos (\n'
|| E'      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n'
|| E'      es_saldo_a_favor\n'
|| E'    ) values (\n'
|| E'      v_negocio, v_cliente, p_venta_id, ''CREDITO'', v_favor,\n'
|| E'      ''Anulacion de Venta #'' || v_ticket || '': vuelve el saldo a favor usado'',\n'
|| E'      auth.uid(), true\n'
|| E'    );\n'
|| E'    update public.clientes\n'
|| E'       set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_favor,\n'
|| E'           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)\n'
|| E'     where id = v_cliente;\n'
|| E'  end if;\n'
|| E'\n'
|| E'  if v_a_cuenta > 0 then\n'
|| E'    insert into public.cuenta_corriente_movimientos (\n'
|| E'      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n'
|| E'      es_saldo_a_favor\n'
|| E'    ) values (\n'
|| E'      v_negocio, v_cliente, p_venta_id, ''CREDITO'', v_a_cuenta,\n'
|| E'      ''Anulacion de Venta #'' || v_ticket || '': reintegro a cuenta'',\n'
|| E'      auth.uid(), true\n'
|| E'    );\n'
|| E'    update public.clientes\n'
|| E'       set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_a_cuenta,\n'
|| E'           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)\n'
|| E'     where id = v_cliente;\n'
|| E'  end if;\n'
|| E'\n'
|| E'  return jsonb_build_object(\n    ''efectivo_devuelto''',
    'anular_venta (bloques de saldo a favor)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    ''reintegro_metodo_nombre'', v_rein_nombre\n  );',
E'    ''reintegro_metodo_nombre'', v_rein_nombre,\n'
|| E'    ''saldo_a_favor_devuelto'', v_favor,\n'
|| E'    ''a_cuenta'', v_a_cuenta\n  );',
    'anular_venta (resultado)');

  execute v_def;
end;
$anular_venta$;

drop function public.anular_venta(uuid, text, uuid, text, text, uuid);

-- 4. registrar_devolucion: misma regla -------------------------------------

do $registrar_devolucion$
declare
  v_def text := pg_get_functiondef(
    'public.registrar_devolucion(uuid,jsonb,text,text,uuid,uuid)'::regprocedure);
begin
  v_def := pg_temp.reemplazar_una_vez(v_def,
E'p_reintegro_metodo_id uuid DEFAULT NULL::uuid)\n RETURNS jsonb',
E'p_reintegro_metodo_id uuid DEFAULT NULL::uuid, p_reintegro_a_cuenta boolean DEFAULT false)\n RETURNS jsonb',
    'registrar_devolucion (firma)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  v_sale_de_caja   boolean;\nbegin',
E'  v_sale_de_caja   boolean;\n  v_a_cuenta       boolean := false;\n  v_monto_a_cuenta numeric := 0;\nbegin',
    'registrar_devolucion (declare)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;\n',
E'    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;\n'
|| E'\n'
|| E'  -- Reintegro A CUENTA (20260928240000). Lo elige quien puede devolver: no\n'
|| E'  -- saca plata del cajón.\n'
|| E'  if p_reintegro_a_cuenta then\n'
|| E'    if p_reintegro_metodo_id is not null then\n'
|| E'      raise exception ''REINTEGRO_AMBIGUO'';\n'
|| E'    end if;\n'
|| E'    v_rein_id := null;\n'
|| E'    v_rein_tipo := ''SALDO_A_FAVOR'';\n'
|| E'    v_rein_nombre := ''A cuenta del cliente'';\n'
|| E'  end if;\n',
    'registrar_devolucion (reintegro a cuenta)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    raise exception ''VENTA_NO_DEVOLVIBLE'';\n  end if;\n',
E'    raise exception ''VENTA_NO_DEVOLVIBLE'';\n  end if;\n'
|| E'\n'
|| E'  -- Una venta pagada con saldo a favor, sin medio elegido, vuelve a la\n'
|| E'  -- cuenta: es de donde salió. Sin esto no tenía camino (sin cobros cae en\n'
|| E'  -- VENTA_CON_PAGO_MIXTO).\n'
|| E'  if v_rein_tipo is null\n'
|| E'     and coalesce(v_venta.saldo_a_favor_aplicado, 0) > 0\n'
|| E'     and coalesce(v_venta.monto_pendiente, 0) = 0 then\n'
|| E'    v_rein_tipo := ''SALDO_A_FAVOR'';\n'
|| E'    v_rein_nombre := ''A cuenta del cliente'';\n'
|| E'  end if;\n'
|| E'\n'
|| E'  v_a_cuenta := coalesce(v_rein_tipo = ''SALDO_A_FAVOR'', false);\n'
|| E'  if v_a_cuenta and v_venta.cliente_id is null then\n'
|| E'    raise exception ''A_CUENTA_SIN_CLIENTE'';\n'
|| E'  end if;\n',
    'registrar_devolucion (default de venta con saldo a favor)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    if v_rein_id is null then\n      if v_cobros <> 1 then',
E'    if v_rein_id is null and not v_a_cuenta then\n      if v_cobros <> 1 then',
    'registrar_devolucion (validación de medio)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    v_credito := least(v_reduccion, greatest(coalesce(v_saldo, 0), 0));\n    v_excedente := v_reduccion - v_credito;',
E'    -- Entero: si el cliente ya había pagado esa parte, queda a favor.\n'
|| E'    -- `v_excedente` (devoluciones.excedente_a_devolver) dice cuánto.\n'
|| E'    v_credito := v_reduccion;\n'
|| E'    v_excedente := greatest(0, v_reduccion - greatest(coalesce(v_saldo, 0), 0));',
    'registrar_devolucion (crédito de la deuda)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'         set saldo_pendiente = greatest(0, coalesce(saldo_pendiente, 0) - v_credito)\n       where id = v_venta.cliente_id',
E'         set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_credito,\n'
|| E'             fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_venta.cliente_id)\n'
|| E'       where id = v_venta.cliente_id',
    'registrar_devolucion (saldo de la deuda)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'  -- La plata sale del cajon si el medio ELEGIDO es efectivo; sin eleccion, si\n',
E'  -- A cuenta (venta que no es fiado): la base devuelta queda a favor. En un\n'
|| E'  -- fiado ya se acreditó arriba. SECURITY DEFINER: negocio a mano.\n'
|| E'  if v_a_cuenta and not v_es_cc and v_base > 0 then\n'
|| E'    v_monto_a_cuenta := v_base;\n'
|| E'    v_credito := v_base;\n'
|| E'\n'
|| E'    insert into public.cuenta_corriente_movimientos (\n'
|| E'      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n'
|| E'      es_saldo_a_favor\n'
|| E'    ) values (\n'
|| E'      v_negocio, v_venta.cliente_id, p_venta_id, ''CREDITO'', v_base,\n'
|| E'      ''Devolucion parcial - Venta #'' || v_ticket || '': a cuenta'', v_usuario, true\n'
|| E'    );\n'
|| E'\n'
|| E'    update public.clientes\n'
|| E'       set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_base,\n'
|| E'           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_venta.cliente_id)\n'
|| E'     where id = v_venta.cliente_id\n'
|| E'       and negocio_id = v_negocio;\n'
|| E'  end if;\n'
|| E'\n'
|| E'  -- La plata sale del cajon si el medio ELEGIDO es efectivo; sin eleccion, si\n',
    'registrar_devolucion (a cuenta)');

  v_def := pg_temp.reemplazar_una_vez(v_def,
E'    ''venta_totalmente_devuelta'', v_base_previa >= v_base_total\n  );',
E'    ''venta_totalmente_devuelta'', v_base_previa >= v_base_total,\n'
|| E'    ''a_cuenta'', v_monto_a_cuenta\n  );',
    'registrar_devolucion (resultado)');

  execute v_def;
end;
$registrar_devolucion$;

drop function public.registrar_devolucion(uuid, jsonb, text, text, uuid, uuid);

-- 5. El módulo de dinero: un vale no es plata --------------------------------

do $dinero$
declare
  v_def text;
begin
  v_def := pg_temp.ampliar_reintegro_por_otro_medio(
    pg_get_functiondef('public.registrar_bitacora_venta_pago'::regproc),
    'registrar_bitacora_venta_pago');
  execute v_def;

  v_def := pg_temp.ampliar_reintegro_por_otro_medio(
    pg_get_functiondef('public.posicion_dinero'::regproc),
    'posicion_dinero');
  execute v_def;

  v_def := pg_temp.ampliar_reintegro_por_otro_medio(
    pg_get_functiondef('public.acreditar_cobros_vencidos'::regproc),
    'acreditar_cobros_vencidos');
  execute v_def;

  v_def := pg_temp.reemplazar_una_vez(
    pg_get_functiondef('public.resumen_financiero_periodo'::regproc),
E'       and coalesce(vp.estado_pago_operacion, ''CONFIRMADO'') <> ''ANULADO''\n  ),',
E'       and (coalesce(vp.estado_pago_operacion, ''CONFIRMADO'') <> ''ANULADO''\n'
|| E'            -- Anulada con reintegro a cuenta: la plata se quedó en el negocio.\n'
|| E'            or exists (select 1 from public.ventas v\n'
|| E'                        where v.id = vp.venta_id\n'
|| E'                          and v.negocio_id = v_negocio\n'
|| E'                          and v.reintegro_metodo_tipo = ''SALDO_A_FAVOR''))\n'
|| E'  ),',
    'resumen_financiero_periodo');
  execute v_def;

  v_def := pg_temp.reemplazar_una_vez(
    pg_get_functiondef('public.rentabilidad_por_metodo'::regproc),
E'      and m.tipo = ''DEBITO''\n      and coalesce(m.anulado, false) = false\n      and (m.creado_en at time zone v_tz)::date between v_desde and v_hasta',
E'      and m.tipo = ''DEBITO''\n      and coalesce(m.anulado, false) = false\n'
|| E'      and not m.es_saldo_a_favor\n'
|| E'      and (m.creado_en at time zone v_tz)::date between v_desde and v_hasta',
    'rentabilidad_por_metodo');
  execute v_def;
end;
$dinero$;

create or replace view public.reintegros_al_cliente
with (security_invoker = true) as
 SELECT d.negocio_id,
    d.venta_id,
    'DEVOLUCION'::text AS origen,
    d.creado_en AS fecha,
    d.reintegro_metodo_id AS metodo_id,
    COALESCE(d.reintegro_metodo_tipo, d.metodo_tipo) AS metodo_tipo,
    COALESCE(d.reintegro_metodo_nombre, d.metodo_nombre) AS metodo_nombre,
    d.base_devuelta AS monto
   FROM devoluciones d
  WHERE COALESCE(d.reintegro_metodo_tipo, d.metodo_tipo) <> ALL (ARRAY['CUENTA_CORRIENTE'::text, 'SALDO_A_FAVOR'::text])
    AND d.base_devuelta > 0::numeric
UNION ALL
 SELECT v.negocio_id,
    v.id AS venta_id,
    'ANULACION'::text AS origen,
    v.anulada_en AS fecha,
    v.reintegro_metodo_id AS metodo_id,
    v.reintegro_metodo_tipo AS metodo_tipo,
    v.reintegro_metodo_nombre AS metodo_nombre,
    ( SELECT COALESCE(sum(vp.monto_base), 0::numeric) AS "coalesce"
           FROM venta_pagos vp
          WHERE vp.venta_id = v.id AND vp.negocio_id = v.negocio_id AND vp.tipo_movimiento = 'PAGO_VENTA'::text) AS monto
   FROM ventas v
  WHERE v.estado_operacion = 'ANULADA'::text AND v.reintegro_metodo_id IS NOT NULL
UNION ALL
 SELECT v.negocio_id,
    v.id AS venta_id,
    'ANULACION'::text AS origen,
    v.anulada_en AS fecha,
    vp.metodo_pago_id AS metodo_id,
    vp.metodo_tipo,
    vp.metodo_nombre,
    vp.monto_base AS monto
   FROM ventas v
     JOIN venta_pagos vp ON vp.venta_id = v.id AND vp.negocio_id = v.negocio_id AND vp.tipo_movimiento = 'PAGO_VENTA'::text
  WHERE v.estado_operacion = 'ANULADA'::text AND v.reintegro_metodo_id IS NULL
    AND v.reintegro_metodo_tipo IS DISTINCT FROM 'SALDO_A_FAVOR'::text;

comment on view public.reintegros_al_cliente is
  'Plata que se le devolvió al cliente y por qué medio (anulaciones y devoluciones parciales). NO incluye los reintegros a cuenta (SALDO_A_FAVOR, 20260928240000): un vale no es plata que sale, y esta vista alimenta neto_caja y los reintegros digitales de posicion_dinero.';

-- 6. Guards ------------------------------------------------------------------

do $guard$
begin
  if to_regprocedure('public.anular_venta(uuid,text,uuid,text,text,uuid,boolean)') is null
     or to_regprocedure('public.registrar_devolucion(uuid,jsonb,text,text,uuid,uuid,boolean)') is null then
    raise exception 'GUARD: falta alguna de las firmas nuevas';
  end if;

  if to_regprocedure('public.anular_venta(uuid,text,uuid,text,text,uuid)') is not null
     or to_regprocedure('public.registrar_devolucion(uuid,jsonb,text,text,uuid,uuid)') is not null then
    raise exception 'GUARD: quedó alguna firma vieja (dos overloads = llamada ambigua)';
  end if;

  if (select prosecdef from pg_proc
       where oid = 'public.registrar_devolucion(uuid,jsonb,text,text,uuid,uuid,boolean)'::regprocedure) is not true
     or (select prosecdef from pg_proc
          where oid = 'public.anular_venta(uuid,text,uuid,text,text,uuid,boolean)'::regprocedure) is not false then
    raise exception 'GUARD: cambió el SECURITY de anular_venta o registrar_devolucion';
  end if;

  if pg_get_functiondef('public.anular_venta(uuid,text,uuid,text,text,uuid,boolean)'::regprocedure)
       ~ 'greatest\(0, coalesce\(saldo_pendiente'
     or pg_get_functiondef('public.registrar_devolucion(uuid,jsonb,text,text,uuid,uuid,boolean)'::regprocedure)
       ~ 'greatest\(0, coalesce\(saldo_pendiente' then
    raise exception 'GUARD: quedó un recorte a cero del saldo';
  end if;

  -- DEFINER: TODA consulta de registrar_devolucion por el cliente de la venta
  -- filtra negocio (hoy son tres: el select for update y los dos updates). Se
  -- compara contra el total en vez de fijar un número, así el guard dice lo
  -- que importa y no cuántas consultas hay.
  if regexp_count(
       pg_get_functiondef('public.registrar_devolucion(uuid,jsonb,text,text,uuid,uuid,boolean)'::regprocedure),
       'where id = v_venta\.cliente_id\s+and negocio_id = v_negocio')
     <> regexp_count(
       pg_get_functiondef('public.registrar_devolucion(uuid,jsonb,text,text,uuid,uuid,boolean)'::regprocedure),
       'where id = v_venta\.cliente_id') then
    raise exception 'GUARD: registrar_devolucion consulta al cliente sin filtro de negocio';
  end if;

  if pg_get_functiondef('public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure)
       !~ 'SALDO_A_FAVOR_INSUFICIENTE' then
    raise exception 'GUARD: registrar_venta quedó sin el tope de saldo a favor';
  end if;

  if pg_get_functiondef('public.registrar_bitacora_venta_pago'::regproc) !~ 'SALDO_A_FAVOR'
     or pg_get_functiondef('public.posicion_dinero'::regproc) !~ 'SALDO_A_FAVOR'
     or pg_get_functiondef('public.acreditar_cobros_vencidos'::regproc) !~ 'SALDO_A_FAVOR'
     or pg_get_functiondef('public.resumen_financiero_periodo'::regproc) !~ 'SALDO_A_FAVOR'
     or pg_get_functiondef('public.rentabilidad_por_metodo'::regproc) !~ 'es_saldo_a_favor' then
    raise exception 'GUARD: algún consumidor del módulo de dinero quedó sin parche';
  end if;

  -- anular_venta_facturada llama a anular_venta con 6 argumentos por posición:
  -- tiene que seguir resolviendo (a la nueva, por el default).
  perform 'public.anular_venta_facturada(uuid,text,uuid,text,text,jsonb,uuid)'::regprocedure;
end;
$guard$;

commit;
