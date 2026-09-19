-- Etapa 3: el origen financiero del egreso deja de ser implícito.
-- Solo los movimientos de la cuenta arqueada por el turno cambian el cajón.

begin;

create or replace function public.validar_cuenta_origen_egreso()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_tipo text;
  v_activa boolean;
begin
  select tipo, activa into v_tipo, v_activa
    from public.cuentas_financieras
   where negocio_id = new.negocio_id
     and id = new.cuenta_origen_id;

  if not found or not v_activa then
    raise exception 'CUENTA_ORIGEN_NO_DISPONIBLE';
  end if;
  if v_tipo = 'PUENTE_ACREDITACION' then
    raise exception 'CUENTA_PUENTE_NO_ADMITE_EGRESOS_MANUALES';
  end if;
  return new;
end;
$$;

revoke all on function public.validar_cuenta_origen_egreso() from public;

create trigger trg_egresos_validar_cuenta_origen
  before insert or update of cuenta_origen_id, negocio_id
  on public.egresos
  for each row execute function public.validar_cuenta_origen_egreso();

-- Compatibilidad para consumidores viejos: conserva el nombre, pero ahora
-- devuelve exclusivamente egresos que salieron de la cuenta física del turno.
create or replace function public.calcular_egresos_turno(p_turno_id uuid)
returns numeric
language sql
stable security definer
set search_path = public, security, pg_temp
as $$
  select coalesce(sum(e.monto), 0)
    from public.turnos_caja t
    left join public.egresos e
      on e.turno_caja_id = t.id
     and e.negocio_id = t.negocio_id
     and e.cuenta_origen_id = t.cuenta_financiera_id
   where t.id = p_turno_id
     and t.negocio_id = security.current_negocio_id();
$$;

revoke all on function public.calcular_egresos_turno(uuid) from public, anon;
grant execute on function public.calcular_egresos_turno(uuid) to authenticated;

-- Fuente única para el esperado actual. Conserva la semántica vigente de
-- pagos/egresos y agrega únicamente transferencias del ledger; no usa el
-- ledger entero porque esa bitácora modela anulaciones financieras, mientras
-- la devolución física ya tiene su propio egreso.
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
    coalesce((select sum(vp.monto_bruto)
      from public.venta_pagos vp
      where vp.negocio_id = t.negocio_id
        and vp.turno_caja_id = t.id
        and vp.metodo_tipo = 'EFECTIVO'
        and vp.estado_pago_operacion <> 'ANULADO'), 0)
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
    + coalesce((select sum(vp.monto_bruto) from public.venta_pagos vp
        where vp.negocio_id = t.negocio_id and vp.turno_caja_id = t.id
          and vp.metodo_tipo = 'EFECTIVO'
          and vp.estado_pago_operacion <> 'ANULADO'), 0)
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

comment on column public.egresos.cuenta_origen_id is
  'Cuenta real desde la que salió el dinero. La finalidad económica continúa en tipo; solo si coincide con la cuenta del turno afecta su arqueo.';

do $$
declare v_error bigint;
begin
  select count(*) into v_error
    from public.egresos e
    join public.cuentas_financieras c
      on c.negocio_id = e.negocio_id and c.id = e.cuenta_origen_id
   where c.tipo = 'PUENTE_ACREDITACION';
  if v_error <> 0 then
    raise exception 'Hay % egresos históricos en cuenta puente.', v_error;
  end if;
end;
$$;

commit;
