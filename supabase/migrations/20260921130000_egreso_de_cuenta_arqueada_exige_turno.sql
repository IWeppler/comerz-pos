-- Un egreso de una cuenta ARQUEADA exige turno abierto. Siempre, no casi.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL AGUJERO
--
-- `registrarEgresoAction` ya frena el egreso contra una cuenta con arqueo
-- cuando no hay turno… **pero solo si el negocio exige caja abierta**:
--
--     if (cuenta.requiere_arqueo && requiereCajaAbierta && !turnoId) → error
--
-- Con `configuracion_pos.requiere_caja_abierta = false`, ese egreso entra con
-- `turno_caja_id = null`. El ledger igual le baja el saldo a CAJA_DIARIA —el
-- trigger de la bitácora no mira el turno— pero **ningún arqueo lo ve**, así
-- que rompe el invariante que fijó `20260920180000`: el saldo de la caja
-- diaria deja de ser igual al esperado de los turnos abiertos.
--
-- Hoy no pasa: los 11 negocios tienen `requiere_caja_abierta = true` y hay
-- CERO egresos sin turno. Se cierra ahora porque la pestaña Dinero va a tener
-- su propio botón de egreso, y ahí casi nunca hay un turno propio abierto: es
-- la forma más rápida de estrenar el caso.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA MISMA REGLA QUE YA TENÍA LA TRANSFERENCIA
--
-- `registrar_transferencia_financiera` (`20260919150000`) ya decía esto con
-- todas las letras: si alguna punta requiere arqueo, exige turno abierto y que
-- el turno sea de ESA cuenta (`CAJA_DIARIA_REQUIERE_TURNO_ABIERTO`). Un egreso
-- y una transferencia sacan plata del mismo cajón; que una lo controle y la
-- otra no es la clase de asimetría que después nadie puede explicar.
--
-- Va en la BASE y no solo en la action porque un server action es un endpoint,
-- y porque el egreso se inserta desde dos pantallas distintas. El chequeo de
-- la action se mantiene igual: ahí el mensaje se puede escribir para el
-- mostrador, acá solo se puede levantar una excepción.

begin;

create or replace function public.validar_turno_egreso_arqueado()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_arqueo boolean;
  v_turno  record;
begin
  select c.requiere_arqueo into v_arqueo
    from public.cuentas_financieras c
   where c.negocio_id = new.negocio_id
     and c.id = new.cuenta_origen_id;

  -- La cuenta en sí la valida `validar_cuenta_origen_egreso`; acá solo importa
  -- si es de las que se cuentan a mano.
  if not coalesce(v_arqueo, false) then
    return new;
  end if;

  if new.turno_caja_id is null then
    raise exception 'EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO';
  end if;

  select t.id, t.estado, t.cuenta_financiera_id into v_turno
    from public.turnos_caja t
   where t.negocio_id = new.negocio_id
     and t.id = new.turno_caja_id;

  if not found then
    raise exception 'EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO';
  end if;

  -- El turno tiene que ser de ESA cuenta: si no, la plata sale de un cajón y
  -- el arqueo la busca en otro. Mismo criterio que la transferencia.
  if v_turno.cuenta_financiera_id is distinct from new.cuenta_origen_id then
    raise exception 'EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO';
  end if;

  -- Un turno CERRADO ya se contó y se firmó. Cargarle un egreso después le
  -- cambia el esperado a un arqueo que alguien dio por bueno.
  if v_turno.estado <> 'ABIERTO' then
    raise exception 'EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO';
  end if;

  return new;
end;
$$;

revoke all on function public.validar_turno_egreso_arqueado() from public;

drop trigger if exists trg_egresos_validar_turno on public.egresos;
create trigger trg_egresos_validar_turno
  before insert on public.egresos
  for each row execute function public.validar_turno_egreso_arqueado();

-- ─────────────────────────────────────────────────────────────────────────
-- GUARD
--
-- No alcanza con que el trigger exista: tiene que RECHAZAR. Se prueba con un
-- insert que debe fallar, dentro de la misma transacción.
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_negocio uuid;
  v_caja uuid;
  v_rechazo boolean := false;
begin
  -- Ningun egreso existente puede violar la regla que se acaba de poner.
  if exists (
    select 1
      from public.egresos e
      join public.cuentas_financieras c
        on c.negocio_id = e.negocio_id and c.id = e.cuenta_origen_id
     where c.requiere_arqueo
       and e.turno_caja_id is null
  ) then
    raise exception 'GUARD: hay egresos historicos de caja sin turno';
  end if;

  select c.negocio_id, c.id into v_negocio, v_caja
    from public.cuentas_financieras c
   where c.codigo = 'CAJA_DIARIA' and c.requiere_arqueo
   limit 1;

  if v_negocio is not null then
    begin
      insert into public.egresos (
        negocio_id, concepto, monto, tipo, cuenta_origen_id, turno_caja_id
      ) values (
        v_negocio, 'GUARD 20260921130000', 1, 'OPERATIVO', v_caja, null
      );
    exception when others then
      v_rechazo := (sqlerrm like '%EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO%');
    end;

    if not v_rechazo then
      raise exception 'GUARD: un egreso de caja sin turno no fue rechazado';
    end if;
  end if;
end;
$guard$;

commit;
