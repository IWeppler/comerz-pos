-- De una caja que se arquea no puede salir plata que no está.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL CASO
--
-- El Nono Cacho, turno del 26/9/2026 a la tarde: fondo $286.600 + $89.199 de
-- ventas en efectivo = $375.799 en el cajón. A las 20:21–20:22 se cargaron
-- tres sueldos contra la Caja diaria por $400.000, y la base los aceptó: el
-- esperado cerró en −$24.201, que es imposible, y como la cajera contó lo que
-- de verdad había ($210.800) el arqueo mostró un SOBRANTE de $235.001. Los
-- sueldos se habían pagado en parte con otra plata, pero quedaron imputados
-- al cajón porque el modal de egreso usa "Caja diaria (tu turno abierto)" por
-- defecto.
--
-- Auditando del 17/9 al 28/9, el mismo patrón —un egreso grande cargado al
-- cajón y pagado por otro lado— explica también los sobrantes del 17/9
-- (+$182.452), 19/9 (+$81.501) y 24/9 (+$44.290). Esos no llegaron a dejar el
-- cajón en negativo, así que ninguna regla los hubiera frenado; el del 26/9
-- sí, y es el que no puede volver a pasar.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA REGLA
--
-- Un movimiento que SACA plata de una cuenta arqueada no puede dejar el saldo
-- de ese turno por debajo de cero. El saldo se lee del LEDGER (suma de los
-- movimientos del turno en esa cuenta), que es el mismo número que el arqueo
-- desde `20260920180000` — nunca de `turnos_caja.efectivo_esperado`, que en
-- un turno abierto está congelado en el fondo.
--
-- Va como trigger sobre `movimientos_financieros` y no sobre `egresos`
-- porque todo lo que saca plata del cajón termina ahí: egresos (incluidas las
-- devoluciones de `anular_venta` y `registrar_devolucion`), transferencias y
-- sus reversas, anulación de ingresos, gastos programados, y lo que se
-- escriba mañana. Un freno por tabla es un freno que el próximo camino se
-- saltea — mismo criterio que `movimientos_stock`.
--
-- Quedan AFUERA a propósito:
--   * TURNO_CAJA (ajuste de arqueo y cierre): son el conteo de la cajera, no
--     una salida. El cierre tiene que poder correr siempre.
--   * VENTA_PAGO: son correcciones del registro de un cobro (cambiar el medio
--     o el monto). Si el efectivo nunca entró, corregirlo es arreglar el dato,
--     no sacar plata.
--   * Cuentas sin arqueo (caja general, bancos): su saldo no lo cuenta nadie
--     a mano y hoy pueden estar en negativo hasta que se declare el saldo
--     inicial (`registrar_saldo_inicial_cuenta`).
--
-- Concurrencia: se toma row lock sobre el turno antes de sumar, así dos
-- egresos simultáneos del mismo cajón se serializan y el segundo ve al
-- primero (READ COMMITTED: cada statement del trigger toma snapshot nuevo).
-- Las ventas no toman ese lock y no hace falta: solo suman.
--
-- SECURITY DEFINER porque una vendedora sin `caja.ver_movimientos` no ve el
-- ledger por RLS y la suma le daría cero. Por eso filtra `negocio_id` a mano
-- en cada consulta.

begin;

create or replace function public.validar_saldo_caja_arqueada()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_arqueo boolean;
  v_saldo  numeric;
begin
  if new.importe >= 0
     or new.turno_caja_id is null
     or new.origen_tipo in ('TURNO_CAJA', 'VENTA_PAGO') then
    return new;
  end if;

  select c.requiere_arqueo into v_arqueo
    from public.cuentas_financieras c
   where c.negocio_id = new.negocio_id
     and c.id = new.cuenta_financiera_id;

  if not coalesce(v_arqueo, false) then
    return new;
  end if;

  perform 1
     from public.turnos_caja t
    where t.negocio_id = new.negocio_id
      and t.id = new.turno_caja_id
      for update;

  select coalesce(sum(m.importe), 0) into v_saldo
    from public.movimientos_financieros m
   where m.negocio_id = new.negocio_id
     and m.turno_caja_id = new.turno_caja_id
     and m.cuenta_financiera_id = new.cuenta_financiera_id;

  if v_saldo + new.importe < 0 then
    raise exception using
      message = 'SALDO_INSUFICIENTE_CAJA',
      detail  = json_build_object(
                  'disponible', greatest(v_saldo, 0),
                  'monto', -new.importe
                )::text,
      hint    = 'Si se pagó con otra plata, registralo contra esa cuenta.';
  end if;

  return new;
end;
$$;

comment on function public.validar_saldo_caja_arqueada() is
  'Rechaza (SALDO_INSUFICIENTE_CAJA) toda salida de una cuenta arqueada que deje el saldo del turno en negativo. Excluye TURNO_CAJA y VENTA_PAGO. Ver 20260928120000.';

revoke all on function public.validar_saldo_caja_arqueada() from public, anon, authenticated;

drop trigger if exists trg_movimientos_financieros_saldo_caja on public.movimientos_financieros;
create trigger trg_movimientos_financieros_saldo_caja
  before insert on public.movimientos_financieros
  for each row execute function public.validar_saldo_caja_arqueada();

-- ─────────────────────────────────────────────────────────────────────────
-- GUARD
--
-- Contra un turno ABIERTO real, dentro de subtransacciones que se revierten:
--   1. sacar saldo + 1 tiene que fallar con SALDO_INSUFICIENTE_CAJA;
--   2. sacar exactamente el saldo tiene que pasar (el cajón puede quedar en
--      cero, no en negativo).
-- Si no hay ningún turno abierto con saldo al aplicar, se avisa y no se
-- prueba: la regla igual queda instalada.
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_turno   record;
  v_saldo   numeric;
  v_rechazo boolean := false;
  v_paso    boolean := false;
begin
  select t.id, t.negocio_id, t.cuenta_financiera_id into v_turno
    from public.turnos_caja t
    join public.cuentas_financieras c
      on c.negocio_id = t.negocio_id and c.id = t.cuenta_financiera_id
   where t.estado = 'ABIERTO'
     and c.requiere_arqueo
     and (select coalesce(sum(m.importe), 0)
            from public.movimientos_financieros m
           where m.negocio_id = t.negocio_id
             and m.turno_caja_id = t.id
             and m.cuenta_financiera_id = t.cuenta_financiera_id) > 0
   limit 1;

  if v_turno.id is null then
    raise notice 'GUARD 20260928120000: no hay turno abierto con saldo; no se probó el rechazo';
  else
    select coalesce(sum(m.importe), 0) into v_saldo
      from public.movimientos_financieros m
     where m.negocio_id = v_turno.negocio_id
       and m.turno_caja_id = v_turno.id
       and m.cuenta_financiera_id = v_turno.cuenta_financiera_id;

    begin
      insert into public.egresos (
        negocio_id, concepto, monto, tipo, cuenta_origen_id, turno_caja_id
      ) values (
        v_turno.negocio_id, 'GUARD 20260928120000', v_saldo + 1, 'OPERATIVO',
        v_turno.cuenta_financiera_id, v_turno.id
      );
    exception when others then
      v_rechazo := (sqlerrm = 'SALDO_INSUFICIENTE_CAJA');
    end;

    if not v_rechazo then
      raise exception 'GUARD: un egreso mayor al saldo del cajón no fue rechazado';
    end if;

    begin
      insert into public.egresos (
        negocio_id, concepto, monto, tipo, cuenta_origen_id, turno_caja_id
      ) values (
        v_turno.negocio_id, 'GUARD 20260928120000', v_saldo, 'OPERATIVO',
        v_turno.cuenta_financiera_id, v_turno.id
      );
      raise exception 'GUARD_OK_ROLLBACK';
    exception when others then
      v_paso := (sqlerrm = 'GUARD_OK_ROLLBACK');
    end;

    if not v_paso then
      raise exception 'GUARD: un egreso igual al saldo del cajón fue rechazado';
    end if;
  end if;
end;
$guard$;

commit;
