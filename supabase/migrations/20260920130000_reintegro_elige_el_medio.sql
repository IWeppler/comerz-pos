-- El medio por el que se le devuelve la plata al cliente deja de ser una
-- consecuencia del cobro y pasa a ser una DECISIÓN del dueño.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ ESTABA MAL
--
-- `anular_venta` y `registrar_devolucion` deducían el medio del reintegro del
-- medio del COBRO: si la venta se había cobrado con tarjeta o transferencia, la
-- plata "no sale de la caja" y la pantalla lo devolvía como aviso. Eso no es
-- una decisión del sistema: una clienta que vuelve con la prenda y quiere los
-- pesos en la mano es un caso normal del mostrador, y el comercio puede
-- decidir devolver por transferencia algo que cobró en efectivo.
--
-- Medido el 20/9/2026 sobre las 51 ventas anuladas del SaaS: 18 tenían porción
-- no efectivo, por $720.500 en total (ClickTostado $425.000, Evens $221.300,
-- Estilo Bonito $35.000, Librería Colores $29.000, El Nono Cacho $10.200 —este
-- último es el caso que lo reportó). Cero ventas mixtas: el caso difícil
-- todavía no ocurrió.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA REGLA NUEVA, Y POR QUÉ EL EGRESO DEPENDE DEL REINTEGRO Y NO DEL COBRO
--
-- El egreso de caja existe para representar plata que SALE del cajón. Si el
-- dueño devuelve en efectivo una venta cobrada con tarjeta, esa plata sale del
-- cajón aunque nunca haya entrado por ahí, y el arqueo tiene que verlo. Si
-- devuelve por transferencia una venta cobrada en efectivo, el cajón se queda
-- la plata y el egreso sería un faltante inventado.
--
-- Entonces: **egreso si y solo si el reintegro es EFECTIVO**, por el total
-- cobrado (no por la porción efectivo).
--
-- Cuando el reintegro NO es efectivo no se registra ningún movimiento
-- financiero, y eso es a propósito: hoy NINGÚN negocio tiene cuenta BANCO ni
-- BILLETERA (solo CAJA_DIARIA y POR_ACREDITAR, más dos cajas generales), y de
-- los 41 métodos de pago solo los 11 de tipo EFECTIVO tienen
-- `cuenta_destino_id`. Un egreso sin cuenta lo completa el trigger
-- `asignar_cuenta_financiera_actual` con CAJA_DIARIA, o sea que registrarlo
-- "para que quede" le bajaría el arqueo al cajón: sería el bug original al
-- revés. Cuando existan esas cuentas, este es el lugar donde se materializa.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Y POR QUÉ EL COBRO ORIGINAL NO SIEMPRE SE ANULA
--
-- Hasta hoy anular marcaba TODOS los `venta_pagos` como ANULADO. Eso asume que
-- la plata vuelve por donde vino: el banco reversa la tarjeta, el cajón
-- devuelve el efectivo. Con el medio elegible esa premisa se rompe — si le
-- devolvés efectivo por una venta con tarjeta, **el banco no reversa nada**: ese
-- dinero sigue viniendo. Marcarlo ANULADO lo borraría de "por acreditar" y el
-- sistema perdería de vista plata que igual va a caer.
--
-- Por eso el cobro se marca ANULADO solo cuando el reintegro sale por el MISMO
-- medio. Si difiere, queda CONFIRMADO y el reintegro se representa aparte (el
-- egreso, si es efectivo). La contrapartida conocida: una venta ANULADA puede
-- quedar con un cobro CONFIRMADO, algo que hoy no pasa en ninguna de las 48
-- filas anuladas. `posicion_dinero` y `rentabilidad_por_metodo` no miran
-- `ventas.estado_operacion` —filtran solo por `estado_pago_operacion`— así que
-- van a seguir contando ese cobro y su comisión, que es exactamente lo
-- correcto: el posnet cobró y el banco se quedó la comisión igual.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LO QUE ESTA MIGRACIÓN NO ARREGLA (medido, para que no se descubra de nuevo)
--
-- 1. Cuando el reintegro va por el MISMO medio y es efectivo, el camino viejo
--    sigue igual: el cobro se marca ANULADO (lo saca del efectivo del turno) Y
--    además se inserta el egreso. Si la anulación cae en el mismo turno que la
--    venta —19 de 20 casos en la base— el efectivo se descuenta DOS VECES. El
--    peor caso vivo es ClickTostado, $750.000. No se toca acá porque arreglarlo
--    bien es dejar de excluir los pagos ANULADOS del efectivo del turno, y eso
--    mueve `flujo_caja_turno`, `resumen_gerencial_caja` y arqueos ya cerrados.
--    Los caminos NUEVOS de esta migración no tienen el problema.
-- 2. La devolución PARCIAL no toca `venta_pagos` (nunca lo hizo), así que si se
--    devuelve por un medio que no es efectivo, `posicion_dinero` sigue contando
--    el cobro entero como plata por acreditar. Son 12 devoluciones en total.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUIÉN DECIDE: el permiso nuevo `ventas.elegir_medio_devolucion`, que arranca
-- SOLO en ADMIN. Quien no lo tenga sigue con el comportamiento de siempre (el
-- medio del cobro), y eso importa: `ventas.devolver` la tiene VENDEDOR en 7 de
-- los 11 negocios, y elegir "efectivo" es sacar plata del cajón.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. EL PERMISO
-- ─────────────────────────────────────────────────────────────────────────

insert into public.permisos (clave, modulo, descripcion)
values (
  'ventas.elegir_medio_devolucion',
  'ventas',
  'Elegir por qué medio se le devuelve la plata al cliente en una anulación o devolución'
)
on conflict (clave) do nothing;

-- Solo ADMIN. Los negocios nuevos lo reciben solos porque
-- `crear_negocio_con_owner` le da al ADMIN todas las filas de `permisos`.
insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select r.id, p.id, r.negocio_id
  from public.roles r
  cross join public.permisos p
 where r.nombre = 'ADMIN'
   and r.negocio_id is not null
   and p.clave = 'ventas.elegir_medio_devolucion'
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. DÓNDE SE GUARDA LA DECISIÓN
--
-- Columnas nuevas y no reutilizar `devoluciones.metodo_tipo`: esa columna
-- significa "con qué se había COBRADO la venta" en las 12 filas que ya existen,
-- y pisarle el significado las volvería ilegibles.
--
-- null = "no se eligió", que es lo mismo que "por el medio del cobro" y es lo
-- que tienen todas las filas históricas. Sin FK a `metodos_pago`, mismo
-- criterio que `ventas_items.variante_id`: el historial tiene que sobrevivir a
-- que el método se borre, y por eso el tipo y el nombre van CONGELADOS.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.ventas
  add column if not exists reintegro_metodo_id     uuid,
  add column if not exists reintegro_metodo_tipo   text,
  add column if not exists reintegro_metodo_nombre text;

alter table public.devoluciones
  add column if not exists reintegro_metodo_id     uuid,
  add column if not exists reintegro_metodo_tipo   text,
  add column if not exists reintegro_metodo_nombre text;

comment on column public.ventas.reintegro_metodo_tipo is
  'Medio por el que se le devolvio la plata al cliente al ANULAR. null = no se eligio: volvio por el medio del cobro (todas las filas anteriores al 20/9/2026). Congelado, sin FK.';
comment on column public.devoluciones.reintegro_metodo_tipo is
  'Medio por el que se le devolvio la plata al cliente. DISTINTO de metodo_tipo, que guarda con que se habia COBRADO la venta. null = no se eligio.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RESOLVER EL MÉTODO ELEGIDO, EN UN SOLO LUGAR
--
-- Las dos RPC necesitan lo mismo: validar el permiso, que el método exista,
-- que sea de este negocio y que esté activo. Escrito dos veces, la primera
-- corrección se aplica a una sola.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.resolver_medio_reintegro(p_metodo_id uuid)
returns table (metodo_id uuid, metodo_tipo text, metodo_nombre text)
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if p_metodo_id is null then
    return;
  end if;

  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  -- El permiso se chequea ACÁ y no en la pantalla: el botón escondido no es
  -- control de acceso, y las dos RPC son alcanzables desde un endpoint.
  if not public.tiene_permiso('ventas.elegir_medio_devolucion') then
    raise exception 'SIN_PERMISO_MEDIO_REINTEGRO';
  end if;

  -- SECURITY DEFINER: el filtro por negocio va a mano en cada consulta. Sin
  -- el, el metodo de otro comercio pasaria como propio.
  return query
    select m.id, m.tipo, m.nombre
      from public.metodos_pago m
     where m.id = p_metodo_id
       and m.negocio_id = v_negocio
       and m.activo;

  if not found then
    raise exception 'METODO_REINTEGRO_INEXISTENTE';
  end if;
end;
$$;

revoke all on function public.resolver_medio_reintegro(uuid) from public, anon;
grant execute on function public.resolver_medio_reintegro(uuid) to authenticated;

comment on function public.resolver_medio_reintegro(uuid) is
  'Valida el permiso y devuelve el metodo de pago elegido para el reintegro. null entra y null sale: no elegir no es un error, es el comportamiento de siempre.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ANULAR
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.anular_venta(
  p_venta_id uuid,
  p_motivo text,
  p_turno_id uuid default null::uuid,
  p_motivo_codigo text default null::text,
  p_motivo_detalle text default null::text,
  p_reintegro_metodo_id uuid default null::uuid
)
returns jsonb
language plpgsql
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_cliente uuid;
  v_pendiente numeric;
  v_efectivo numeric;
  v_otros numeric;
  v_recargo numeric;
  v_saldo numeric;
  v_credito numeric := 0;
  v_excedente numeric := 0;
  v_ticket text := upper(split_part(p_venta_id::text, '-', 1));
  v_rein_id uuid;
  v_rein_tipo text;
  v_rein_nombre text;
  v_mismo_medio boolean := true;
  v_egreso numeric := 0;
  v_por_fuera numeric := 0;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  -- Antes de tocar nada: si el medio elegido no es válido o no hay permiso,
  -- la anulación no arranca.
  select r.metodo_id, r.metodo_tipo, r.metodo_nombre
    into v_rein_id, v_rein_tipo, v_rein_nombre
    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;

  update public.ventas
     set estado_operacion   = 'ANULADA',
         estado_pago        = 'ANULADA',
         motivo_anulacion   = p_motivo,
         destino_mercaderia = p_motivo,
         motivo_codigo      = p_motivo_codigo,
         motivo_detalle     = nullif(btrim(coalesce(p_motivo_detalle, '')), ''),
         anulada_por        = auth.uid(),
         anulada_en         = now(),
         reintegro_metodo_id     = v_rein_id,
         reintegro_metodo_tipo   = v_rein_tipo,
         reintegro_metodo_nombre = v_rein_nombre
   where id = p_venta_id
     and estado_operacion <> 'ANULADA'
  returning cliente_id, coalesce(monto_pendiente, 0)
       into v_cliente, v_pendiente;

  if not found then
    raise exception 'VENTA_NO_ANULABLE';
  end if;

  select
    coalesce(sum(monto_base) filter (where metodo_tipo = 'EFECTIVO'), 0),
    coalesce(sum(monto_base) filter (where metodo_tipo <> 'EFECTIVO'), 0),
    coalesce(sum(recargo_monto), 0)
    into v_efectivo, v_otros, v_recargo
  from public.venta_pagos
  where venta_id = p_venta_id;

  -- "Mismo medio" es literal: TODOS los cobros salieron por el método elegido.
  -- Se compara por `metodo_pago_id` y se cae al tipo cuando la fila es vieja y
  -- no lo tiene, porque ahi el id nunca va a coincidir con nada.
  if v_rein_id is not null then
    select not exists (
      select 1
        from public.venta_pagos vp
       where vp.venta_id = p_venta_id
         and case
               when vp.metodo_pago_id is not null then vp.metodo_pago_id <> v_rein_id
               else vp.metodo_tipo is distinct from v_rein_tipo
             end
    )
    into v_mismo_medio;
  end if;

  -- El cobro se revierte en su origen SOLO si la plata vuelve por ahí. Ver el
  -- encabezado: con otro medio el banco no reversa nada.
  if v_mismo_medio then
    update public.venta_pagos
       set estado_pago_operacion = 'ANULADO'
     where venta_id = p_venta_id;
  end if;

  if v_rein_id is null then
    -- Sin elección: exactamente lo de siempre.
    v_egreso    := v_efectivo;
    v_por_fuera := v_otros;
  elsif v_rein_tipo = 'EFECTIVO' then
    v_egreso    := v_efectivo + v_otros;
    v_por_fuera := 0;
  else
    v_egreso    := 0;
    v_por_fuera := v_efectivo + v_otros;
  end if;

  if v_egreso > 0 then
    insert into public.egresos (negocio_id, concepto, monto, creado_por, turno_caja_id)
    values (
      v_negocio,
      'Devolucion en efectivo - Venta #' || v_ticket,
      round(v_egreso)::int,
      auth.uid(),
      p_turno_id
    );
  end if;

  if v_cliente is not null and v_pendiente > 0 then
    select coalesce(saldo_pendiente, 0) into v_saldo
      from public.clientes
     where id = v_cliente
       for update;

    if found then
      v_credito := least(v_pendiente, greatest(v_saldo, 0));
      v_excedente := v_pendiente - v_credito;

      if v_credito > 0 then
        insert into public.cuenta_corriente_movimientos (
          negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por
        )
        values (
          v_negocio, v_cliente, p_venta_id, 'CREDITO', v_credito,
          'Anulacion de Venta #' || v_ticket, auth.uid()
        );

        update public.clientes
           set saldo_pendiente = greatest(0, coalesce(saldo_pendiente, 0) - v_credito)
         where id = v_cliente;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'efectivo_devuelto', v_egreso,
    'no_efectivo_a_devolver', v_por_fuera,
    'recargo_no_devuelto', v_recargo,
    'credito_aplicado', v_credito,
    'excedente_ya_pagado', v_excedente,
    'cliente_id', v_cliente,
    'reintegro_metodo_tipo', v_rein_tipo,
    'reintegro_metodo_nombre', v_rein_nombre,
    'reintegro_mismo_medio', v_mismo_medio
  );
end;
$function$;

-- El wrapper con nota de crédito tiene que poder pasar la elección: sin esto,
-- anular una venta FACTURADA volvería en silencio al comportamiento viejo.
create or replace function public.anular_venta_facturada(
  p_venta_id uuid,
  p_motivo text,
  p_turno_id uuid,
  p_motivo_codigo text,
  p_motivo_detalle text,
  p_comprobante jsonb,
  p_reintegro_metodo_id uuid default null::uuid
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_resultado jsonb;
  v_id        uuid;
  v_factura   uuid;
begin
  if p_comprobante is null
     or p_comprobante->>'tipo' not like 'NOTA_CREDITO%'
     or nullif(p_comprobante->>'cae', '') is null then
    raise exception 'NOTA_CREDITO_REQUERIDA';
  end if;

  v_factura := (p_comprobante->>'anula_comprobante_id')::uuid;

  if not exists (
    select 1 from public.comprobantes c
     where c.id = v_factura
       and c.venta_id = p_venta_id
       and c.tipo like 'FACTURA%'
  ) then
    raise exception 'FACTURA_NO_CORRESPONDE';
  end if;

  v_resultado := public.anular_venta(
    p_venta_id, p_motivo, p_turno_id, p_motivo_codigo, p_motivo_detalle,
    p_reintegro_metodo_id
  );

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    receptor_doc_tipo, receptor_doc_nro,
    neto, iva_monto, exento, no_gravado, total,
    cae, cae_vencimiento, fecha_comprobante,
    arca_ambiente, arca_resultado, arca_observaciones,
    anula_comprobante_id, emitido_por
  )
  select
    p_venta_id,
    p_comprobante->>'tipo',
    (p_comprobante->>'punto_venta')::integer,
    (p_comprobante->>'numero')::bigint,
    f.cliente_id, f.receptor_razon_social, f.receptor_cuit, f.receptor_condicion_iva,
    f.receptor_doc_tipo, f.receptor_doc_nro,
    (p_comprobante->>'neto')::numeric,
    (p_comprobante->>'iva_monto')::numeric,
    coalesce((p_comprobante->>'exento')::numeric, 0),
    coalesce((p_comprobante->>'no_gravado')::numeric, 0),
    (p_comprobante->>'total')::numeric,
    p_comprobante->>'cae',
    (p_comprobante->>'cae_vencimiento')::date,
    (p_comprobante->>'fecha_comprobante')::date,
    p_comprobante->>'arca_ambiente',
    p_comprobante->>'arca_resultado',
    p_comprobante->'arca_observaciones',
    v_factura,
    (p_comprobante->>'emitido_por')::uuid
  from public.comprobantes f
  where f.id = v_factura
  returning id into v_id;

  insert into public.comprobantes_iva (comprobante_id, alicuota_id, base_imponible, importe)
  select v_id,
         (x->>'id')::integer,
         (x->>'base_imponible')::numeric,
         (x->>'importe')::numeric
    from jsonb_array_elements(coalesce(p_comprobante->'iva', '[]'::jsonb)) as x;

  return v_resultado || jsonb_build_object('nota_credito_id', v_id);
end;
$function$;

-- La firma vieja de 6 argumentos queda colgando después del `create or replace`
-- con el argumento nuevo: Postgres las trata como dos funciones distintas y
-- PostgREST resolvería la llamada sin `p_reintegro_metodo_id` contra la vieja,
-- que ya no existe... pero la de 5 de `anular_venta` sí quedaría. Se borran.
drop function if exists public.anular_venta(uuid, text, uuid, text, text);
drop function if exists public.anular_venta_facturada(uuid, text, uuid, text, text, jsonb);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. DEVOLUCIÓN PARCIAL
--
-- Además del medio, la elección DESBLOQUEA lo que antes se rechazaba: los
-- guards `VENTA_CON_PAGO_MIXTO` y `METODO_NO_DEVOLVIBLE` existían porque la
-- función tenía que deducir de dónde sacaba la plata. Con el medio declarado no
-- hay nada que deducir, así que una venta cobrada con tarjeta —o con dos
-- métodos— ya se puede devolver parcialmente. Sin elección, los guards siguen.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_devolucion(
  p_venta_id uuid,
  p_lineas jsonb,
  p_motivo_codigo text default null::text,
  p_motivo_detalle text default null::text,
  p_turno_id uuid default null::uuid,
  p_reintegro_metodo_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio        uuid := security.current_negocio_id();
  v_usuario        uuid := auth.uid();
  v_venta          public.ventas%rowtype;
  v_pago           public.venta_pagos%rowtype;
  v_cobros         int;
  v_linea          jsonb;
  v_item           public.ventas_items%rowtype;
  v_cantidad       numeric;
  v_destino        text;
  v_base           numeric := 0;
  v_base_total     numeric;
  v_base_previa    numeric;
  v_es_cc          boolean;
  v_recargo_cc     numeric := 0;
  v_reduccion      numeric := 0;
  v_saldo          numeric;
  v_credito        numeric := 0;
  v_excedente      numeric := 0;
  v_metodo_tipo    text;
  v_metodo_nombre  text;
  v_devolucion_id  uuid;
  v_items          jsonb := '[]'::jsonb;
  v_ticket         text := upper(split_part(p_venta_id::text, '-', 1));
  v_rein_id        uuid;
  v_rein_tipo      text;
  v_rein_nombre    text;
  v_sale_de_caja   boolean;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.tiene_permiso('ventas.devolver') then
    raise exception 'SIN_PERMISO';
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'SIN_RENGLONES';
  end if;

  select r.metodo_id, r.metodo_tipo, r.metodo_nombre
    into v_rein_id, v_rein_tipo, v_rein_nombre
    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found or v_venta.negocio_id is distinct from v_negocio then
    raise exception 'VENTA_INEXISTENTE';
  end if;

  if v_venta.vendedor_id is distinct from v_usuario
     and not public.tiene_permiso('ventas.ver_todas') then
    raise exception 'VENTA_AJENA';
  end if;

  if v_venta.estado_operacion <> 'CONFIRMADA' then
    raise exception 'VENTA_NO_DEVOLVIBLE';
  end if;

  v_es_cc := coalesce(v_venta.monto_pendiente, 0) > 0;

  if v_es_cc then
    if v_venta.cliente_id is null then
      raise exception 'VENTA_CC_SIN_CLIENTE';
    end if;

    v_metodo_tipo := 'CUENTA_CORRIENTE';
    v_metodo_nombre := 'Cuenta corriente';
  else
    -- SECURITY DEFINER: sin `negocio_id` aca, un cobro insertado desde otro
    -- comercio contra esta venta cuenta como si fuera propio.
    select count(*) into v_cobros
      from public.venta_pagos
     where venta_id = p_venta_id
       and negocio_id = v_negocio
       and tipo_movimiento = 'PAGO_VENTA';

    if v_cobros = 1 then
      select * into v_pago
        from public.venta_pagos
       where venta_id = p_venta_id
         and negocio_id = v_negocio
         and tipo_movimiento = 'PAGO_VENTA';

      v_metodo_tipo := v_pago.metodo_tipo;
      v_metodo_nombre := v_pago.metodo_nombre;
    else
      -- Mas de un cobro (o ninguno): no hay UN medio del que hablar.
      v_metodo_tipo := 'MIXTO';
      v_metodo_nombre := null;
    end if;

    -- Los dos guards viejos aplican SOLO cuando nadie declaro el medio: son la
    -- forma de no adivinar, no una regla del negocio.
    if v_rein_id is null then
      if v_cobros <> 1 then
        raise exception 'VENTA_CON_PAGO_MIXTO';
      end if;

      if v_metodo_tipo not in ('EFECTIVO', 'TRANSFERENCIA') then
        raise exception 'METODO_NO_DEVOLVIBLE';
      end if;
    end if;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_cantidad := (v_linea->>'cantidad')::numeric;
    v_destino  := coalesce(v_linea->>'destino', 'STOCK');

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'CANTIDAD_INVALIDA';
    end if;

    if v_destino not in ('STOCK', 'BAJA') then
      raise exception 'DESTINO_INVALIDO';
    end if;

    update public.ventas_items
       set cantidad_devuelta = cantidad_devuelta + v_cantidad
     where id = (v_linea->>'venta_item_id')::uuid
       and venta_id = p_venta_id
       and negocio_id = v_negocio
       and cantidad_devuelta + v_cantidad <= cantidad
    returning * into v_item;

    if not found then
      raise exception 'DEVOLUCION_EXCEDE_LO_VENDIDO';
    end if;

    v_base := v_base + (v_item.precio_final * v_cantidad);

    v_items := v_items || jsonb_build_object(
      'venta_item_id', v_item.id,
      'variante_id',   v_item.variante_id,
      'cantidad',      v_cantidad,
      'precio_final',  v_item.precio_final,
      'destino',       v_destino
    );
  end loop;

  -- `v_base_total` es el denominador del prorrateo del recargo de cuenta
  -- corriente y la base de `venta_totalmente_devuelta`: un renglon fantasma de
  -- otro negocio lo inflaria.
  select coalesce(sum(precio_final * cantidad), 0),
         coalesce(sum(precio_final * cantidad_devuelta), 0)
    into v_base_total, v_base_previa
    from public.ventas_items
   where venta_id = p_venta_id
     and negocio_id = v_negocio;

  if v_es_cc then
    if coalesce(v_venta.recargo_cc_monto, 0) > 0 and v_base_total > 0 then
      v_recargo_cc := round(v_venta.recargo_cc_monto * v_base / v_base_total);
    end if;

    v_reduccion := v_base + v_recargo_cc;

    select coalesce(saldo_pendiente, 0) into v_saldo
      from public.clientes
     where id = v_venta.cliente_id
       and negocio_id = v_negocio
       for update;

    if not found then
      raise exception 'CLIENTE_INEXISTENTE';
    end if;

    v_credito := least(v_reduccion, greatest(coalesce(v_saldo, 0), 0));
    v_excedente := v_reduccion - v_credito;

    if v_credito > 0 then
      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por
      ) values (
        v_negocio, v_venta.cliente_id, p_venta_id, 'CREDITO', v_credito,
        'Devolucion parcial - Venta #' || v_ticket, v_usuario
      );

      update public.clientes
         set saldo_pendiente = greatest(0, coalesce(saldo_pendiente, 0) - v_credito)
       where id = v_venta.cliente_id
         and negocio_id = v_negocio;
    end if;
  end if;

  -- La plata sale del cajon si el medio ELEGIDO es efectivo; sin eleccion,
  -- si el medio del cobro lo era. La cuenta corriente nunca sale de la caja:
  -- no se devuelve plata, se le baja la deuda.
  v_sale_de_caja := (not v_es_cc)
    and coalesce(v_rein_tipo, v_metodo_tipo) = 'EFECTIVO';

  insert into public.devoluciones (
    negocio_id, venta_id, base_devuelta, recargo_devuelto, monto_devuelto,
    recargo_cc_perdonado, credito_cc, excedente_a_devolver,
    metodo_tipo, metodo_nombre, turno_caja_id, motivo_codigo, motivo_detalle,
    reintegro_metodo_id, reintegro_metodo_tipo, reintegro_metodo_nombre,
    creado_por
  ) values (
    v_negocio, p_venta_id, v_base, 0, v_base + v_recargo_cc,
    v_recargo_cc, v_credito, v_excedente,
    v_metodo_tipo, v_metodo_nombre,
    case when v_sale_de_caja then p_turno_id end,
    p_motivo_codigo,
    nullif(btrim(coalesce(p_motivo_detalle, '')), ''),
    v_rein_id, v_rein_tipo, v_rein_nombre,
    v_usuario
  )
  returning id into v_devolucion_id;

  insert into public.devoluciones_items (
    negocio_id, devolucion_id, venta_item_id, variante_id,
    cantidad, precio_final, destino
  )
  select v_negocio, v_devolucion_id, r.venta_item_id, r.variante_id,
         r.cantidad, r.precio_final, r.destino
    from jsonb_to_recordset(v_items) as r(
      venta_item_id uuid, variante_id uuid, cantidad numeric,
      precio_final numeric, destino text
    );

  update public.ventas
     set monto_devuelto      = coalesce(monto_devuelto, 0) + v_base + v_recargo_cc,
         base_devuelta       = coalesce(base_devuelta, 0) + v_base,
         recargo_cc_devuelto = coalesce(recargo_cc_devuelto, 0) + v_recargo_cc
   where id = p_venta_id
     and negocio_id = v_negocio;

  if v_sale_de_caja and v_base > 0 then
    insert into public.egresos (negocio_id, concepto, monto, creado_por, turno_caja_id)
    values (
      v_negocio,
      'Devolucion parcial - Venta #' || v_ticket,
      round(v_base)::int,
      v_usuario,
      p_turno_id
    );
  end if;

  return jsonb_build_object(
    'devolucion_id', v_devolucion_id,
    'es_cuenta_corriente', v_es_cc,
    'base_devuelta', v_base,
    'recargo_devuelto', 0,
    'recargo_cc_perdonado', v_recargo_cc,
    'monto_devuelto', v_base + v_recargo_cc,
    'credito_cc', v_credito,
    'excedente_a_devolver', v_excedente,
    'recargo_no_devuelto', case
      when coalesce(v_venta.recargo_metodo_total, 0) > 0 and v_base_total > 0
      then round(v_venta.recargo_metodo_total * v_base / v_base_total)
      else 0 end,
    'metodo_tipo', v_metodo_tipo,
    'metodo_nombre', v_metodo_nombre,
    'reintegro_metodo_tipo', v_rein_tipo,
    'reintegro_metodo_nombre', v_rein_nombre,
    'sale_de_caja', v_sale_de_caja,
    'venta_totalmente_devuelta', v_base_previa >= v_base_total
  );
end;
$function$;

drop function if exists public.registrar_devolucion(uuid, jsonb, text, text, uuid);

-- ─────────────────────────────────────────────────────────────────────────
-- 5bis. LOS GRANTS, QUE NO VIAJAN SOLOS
--
-- Agregar un argumento crea una función NUEVA, no reemplaza la vieja, así que
-- los permisos de ejecución no se heredan: nacería con EXECUTE para PUBLIC,
-- que es más abierto que lo que tenían. Se repite el ACL exacto que ya estaba.
-- ─────────────────────────────────────────────────────────────────────────

revoke all on function public.anular_venta(uuid, text, uuid, text, text, uuid) from public;
grant execute on function public.anular_venta(uuid, text, uuid, text, text, uuid)
  to anon, authenticated, service_role;

revoke all on function public.registrar_devolucion(uuid, jsonb, text, text, uuid, uuid) from public;
grant execute on function public.registrar_devolucion(uuid, jsonb, text, text, uuid, uuid)
  to anon, authenticated, service_role;

grant execute on function public.anular_venta_facturada(uuid, text, uuid, text, text, jsonb, uuid)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. GUARDS
--
-- Mismo criterio que el guard de policies de 20260816100000 y el de
-- `unidades_serie` de 20260904140000: lo que esta migración vino a garantizar
-- tiene que fallar acá si un `create or replace` posterior lo borra.
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_cuerpo text;
begin
  if not exists (select 1 from public.permisos where clave = 'ventas.elegir_medio_devolucion') then
    raise exception 'GUARD: falta el permiso ventas.elegir_medio_devolucion';
  end if;

  -- El permiso NO puede haber quedado en un rol que no sea ADMIN: elegir
  -- "efectivo" es sacar plata del cajon.
  if exists (
    select 1
      from public.rol_permisos rp
      join public.roles r on r.id = rp.rol_id
      join public.permisos p on p.id = rp.permiso_id
     where p.clave = 'ventas.elegir_medio_devolucion'
       and r.nombre <> 'ADMIN'
  ) then
    raise exception 'GUARD: ventas.elegir_medio_devolucion quedo en un rol que no es ADMIN';
  end if;

  for v_cuerpo in
    select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('anular_venta', 'registrar_devolucion')
  loop
    if v_cuerpo not like '%resolver_medio_reintegro%' then
      raise exception 'GUARD: una RPC de devolucion dejo de resolver el medio del reintegro';
    end if;
  end loop;

  -- Una sola version de cada una: dos firmas hacen que PostgREST elija la
  -- vieja cuando la llamada no manda el argumento nuevo.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'anular_venta') <> 1 then
    raise exception 'GUARD: quedo mas de una version de anular_venta';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'registrar_devolucion') <> 1 then
    raise exception 'GUARD: quedo mas de una version de registrar_devolucion';
  end if;
end;
$guard$;

commit;
