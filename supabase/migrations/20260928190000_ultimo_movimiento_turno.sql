-- Hora del último movimiento de plata de un turno de caja.
--
-- La usa `cerrarTurnoAction` para fechar el cierre de un turno que quedó
-- abierto de noche (entities/caja/lib/turno-de-otro-dia.ts): el cierre va un
-- minuto después de su último movimiento, en el día del turno, y no en el
-- momento en que alguien se acordó de contarlo al día siguiente. Pasó dos
-- veces en El Nono Cacho (24 y 25/9/2026) y separar los días a mano llevó una
-- migración (20260928130000).
--
-- SECURITY DEFINER porque quien cierra puede ser una vendedora sin
-- `caja.ver_movimientos` (la policy de movimientos_financieros) y en modo
-- UNICA los egresos ajenos no le son visibles: con su sesión la hora saldría
-- mal. Filtra el negocio a mano (DEFINER apaga la RLS) y devuelve solo una
-- fecha. Aditiva: no la usa nada más.

create or replace function public.ultimo_movimiento_turno(p_turno_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, security, pg_temp
as $$
  select max(m.fecha_movimiento)
    from public.turnos_caja t
    join public.movimientos_financieros m
      on m.negocio_id = t.negocio_id
     and m.turno_caja_id = t.id
     and m.cuenta_financiera_id = t.cuenta_financiera_id
   where t.id = p_turno_id
     and t.negocio_id = (select security.current_negocio_id())
     and m.negocio_id = (select security.current_negocio_id())
     and m.origen_tipo <> 'TURNO_CAJA';
$$;

revoke all on function public.ultimo_movimiento_turno(uuid) from public, anon;
grant execute on function public.ultimo_movimiento_turno(uuid) to authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.ultimo_movimiento_turno(uuid)', 'execute') then
    raise exception 'GUARD: anon puede ejecutar ultimo_movimiento_turno';
  end if;
end;
$guard$;
