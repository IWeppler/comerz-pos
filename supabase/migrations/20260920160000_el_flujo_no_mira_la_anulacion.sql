-- El FLUJO de dinero deja de mirar si la venta se anuló. Mira los movimientos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL ERROR DE FONDO: UNA COLUMNA, DOS PREGUNTAS
--
-- `venta_pagos.estado_pago_operacion = 'ANULADO'` se usaba para contestar dos
-- preguntas distintas, y para una de las dos la respuesta era falsa:
--
--   ¿ENTRÓ esta plata al cajón?      → contestaba "no". Falso: entró, y salió
--                                       después, por el egreso de la devolución.
--   ¿cuenta como INGRESO/venta?      → contestaba "no". Correcto.
--
-- Como el arqueo usaba la primera Y ADEMÁS restaba el egreso, el efectivo se
-- descontaba DOS VECES.
--
-- Medido el 20/9/2026: **17 turnos, 19 anulaciones, $1.036.999**. Y el dato que
-- cierra el caso: **19 de 19 se anularon ANTES del cierre**, o sea que el
-- `efectivo_esperado` que la cajera vio y firmó ya estaba mal en los 17.
-- Cuatro quedaron con esperado NEGATIVO, que es imposible: ClickTostado
-- −$950.000 (declaró $950.000, "diferencia" +$1.900.000), Evens −$19.100 y
-- −$4.000, Librería Colores −$625.
--
-- El sistema ya lo estaba mostrando sin saber qué era: `caja-history-table.tsx`
-- pinta "⚠ Esperado negativo" desde antes de este arreglo. Era esto.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL SEGUNDO BUG ES EL MISMO ERROR POR EL OTRO LADO
--
-- La devolución PARCIAL nunca tocó `venta_pagos`, así que devolver por un medio
-- que no es efectivo dejaba el cobro contado entero como plata por acreditar:
-- entraron $100.000 y salieron $30.000, y el sistema seguía diciendo $100.000.
-- Son 3 devoluciones, $63.000, todas de Evens por TRANSFERENCIA MERCADO PAGO.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA REGLA
--
--   Efectivo del turno   = TODOS los cobros en efectivo (anulados incluidos)
--                          − egresos.
--   Digital              = cobros digitales, MENOS los que se revirtieron por
--                          su propio medio, menos los reintegros parciales.
--   Ingresos / ventas    = solo los NO anulados. SIN CAMBIO.
--
-- La asimetría entre efectivo y digital no es un descuido: en el cajón la
-- salida tiene un movimiento propio registrado (el egreso), y en el banco no
-- hay ninguno. Por eso el efectivo suma siempre y resta el egreso, mientras que
-- en digital "revertido por su propio medio" es la única forma de representar
-- que el banco dio marcha atrás.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LO QUE NO SE TOCA: los 17 cierres firmados
--
-- `turnos_caja.efectivo_esperado` y `diferencia` quedan como estaban: son el
-- número que la cajera vio y firmó, y eso es un hecho histórico. Lo que se
-- corrige solo es `efectivo_esperado_actual`, que el historial ya recalcula con
-- `efectivo_actual_turnos` y muestra con el badge AJUSTADO. Los cuatro
-- esperados negativos dejan de serlo sin reescribir un solo cierre.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LA FUENTE ÚNICA DE REINTEGROS
--
-- "Qué le devolvimos al cliente y por qué medio", con las dos formas que
-- existen —anular el ticket entero y devolver renglones sueltos— en la misma
-- forma. Escrito dos veces, la primera corrección se aplica a una sola.
--
-- `security_invoker` para que la RLS de las tablas base siga valiendo cuando la
-- vista se consulta desde la app. Las funciones SECURITY DEFINER que la usan
-- filtran `negocio_id` a mano igual, que es la regla de esta base.
-- ─────────────────────────────────────────────────────────────────────────

create or replace view public.reintegros_al_cliente
with (security_invoker = true)
as
-- Devoluciones de renglones sueltos. La cuenta corriente queda afuera: ahí no
-- se devuelve plata, se le baja la deuda al cliente.
select
  d.negocio_id,
  d.venta_id,
  'DEVOLUCION'::text                                          as origen,
  d.creado_en                                                 as fecha,
  d.reintegro_metodo_id                                       as metodo_id,
  coalesce(d.reintegro_metodo_tipo, d.metodo_tipo)            as metodo_tipo,
  coalesce(d.reintegro_metodo_nombre, d.metodo_nombre)        as metodo_nombre,
  d.base_devuelta                                             as monto
from public.devoluciones d
where coalesce(d.reintegro_metodo_tipo, d.metodo_tipo) <> 'CUENTA_CORRIENTE'
  and d.base_devuelta > 0

union all

-- Anulaciones CON medio declarado: una sola salida, por el medio elegido.
select
  v.negocio_id,
  v.id,
  'ANULACION'::text,
  v.anulada_en,
  v.reintegro_metodo_id,
  v.reintegro_metodo_tipo,
  v.reintegro_metodo_nombre,
  (select coalesce(sum(vp.monto_base), 0)
     from public.venta_pagos vp
    where vp.venta_id = v.id
      and vp.negocio_id = v.negocio_id
      and vp.tipo_movimiento = 'PAGO_VENTA')
from public.ventas v
where v.estado_operacion = 'ANULADA'
  and v.reintegro_metodo_id is not null

union all

-- Anulaciones SIN medio declarado (todo lo anterior al 20/9/2026): la plata
-- vuelve por donde vino, así que hay una salida por cada cobro.
select
  v.negocio_id,
  v.id,
  'ANULACION'::text,
  v.anulada_en,
  vp.metodo_pago_id,
  vp.metodo_tipo,
  vp.metodo_nombre,
  vp.monto_base
from public.ventas v
join public.venta_pagos vp
  on vp.venta_id = v.id
 and vp.negocio_id = v.negocio_id
 and vp.tipo_movimiento = 'PAGO_VENTA'
where v.estado_operacion = 'ANULADA'
  and v.reintegro_metodo_id is null;

comment on view public.reintegros_al_cliente is
  'Que le devolvimos al cliente y por que medio, unificando anulaciones y devoluciones parciales. La cuenta corriente no entra: ahi no sale plata, baja la deuda.';

grant select on public.reintegros_al_cliente to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. EL EFECTIVO DEL TURNO CUENTA TODOS LOS COBROS
--
-- Las tres funciones decían lo mismo con la misma línea de más. Se saca en las
-- tres a la vez porque son el MISMO número visto desde tres pantallas (el
-- cierre, el historial y Dinero): arreglar una sola haría que discrepen, que es
-- peor que el bug.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.flujo_caja_turno(p_turno_id uuid)
returns numeric
language plpgsql
stable security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_flujo numeric;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.operar')
     and not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select
    -- SIN filtrar ANULADO: esa plata entró al cajón. Si volvió, volvió por el
    -- egreso de la devolución, que se resta abajo. Ver el encabezado.
    coalesce((select sum(vp.monto_bruto)
      from public.venta_pagos vp
      where vp.negocio_id = t.negocio_id
        and vp.turno_caja_id = t.id
        and vp.metodo_tipo = 'EFECTIVO'), 0)
    - coalesce((select sum(e.monto)
      from public.egresos e
      where e.negocio_id = t.negocio_id
        and e.turno_caja_id = t.id
        and e.cuenta_origen_id = t.cuenta_financiera_id), 0)
    + coalesce((select sum(m.importe)
      from public.movimientos_financieros m
      where m.negocio_id = t.negocio_id
        and m.turno_caja_id = t.id
        and m.cuenta_financiera_id = t.cuenta_financiera_id
        and m.origen_tipo = 'TRANSFERENCIA'), 0)
    into v_flujo
    from public.turnos_caja t
   where t.id = p_turno_id and t.negocio_id = v_negocio;
  return coalesce(v_flujo, 0);
end;
$$;

revoke all on function public.flujo_caja_turno(uuid) from public, anon;
grant execute on function public.flujo_caja_turno(uuid) to authenticated;

create or replace function public.efectivo_actual_turnos(p_turno_ids uuid[])
returns table (turno_id uuid, efectivo_esperado_actual numeric)
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.operar')
     and not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  return query
  select t.id, t.monto_inicial
    -- Mismo criterio que flujo_caja_turno, y tiene que seguir siéndolo: este
    -- es el número que el historial compara contra el que se firmó al cerrar.
    + coalesce((select sum(vp.monto_bruto) from public.venta_pagos vp
        where vp.negocio_id = t.negocio_id and vp.turno_caja_id = t.id
          and vp.metodo_tipo = 'EFECTIVO'), 0)
    - coalesce((select sum(e.monto) from public.egresos e
        where e.negocio_id = t.negocio_id and e.turno_caja_id = t.id
          and e.cuenta_origen_id = t.cuenta_financiera_id), 0)
    + coalesce((select sum(m.importe) from public.movimientos_financieros m
        where m.negocio_id = t.negocio_id and m.turno_caja_id = t.id
          and m.cuenta_financiera_id = t.cuenta_financiera_id
          and m.origen_tipo = 'TRANSFERENCIA'), 0)
    from public.turnos_caja t
   where t.negocio_id = v_negocio
     and t.id = any(coalesce(p_turno_ids, '{}'::uuid[]));
end;
$$;

revoke all on function public.efectivo_actual_turnos(uuid[]) from public, anon;
grant execute on function public.efectivo_actual_turnos(uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. POSICIÓN DE DINERO
--
-- Reescrita desde el cuerpo VIVO (`pg_get_functiondef`), no desde el último
-- archivo que la tocó: la regla de `20260904140000`. Cambia tres cosas y nada
-- más — el efectivo del turno cuenta todo, el bloque digital deja de mirar el
-- estado de la venta, y se restan los reintegros parciales.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.posicion_dinero(
  p_desde date default null::date,
  p_hasta date default null::date,
  p_periodo text default null::text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid := security.current_negocio_id();
  v_hoy date := (now() at time zone v_tz)::date;
  v_hasta date;
  v_desde date;
  v_out jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver la posición de dinero' using errcode='42501';
  end if;
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode='42501';
  end if;

  if p_periodo is not null then
    v_hasta := v_hoy;
    v_desde := case p_periodo
      when 'hoy' then v_hoy
      when 'semana' then date_trunc('week', v_hoy)::date
      when 'mes' then date_trunc('month', v_hoy)::date
      when 'anio' then date_trunc('year', v_hoy)::date
      else v_hoy end;
  else
    v_hasta := coalesce(p_hasta, v_hoy);
    v_desde := coalesce(p_desde, v_hasta - 29);
  end if;

  with turnos_abiertos as (
    select t.id, t.monto_inicial, t.fecha_apertura, t.vendedor_id,
           t.cuenta_financiera_id, coalesce(p.nombre, 'Sin nombre') vendedor
      from public.turnos_caja t
      left join public.perfiles p on p.id = t.vendedor_id
     where t.negocio_id = v_negocio and t.estado <> 'CERRADO'
  ), efectivo_turno as (
    -- SIN filtrar ANULADO, igual que flujo_caja_turno. Ver el encabezado.
    select vp.turno_caja_id, sum(vp.monto_bruto) ingresos
      from public.venta_pagos vp
      join turnos_abiertos t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio and vp.metodo_tipo = 'EFECTIVO'
     group by vp.turno_caja_id
  ), egresos_turno as (
    select e.turno_caja_id, sum(e.monto) salidas
      from public.egresos e
      join turnos_abiertos t on t.id = e.turno_caja_id
       and e.cuenta_origen_id = t.cuenta_financiera_id
     where e.negocio_id = v_negocio
     group by e.turno_caja_id
  ), transferencias_turno as (
    select m.turno_caja_id, sum(m.importe) neto
      from public.movimientos_financieros m
      join turnos_abiertos t on t.id = m.turno_caja_id
       and t.cuenta_financiera_id = m.cuenta_financiera_id
     where m.negocio_id = v_negocio and m.origen_tipo = 'TRANSFERENCIA'
     group by m.turno_caja_id
  ), cajas as (
    select t.id, t.vendedor, t.fecha_apertura, t.monto_inicial,
           coalesce(e.ingresos, 0) ingresos,
           coalesce(g.salidas, 0) salidas,
           coalesce(x.neto, 0) transferencias_netas,
           t.monto_inicial + coalesce(e.ingresos, 0) - coalesce(g.salidas, 0)
             + coalesce(x.neto, 0) esperado
      from turnos_abiertos t
      left join efectivo_turno e on e.turno_caja_id = t.id
      left join egresos_turno g on g.turno_caja_id = t.id
      left join transferencias_turno x on x.turno_caja_id = t.id
  ), digitales as (
    -- El cobro digital cuenta SALVO que se haya revertido por su propio medio.
    -- Esa es la única forma de representar que el banco dio marcha atrás: a
    -- diferencia del cajón, acá no hay egreso que registre la salida.
    -- Al revés: si la venta se anuló pero la plata se devolvió por OTRO medio,
    -- el banco no reversó nada y ese cobro sigue viniendo.
    select vp.metodo_nombre, vp.metodo_tipo, vp.monto_bruto, vp.comision_monto,
           vp.monto_neto,
           vp.creado_en + (vp.acreditacion_dias || ' days')::interval fecha_acreditacion
      from public.venta_pagos vp
      left join public.ventas v on v.id = vp.venta_id and v.negocio_id = vp.negocio_id
     where vp.negocio_id = v_negocio
       and vp.metodo_tipo <> 'EFECTIVO'
       and (
         vp.estado_pago_operacion <> 'ANULADO'
         or (v.reintegro_metodo_id is not null
             and v.reintegro_metodo_id is distinct from vp.metodo_pago_id)
       )
  ), pendientes as (
    select metodo_nombre, metodo_tipo, count(*) cantidad, sum(monto_bruto) bruto,
           sum(comision_monto) comision, sum(monto_neto) neto,
           min(fecha_acreditacion) proxima, max(fecha_acreditacion) ultima
      from digitales where fecha_acreditacion > now()
     group by metodo_nombre, metodo_tipo
  ), acreditados as (
    select metodo_nombre, metodo_tipo, count(*) cantidad, sum(monto_bruto) bruto,
           sum(comision_monto) comision, sum(monto_neto) neto
      from digitales
     where fecha_acreditacion <= now()
       and (fecha_acreditacion at time zone v_tz)::date between v_desde and v_hasta
     group by metodo_nombre, metodo_tipo
  ), reintegros_digitales as (
    -- Lo que se le devolvió al cliente por un medio que no es efectivo. En
    -- efectivo no hace falta: ahí el egreso ya lo resta del cajón.
    -- Se cuentan SOLO los de devolución parcial: los de anulación ya están
    -- representados arriba, porque su cobro no entra a `digitales`.
    -- La fecha que manda es la del reintegro, no la del cobro: la plata sale
    -- ese día. Si el cobro todavía no había acreditado, el bloque "ya
    -- acreditado" de ese medio puede quedar en negativo, y está bien: es una
    -- salida real.
    select r.metodo_nombre, r.metodo_tipo, count(*) cantidad, sum(r.monto) monto
      from public.reintegros_al_cliente r
     where r.negocio_id = v_negocio
       and r.origen = 'DEVOLUCION'
       and r.metodo_tipo <> 'EFECTIVO'
       and (r.fecha at time zone v_tz)::date between v_desde and v_hasta
     group by r.metodo_nombre, r.metodo_tipo
  ), acreditado_neto as (
    select coalesce(a.metodo_nombre, d.metodo_nombre) metodo_nombre,
           coalesce(a.metodo_tipo, d.metodo_tipo) metodo_tipo,
           coalesce(a.cantidad, 0) cantidad,
           coalesce(a.bruto, 0) - coalesce(d.monto, 0) bruto,
           coalesce(a.comision, 0) comision,
           coalesce(a.neto, 0) - coalesce(d.monto, 0) neto,
           coalesce(d.monto, 0) reintegrado
      from acreditados a
      full join reintegros_digitales d
        on d.metodo_nombre is not distinct from a.metodo_nombre
       and d.metodo_tipo = a.metodo_tipo
  ), efectivo_cerrado as (
    select coalesce(sum(monto_declarado), 0) declarado
      from public.turnos_caja
     where negocio_id = v_negocio and estado = 'CERRADO'
       and (fecha_cierre at time zone v_tz)::date = v_hoy
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', p_periodo,
    'generado_en', now(),
    'efectivo', jsonb_build_object(
      'total', (select coalesce(sum(esperado), 0) from cajas),
      'turnos_abiertos', (select count(*) from cajas),
      'cerrado_hoy', (select declarado from efectivo_cerrado),
      'cajas', (select coalesce(jsonb_agg(jsonb_build_object(
          'turno_id', id, 'vendedor', vendedor, 'desde', fecha_apertura,
          'inicial', monto_inicial, 'ingresos', ingresos, 'salidas', salidas,
          'transferencias_netas', transferencias_netas, 'esperado', esperado
        ) order by esperado desc), '[]'::jsonb) from cajas)
    ),
    'por_acreditar', (select coalesce(jsonb_agg(jsonb_build_object(
        'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo,
        'cantidad', cantidad, 'bruto', bruto, 'comision', comision,
        'neto', neto, 'proxima', proxima, 'ultima', ultima
      ) order by neto desc), '[]'::jsonb) from pendientes),
    'acreditado', (select coalesce(jsonb_agg(jsonb_build_object(
        'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo,
        'cantidad', cantidad, 'bruto', bruto, 'comision', comision, 'neto', neto
      ) order by neto desc), '[]'::jsonb) from acreditado_neto),
    -- Se devuelve APARTE además de restarse: un total que baja sin decir por
    -- qué es un número que nadie puede verificar.
    'reintegros', (select coalesce(jsonb_agg(jsonb_build_object(
        'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo,
        'cantidad', cantidad, 'monto', monto
      ) order by monto desc), '[]'::jsonb) from reintegros_digitales)
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.posicion_dinero(date, date, text) from public, anon;
grant execute on function public.posicion_dinero(date, date, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RESUMEN GERENCIAL: EL ARQUEO Y LA FACTURACIÓN SE SEPARAN
--
-- `pagos` contestaba las dos preguntas a la vez. Ahora hay dos CTE: `pagos`
-- sigue siendo la de VENTAS (excluye anulados, alimenta total_cobrado,
-- breakdown_medios y cuenta corriente) y `pagos_caja` es la del CAJÓN (cuenta
-- todo). Que el desglose por medio y el esperado difieran en un día con una
-- anulación es correcto y es justo lo que antes no se podía ver.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.resumen_gerencial_caja(p_fecha date default null::date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_fecha date := coalesce(p_fecha, (now() at time zone v_tz)::date);
  v_negocio uuid := security.current_negocio_id();
  v_out jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver el resumen gerencial de caja' using errcode='42501';
  end if;
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode='42501';
  end if;

  with turnos_dia as (
    select id, estado, monto_inicial, monto_declarado, cuenta_financiera_id
      from public.turnos_caja
     where negocio_id = v_negocio
       and (fecha_apertura at time zone v_tz)::date = v_fecha
  ), pagos as (
    -- VENTAS: lo anulado no es venta.
    select vp.venta_id, vp.metodo_tipo, vp.monto_bruto, vp.tipo_movimiento
      from public.venta_pagos vp
      join turnos_dia t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio
       and vp.estado_pago_operacion <> 'ANULADO'
  ), pagos_caja as (
    -- CAJÓN: la plata entró igual. La salida la representa el egreso.
    select vp.monto_bruto
      from public.venta_pagos vp
      join turnos_dia t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio
       and vp.metodo_tipo = 'EFECTIVO'
  ), ventas_dia as (
    select v.id, v.monto_pendiente
      from public.ventas v
      join turnos_dia t on t.id = v.turno_caja_id
     where v.negocio_id = v_negocio
       and v.estado_operacion <> 'ANULADA'
  ), tipos as (
    select * from (values ('EFECTIVO'), ('TRANSFERENCIA'), ('TARJETA')) c(tipo)
    union select metodo_tipo from pagos
  ), medios as (
    select metodo_tipo tipo, sum(monto_bruto) monto,
           count(distinct venta_id) filter (where venta_id is not null) cantidad_ventas,
           coalesce(sum(monto_bruto) filter (where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'), 0) monto_cobranzas_cc
      from pagos group by metodo_tipo
  ), breakdown as (
    select t.tipo, coalesce(m.monto, 0) monto,
           coalesce(m.cantidad_ventas, 0) cantidad_ventas,
           coalesce(m.monto_cobranzas_cc, 0) monto_cobranzas_cc
      from tipos t left join medios m on m.tipo = t.tipo
  ), egresos_caja as (
    select coalesce(sum(e.monto), 0) total
      from public.egresos e
      join turnos_dia t on t.id = e.turno_caja_id
       and t.cuenta_financiera_id = e.cuenta_origen_id
     where e.negocio_id = v_negocio
  ), transferencias_caja as (
    select coalesce(sum(m.importe), 0) neto
      from public.movimientos_financieros m
      join turnos_dia t on t.id = m.turno_caja_id
       and t.cuenta_financiera_id = m.cuenta_financiera_id
     where m.negocio_id = v_negocio and m.origen_tipo = 'TRANSFERENCIA'
  ), caja as (
    select (select coalesce(sum(monto_inicial), 0) from turnos_dia) fondo_inicial,
           (select coalesce(sum(monto_bruto), 0) from pagos_caja) ingresos_efectivo,
           (select total from egresos_caja) egresos_efectivo,
           (select neto from transferencias_caja) transferencias_netas,
           (select count(*) from turnos_dia) turnos_totales,
           (select count(*) from turnos_dia where estado <> 'CERRADO') turnos_abiertos,
           (select coalesce(sum(monto_declarado), 0) from turnos_dia where estado = 'CERRADO') real_declarado
  )
  select jsonb_build_object(
    'fecha', v_fecha,
    'generado_en', now(),
    'ventas', jsonb_build_object(
      'total_cobrado', (select coalesce(sum(monto_bruto), 0) from pagos where tipo_movimiento = 'PAGO_VENTA'),
      'cantidad_ventas', (select count(distinct venta_id) from pagos where tipo_movimiento = 'PAGO_VENTA' and venta_id is not null)
    ),
    'cuenta_corriente', jsonb_build_object(
      'fiado_otorgado', (select coalesce(sum(monto_pendiente), 0) from ventas_dia),
      'cantidad_ventas_con_fiado', (select count(*) from ventas_dia where monto_pendiente > 0),
      'cobranzas_monto', (select coalesce(sum(monto_bruto), 0) from pagos where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'),
      'cobranzas_cantidad', (select count(*) from pagos where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE')
    ),
    'breakdown_medios', (select coalesce(jsonb_agg(jsonb_build_object(
        'tipo', tipo, 'monto', monto, 'cantidad_ventas', cantidad_ventas,
        'monto_cobranzas_cc', monto_cobranzas_cc
      ) order by monto desc, tipo), '[]'::jsonb) from breakdown),
    'caja', (select jsonb_build_object(
        'fondo_inicial', fondo_inicial,
        'ingresos_efectivo', ingresos_efectivo,
        'egresos_efectivo', egresos_efectivo,
        'transferencias_netas', transferencias_netas,
        'esperado', fondo_inicial + ingresos_efectivo - egresos_efectivo + transferencias_netas,
        'turnos_totales', turnos_totales,
        'turnos_abiertos', turnos_abiertos,
        'cierre_completo', turnos_totales > 0 and turnos_abiertos = 0,
        'real_declarado', case when turnos_totales > 0 and turnos_abiertos = 0 then real_declarado end,
        'diferencia', case when turnos_totales > 0 and turnos_abiertos = 0
                      then real_declarado - (fondo_inicial + ingresos_efectivo - egresos_efectivo + transferencias_netas) end
      ) from caja)
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.resumen_gerencial_caja(date) from public, anon;
grant execute on function public.resumen_gerencial_caja(date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. ANULAR VUELVE A MARCAR SIEMPRE ANULADO
--
-- `20260920130000` dejaba el cobro CONFIRMADO cuando el reintegro salía por
-- otro medio, para que la plata de la tarjeta no desapareciera de "por
-- acreditar". Ese objetivo ahora lo cumple `posicion_dinero`, que mira
-- `reintegro_metodo_id` en vez del estado del cobro.
--
-- Volver a marcar siempre es mejor por dos motivos: ANULADO recupera UN solo
-- significado ("no fue venta"), y `rentabilidad_por_metodo` —que filtra por
-- `estado_pago_operacion` y no mira `ventas.estado_operacion`— deja de poder
-- contar una venta anulada dentro de su base.
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
  v_egreso numeric := 0;
  v_por_fuera numeric := 0;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

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

  -- SIEMPRE. `ANULADO` significa "no fue venta" y nada más; el flujo de dinero
  -- no lo mira. Ver el encabezado de la sección 5.
  update public.venta_pagos
     set estado_pago_operacion = 'ANULADO'
   where venta_id = p_venta_id;

  if v_rein_id is null then
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
    'reintegro_metodo_nombre', v_rein_nombre
  );
end;
$function$;

revoke all on function public.anular_venta(uuid, text, uuid, text, text, uuid) from public;
grant execute on function public.anular_venta(uuid, text, uuid, text, text, uuid)
  to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. GUARDS
--
-- Lo que esta migración vino a garantizar tiene que fallar acá si un
-- `create or replace` posterior lo borra. Mismo criterio que 20260816100000 y
-- 20260904140000.
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_nombre text;
  v_cuerpo text;
begin
  -- Ninguna de las tres cuentas de efectivo del turno puede volver a excluir
  -- los cobros anulados: eso es exactamente el doble descuento.
  for v_nombre, v_cuerpo in
    select p.proname, pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('flujo_caja_turno', 'efectivo_actual_turnos')
  loop
    -- Se busca la COLUMNA, no la palabra: los comentarios de esas funciones
    -- nombran 'ANULADO' justamente para explicar por que no se filtra.
    if v_cuerpo like '%estado_pago_operacion%' then
      raise exception 'GUARD: % volvio a mirar el estado del cobro para el efectivo del turno', v_nombre;
    end if;
  end loop;

  if to_regclass('public.reintegros_al_cliente') is null then
    raise exception 'GUARD: falta la vista reintegros_al_cliente';
  end if;

  select pg_get_functiondef(p.oid) into v_cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'posicion_dinero';
  if v_cuerpo not like '%reintegros_al_cliente%' then
    raise exception 'GUARD: posicion_dinero dejo de restar los reintegros';
  end if;

  select pg_get_functiondef(p.oid) into v_cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resumen_gerencial_caja';
  if v_cuerpo not like '%pagos_caja%' then
    raise exception 'GUARD: resumen_gerencial_caja volvio a mezclar el arqueo con la facturacion';
  end if;
end;
$guard$;

commit;
