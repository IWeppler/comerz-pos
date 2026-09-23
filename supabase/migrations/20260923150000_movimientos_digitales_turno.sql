-- ═══════════════════════════════════════════════════════════════════════════
-- LO QUE PASÓ EN EL TURNO FUERA DEL CAJÓN
--
-- El caso que lo pidió (El Nono Cacho, 23/9/2026): una clienta pagó por
-- transferencia y se llevó efectivo del cajón. En "Mi turno" aparecía la
-- salida de efectivo y NO la entrada digital, así que la pantalla mostraba
-- media operación y la vendedora tenía que creer que la otra mitad existía.
-- La entrada sí estaba en la pestaña Dinero, o sea en otra pantalla.
--
-- Por qué no aparecía, y por qué no es un bug de `transferencias_caja_turno`:
-- esa RPC pide `m.cuenta_financiera_id = t.cuenta_financiera_id`, o sea el
-- CAJÓN, porque lo suyo es alimentar el arqueo. Un movimiento a Mercado Pago
-- no toca el cajón y además nunca va a tener `turno_caja_id` —
-- `registrar_ingreso_financiero` solo lo escribe cuando la cuenta requiere
-- arqueo, y está bien que así sea: esa columna es del cajón.
--
-- Entonces la pregunta de esta función es OTRA —"¿qué más se registró
-- mientras mi turno estuvo abierto?"— y por eso la ventana es de TIEMPO
-- (apertura → cierre, o ahora si sigue abierto) y no `turno_caja_id`.
--
-- ───────────────────────────────────────────────────────────────────────────
-- QUÉ QUEDA ADENTRO Y QUÉ NO
--
-- * Solo cuentas NO efectivo (`es_efectivo = false`). La caja general es
--   efectivo pero no es el cajón de nadie: es la del dueño, se mira en
--   Dinero, y meterla en una tarjeta que dice "digitales" sería rotular mal.
--   El puente de acreditación queda afuera por lo mismo: no es una cuenta,
--   es una sala de espera.
-- * Se excluye `VENTA_PAGO`: los cobros ya son el número grande de la
--   tarjeta. Listarlos otra vez acá sería contarlos dos veces a la vista.
-- * Se excluye `TURNO_CAJA`: la pata de la caja general del fondo y del
--   cierre (`20260921170000`) es el reflejo de algo que el arqueo YA muestra.
-- * Se excluye `ACREDITACION`: no la registró nadie en el turno, la
--   materializa `getPosicionDineroAction` cuando alguien abre Dinero, y va
--   fechada en la fecha ESPERADA del cobro — puede caer dentro de la ventana
--   de un turno que no tuvo nada que ver.
--
-- NADA de esto entra en el arqueo ni en `efectivo_esperado`: son cuentas que
-- no se cuentan con billetes en la mano. La tarjeta lo muestra al lado del
-- cajón y nunca sumado con él, que es la misma línea que no se cruza desde
-- el incidente del 30/7.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.movimientos_digitales_turno(p_turno_id uuid)
returns table (
  movimiento_id bigint,
  origen_tipo text,
  evento text,
  importe numeric,
  descripcion text,
  cuenta_nombre text,
  fecha_movimiento timestamptz
)
language plpgsql
stable security definer
set search_path = public, security, pg_temp
as $$
declare v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.operar')
     and not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  return query
  select m.id, m.origen_tipo, m.evento, m.importe, m.descripcion,
         c.nombre, m.fecha_movimiento
    from public.turnos_caja t
    join public.movimientos_financieros m
      on m.negocio_id = t.negocio_id
     and m.fecha_movimiento >= t.fecha_apertura
     and m.fecha_movimiento < coalesce(t.fecha_cierre, now())
    join public.cuentas_financieras c
      on c.id = m.cuenta_financiera_id
     and c.negocio_id = t.negocio_id
     and not c.es_efectivo
     and c.tipo <> 'PUENTE_ACREDITACION'
   where t.negocio_id = v_negocio
     and t.id = p_turno_id
     and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO', 'EGRESO', 'AJUSTE')
     -- Misma regla de visibilidad que `transferencias_caja_turno`: en caja
     -- ÚNICA lo ve quien esté operando, y en POR_USUARIO solo el dueño del
     -- turno o quien pueda cerrar ajenas.
     and (t.modo = 'UNICA' or t.vendedor_id = auth.uid()
          or public.tiene_permiso('caja.cerrar_ajena'))
   order by m.fecha_movimiento desc, m.id desc;
end;
$$;

revoke all on function public.movimientos_digitales_turno(uuid) from public, anon;
grant execute on function public.movimientos_digitales_turno(uuid) to authenticated;

comment on function public.movimientos_digitales_turno(uuid) is
  'Lo registrado en cuentas NO efectivo mientras el turno estuvo abierto, sin los cobros de venta (que son el total de la tarjeta) ni las patas de apertura/cierre. Ventana de TIEMPO, no turno_caja_id: un movimiento digital nunca lleva turno. No entra en el arqueo.';

-- ───────────────────────────────────────────────────────────────────────────
-- Guard: la función NO puede mirar el cajón. Si alguien le saca el filtro de
-- `es_efectivo`, los movimientos de la caja diaria entrarían en una tarjeta
-- que se muestra al lado del arqueo, y sumar dos veces la misma plata es
-- exactamente el incidente que este módulo viene evitando desde el 22/8.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'movimientos_digitales_turno';

  if v_def is null or position('not c.es_efectivo' in v_def) = 0 then
    raise exception 'GUARD: movimientos_digitales_turno tiene que excluir las cuentas de efectivo';
  end if;

  if position('VENTA_PAGO' in v_def) > 0 then
    raise exception 'GUARD: los cobros de venta no van en esta lista (ya son el total de la tarjeta)';
  end if;
end $$;
