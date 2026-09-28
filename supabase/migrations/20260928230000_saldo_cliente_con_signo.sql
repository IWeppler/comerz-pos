-- ---------------------------------------------------------------------------
-- Saldo a favor, etapa A: `clientes.saldo_pendiente` pasa a tener SIGNO.
--
-- Positivo = el cliente debe. Negativo = SALDO A FAVOR: el comercio le debe
-- al cliente (una seña, un pago de más, un vale por devolución).
--
-- Una sola columna con signo y no una `saldo_a_favor` aparte, a propósito: en
-- una cuenta corriente deuda y saldo a favor no conviven — el libro los
-- compensa solo (`recalcular_vencimiento_cc` ya resta TODO lo pagado contra el
-- acumulado de deudas, así que un crédito sobrante cubre la próxima deuda sin
-- que nadie lo impute). Dos columnas serían dos copias del mismo número, que
-- es el error del precio duplicado en productos/variantes.
--
-- Qué hizo falta cambiar para que el signo no rompa nada, relevado el
-- 28/9/2026 sobre el cuerpo vivo de las funciones y sobre el código:
--
-- * LECTURAS en la base: todas ya filtran `saldo_pendiente > 0`
--   (`antiguedad_saldo_cc`, `comercios_con_uso`, `metricas_globales_comerz`,
--   `rentabilidad_por_metodo`, `puede_fiar`, `validar_limite_cc_manual`), así
--   que un saldo a favor no se descuenta de "la deuda viva" ni ocupa cupo del
--   plan. No se tocan.
-- * `anular_venta` / `registrar_devolucion`: su `greatest(0, ...)` nunca
--   recorta, porque el crédito ya viene acotado a la deuda. No se tocan acá;
--   el reintegro "a cuenta" es la etapa B.
-- * ESCRITURAS desde Node que leían el saldo y lo escribían después, con
--   `Math.max(0, ...)`: cargar saldo inicial, editar y anular un movimiento
--   manual y perdonar deuda. Con saldo a favor el recorte ya no es inofensivo
--   —anular un débito de $1.000 a una clienta con $5.000 a favor la dejaba en
--   cero— y la lectura previa pierde un cobro concurrente. Pasan a esta
--   función: delta en un statement, sin recorte.
-- ---------------------------------------------------------------------------

comment on column public.clientes.saldo_pendiente is
  'Saldo de cuenta corriente, caché del libro (cuenta_corriente_movimientos: DEBITO suma, CREDITO resta). POSITIVO = el cliente debe. NEGATIVO = saldo a favor del cliente. Se mueve SIEMPRE con delta en el mismo statement (registrar_cobro_cc, ajustar_saldo_cliente, registrar_venta), nunca leyendo y escribiendo después, y nunca recortado a cero: el recorte es lo que escondía los saldos a favor.';

create or replace function public.ajustar_saldo_cliente(
  p_cliente_id uuid,
  p_delta numeric
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio     uuid := security.current_negocio_id();
  v_saldo       numeric;
  v_vencimiento date;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if p_cliente_id is null or p_delta is null then
    raise exception 'AJUSTE_SALDO_DATOS_INVALIDOS';
  end if;

  -- El movimiento del libro ya está escrito por quien llama: el vencimiento
  -- lo ve. Delta en el mismo statement, sin recorte.
  update public.clientes c
     set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + p_delta,
         fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(p_cliente_id)
   where c.id = p_cliente_id
     and c.negocio_id = v_negocio
  returning c.saldo_pendiente, c.fecha_vencimiento_deuda
    into v_saldo, v_vencimiento;

  -- Un UPDATE filtrado por RLS es un éxito silencioso: se falla fuerte.
  if not found then
    raise exception 'CLIENTE_NO_ENCONTRADO';
  end if;

  return jsonb_build_object(
    'saldo_pendiente', v_saldo,
    'fecha_vencimiento_deuda', v_vencimiento
  );
end;
$function$;

comment on function public.ajustar_saldo_cliente(uuid, numeric) is
  'Mueve el caché de saldo de un cliente por delta, en un statement y sin recorte a cero, y recalcula el vencimiento. El movimiento del libro lo escribe quien llama ANTES. SECURITY INVOKER.';

revoke all on function public.ajustar_saldo_cliente(uuid, numeric) from public, anon;
grant execute on function public.ajustar_saldo_cliente(uuid, numeric) to authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.ajustar_saldo_cliente(uuid, numeric)', 'execute') then
    raise exception 'GUARD: anon no puede ejecutar ajustar_saldo_cliente';
  end if;

  if pg_get_functiondef('public.ajustar_saldo_cliente(uuid, numeric)'::regprocedure)
     ~* 'greatest\s*\(\s*0' then
    raise exception 'GUARD: ajustar_saldo_cliente no puede recortar el saldo a cero';
  end if;

  -- Las lecturas que cuentan "deuda" tienen que seguir filtrando por > 0: un
  -- saldo a favor sumado ahí se restaría de la deuda de los demás.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('antiguedad_saldo_cc', 'comercios_con_uso',
                         'metricas_globales_comerz', 'rentabilidad_por_metodo',
                         'puede_fiar', 'validar_limite_cc_manual')
       and pg_get_functiondef(p.oid) !~* 'saldo_pendiente,\s*0\)\s*>\s*0|saldo_pendiente\s*>\s*0'
  ) then
    raise exception 'GUARD: alguna lectura de deuda dejó de filtrar saldo_pendiente > 0';
  end if;
end;
$guard$;
