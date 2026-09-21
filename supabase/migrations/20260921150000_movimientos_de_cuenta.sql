-- El detalle de una cuenta: qué entró, qué salió y por qué.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ FALTABA
--
-- La pestaña Dinero muestra el saldo de cada cuenta y no hay forma de abrirlo.
-- Lo único que se ve son las últimas transferencias, y en un bloque aparte:
-- los cobros que alimentan una billetera y —sobre todo— los EGRESOS que salen
-- de una caja general no aparecen en ninguna parte de esa pantalla. Con la
-- "Caja Grande" de El Nono Cacho en −$750.000, la dueña no tenía cómo ver que
-- esos $750.000 son siete sueldos.
--
-- Los datos estaban desde `20260919130000` y el índice también
-- (`movimientos_financieros_cuenta_fecha_idx`, justo
-- `(negocio_id, cuenta_financiera_id, fecha_movimiento desc, id desc)`).
-- Faltaba la puerta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ UNA RPC Y NO UN SELECT DIRECTO
--
-- La RLS ya deja leer `movimientos_financieros` con `caja.ver_gerencial`, así
-- que un `.from(...)` desde la app funcionaría. Lo que no se puede resolver
-- desde ahí es el nombre de quien lo registró: `registrado_por` no tiene FK a
-- `perfiles`, así que PostgREST no puede embeberlo y harían falta dos viajes.
-- Con la base en Ohio, un round-trip de más se paga en cada apertura.
--
-- SECURITY DEFINER, así que el filtro por `negocio_id` va A MANO en las dos
-- consultas: la de la cuenta y la de los movimientos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL TOPE ES PARTE DEL CONTRATO
--
-- `TRANSFERENCIA MERCADO PAGO` de Evens tiene 544 movimientos y la cuenta
-- puente 1.148. Esto es un detalle para entender un saldo, no un libro mayor:
-- devuelve los últimos y nada más. El tope se recorta en la BASE (200) además
-- de tomarlo por parámetro, porque el parámetro viaja desde el navegador.

begin;

create or replace function public.movimientos_de_cuenta(
  p_cuenta_id uuid,
  p_limite integer default 50
)
returns table (
  id bigint,
  fecha timestamptz,
  evento text,
  origen_tipo text,
  importe numeric,
  descripcion text,
  autor text,
  en_turno boolean
)
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  -- SECURITY DEFINER: sin este filtro, el id de una cuenta de otro comercio
  -- devolvería sus movimientos.
  if not exists (
    select 1 from public.cuentas_financieras c
     where c.id = p_cuenta_id and c.negocio_id = v_negocio
  ) then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;

  return query
  select m.id, m.fecha_movimiento, m.evento, m.origen_tipo, m.importe,
         m.descripcion, p.nombre, m.turno_caja_id is not null
    from public.movimientos_financieros m
    left join public.perfiles p on p.id = m.registrado_por
   where m.negocio_id = v_negocio
     and m.cuenta_financiera_id = p_cuenta_id
   order by m.fecha_movimiento desc, m.id desc
   limit greatest(1, least(coalesce(p_limite, 50), 200));
end;
$$;

revoke all on function public.movimientos_de_cuenta(uuid, integer) from public, anon;
grant execute on function public.movimientos_de_cuenta(uuid, integer) to authenticated;

comment on function public.movimientos_de_cuenta(uuid, integer) is
  'Ultimos movimientos de una cuenta, con el nombre de quien los registro. Tope de 200 recortado en la base: el parametro viene del navegador.';

commit;
