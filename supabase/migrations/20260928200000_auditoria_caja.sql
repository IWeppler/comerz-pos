-- Auditoría de caja: alertas sobre lo que pasa con la plata, y quién las revisó.
--
-- Nace de la auditoría de El Nono Cacho (17–28/9/2026,
-- docs/auditoria-caja-el-nono-cacho-2026-09.md). Todo lo que hubo que encontrar
-- a mano con SQL durante un día entero estaba en la base desde el primer
-- momento; nadie lo estaba mirando:
--   * turnos que quedaron abiertos de noche,
--   * sobrantes de 182.452 y 235.001 que eran gastos imputados al cajón,
--   * un fondo de apertura (254.700) que era el cierre de otro día,
--   * "cambios de efectivo por transferencia" cargados como gasto,
--   * la Caja Grande en negativo.
--
-- `alertas_caja(p_dias)` DEVUELVE HECHOS con una severidad; no corrige nada.
-- Cada alerta tiene una `clave` estable (tipo + id del registro), y
-- `alertas_caja_revisadas` guarda que alguien la miró, con nota. La revisión
-- es del NEGOCIO, no de la persona: si la dueña ya la vio, la encargada no la
-- tiene que volver a ver.
--
-- `alertas_caja_pendientes()` es el número del aviso del menú: ALTA y MEDIA
-- de los últimos 30 días sin revisar. No lanza sin permiso (devuelve 0)
-- porque la llama un polling, y un error cada minuto es ruido.
--
-- SECURITY DEFINER porque cruza tablas que la vendedora no ve (egresos
-- ajenos, ledger). Gate: `caja.ver_movimientos` o `caja.ver_gerencial`, y
-- CADA consulta filtra `negocio_id` a mano.

begin;

create table if not exists public.alertas_caja_revisadas (
  negocio_id   uuid not null default security.current_negocio_id()
               references public.negocios(id) on delete cascade,
  clave        text not null,
  revisada_por uuid default auth.uid(),
  revisada_en  timestamptz not null default now(),
  nota         text,
  primary key (negocio_id, clave)
);

comment on table public.alertas_caja_revisadas is
  'Alertas de /caja → Auditoría que alguien ya revisó. Se escribe solo por marcar_alerta_caja_revisada / desmarcar_alerta_caja_revisada.';

alter table public.alertas_caja_revisadas enable row level security;

drop policy if exists aislamiento_negocio on public.alertas_caja_revisadas;
create policy aislamiento_negocio on public.alertas_caja_revisadas
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

drop policy if exists alertas_caja_revisadas_select on public.alertas_caja_revisadas;
create policy alertas_caja_revisadas_select on public.alertas_caja_revisadas
  for select to authenticated
  using ((select public.tiene_permiso('caja.ver_movimientos'))
         or (select public.tiene_permiso('caja.ver_gerencial')));
-- Sin policy de INSERT/UPDATE/DELETE: se escribe solo por las RPC de abajo.

-- "$394.500": el `to_char` de la base usa el separador de su locale (coma).
create or replace function public.pesos_ar(p_monto numeric)
returns text
language sql
immutable
as $$
  select case when p_monto is null then null
              else (case when p_monto < 0 then '−$' else '$' end)
                   || replace(to_char(abs(round(p_monto)), 'FM999,999,999,990'), ',', '.')
         end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.alertas_caja(p_dias integer default 30)
returns table (
  clave         text,
  tipo          text,
  severidad     text,
  fecha         timestamptz,
  titulo        text,
  detalle       text,
  monto         numeric,
  turno_id      uuid,
  revisada      boolean,
  revisada_por  text,
  revisada_en   timestamptz,
  nota          text
)
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
#variable_conflict use_column
declare
  v_neg   uuid := security.current_negocio_id();
  v_tz    constant text := 'America/Argentina/Buenos_Aires';
  v_desde timestamptz;
  v_hoy   date;
  v_cg    uuid;
begin
  if v_neg is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not (public.tiene_permiso('caja.ver_movimientos') or public.tiene_permiso('caja.ver_gerencial')) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  v_desde := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 180)));
  v_hoy   := (now() at time zone v_tz)::date;
  select c.id into v_cg from public.cuentas_financieras c
   where c.negocio_id = v_neg and c.tipo = 'CAJA_GENERAL' limit 1;

  return query
  with turnos as (
    select t.*,
           lag(t.monto_declarado) over (order by t.fecha_apertura) as cierre_anterior,
           lag(t.fecha_apertura)  over (order by t.fecha_apertura) as apertura_anterior
      from public.turnos_caja t
     where t.negocio_id = v_neg
       -- Un turno abierto y cerrado sin nada (fondo 0, contado 0) no es un
       -- turno: si entrara, el siguiente parecería "plata que salió".
       and not (t.estado = 'CERRADO' and t.monto_inicial = 0 and coalesce(t.monto_declarado, 0) = 0)
  ),
  alertas as (
    -- 1. Caja abierta desde otro día.
    select 'TURNO_DE_OTRO_DIA:' || t.id as clave, 'TURNO_DE_OTRO_DIA' as tipo, 'ALTA' as severidad,
           t.fecha_apertura as fecha,
           'Caja abierta desde otro día' as titulo,
           format('Se abrió el %s y sigue abierta. No se puede vender hasta cerrarla contando el efectivo.',
                  to_char(t.fecha_apertura at time zone v_tz, 'DD/MM HH24:MI')) as detalle,
           null::numeric as monto, t.id as turno_id
      from turnos t
     where t.estado = 'ABIERTO'
       and (t.fecha_apertura at time zone v_tz)::date < v_hoy

    union all
    -- 2. Caja que se cerró al día siguiente.
    select 'CIERRE_AL_DIA_SIGUIENTE:' || t.id, 'CIERRE_AL_DIA_SIGUIENTE', 'MEDIA', t.fecha_cierre,
           'Caja que quedó abierta de noche',
           format('El turno del %s se contó al día siguiente. Revisá que ninguna venta de ese día haya quedado afuera.',
                  to_char(t.fecha_apertura at time zone v_tz, 'DD/MM HH24:MI')),
           null::numeric, t.id
      from turnos t
     where t.estado = 'CERRADO' and t.fecha_cierre >= v_desde
       and (coalesce(t.observacion_cierre, '') like '%Quedó abierto de noche%'
            or (t.fecha_cierre at time zone v_tz)::date > (t.fecha_apertura at time zone v_tz)::date)

    union all
    -- 3. Diferencia de arqueo.
    select 'DIFERENCIA_ARQUEO:' || t.id, 'DIFERENCIA_ARQUEO',
           case when abs(t.diferencia) >= 20000 then 'ALTA' else 'MEDIA' end,
           t.fecha_cierre,
           case when t.diferencia > 0 then 'Sobrante de arqueo' else 'Faltante de arqueo' end,
           format('Esperado %s, contado %s.%s',
                  public.pesos_ar(t.efectivo_esperado),
                  public.pesos_ar(t.monto_declarado),
                  case when t.diferencia > 0
                       then ' Un sobrante grande suele ser un gasto cargado en la caja chica que se pagó con otra plata.'
                       else ' Un faltante suele ser un gasto o un retiro que no se cargó.' end),
           t.diferencia::numeric, t.id
      from turnos t
     where t.estado = 'CERRADO' and t.fecha_cierre >= v_desde
       and abs(coalesce(t.diferencia, 0)) >= 5000

    union all
    -- 4. Fondo de apertura igual al cierre de otro día (el 254.700 del 25/9).
    select 'FONDO_COPIADO:' || t.id, 'FONDO_COPIADO', 'ALTA', t.fecha_apertura,
           'Fondo de apertura sospechoso',
           format('Abrió con %s, que no es lo que cerró el turno anterior (%s) pero sí es igual al cierre del %s. Puede ser un número copiado del historial.',
                  public.pesos_ar(t.monto_inicial),
                  public.pesos_ar(t.cierre_anterior),
                  (select to_char(o.fecha_cierre at time zone v_tz, 'DD/MM')
                     from turnos o
                    where o.id <> t.id and o.monto_declarado = t.monto_inicial
                      and (o.fecha_apertura at time zone v_tz)::date <> (t.fecha_apertura at time zone v_tz)::date
                    order by o.fecha_apertura desc limit 1)),
           t.monto_inicial::numeric, t.id
      from turnos t
     where t.fecha_apertura >= v_desde and t.monto_inicial > 0
       and t.cierre_anterior is not null and t.cierre_anterior <> t.monto_inicial
       and exists (select 1 from turnos o
                    where o.id <> t.id and o.monto_declarado = t.monto_inicial
                      and (o.fecha_apertura at time zone v_tz)::date <> (t.fecha_apertura at time zone v_tz)::date)

    union all
    -- 5. Plata que se movió entre dos turnos del mismo día.
    select 'MOVIDO_ENTRE_TURNOS:' || t.id, 'MOVIDO_ENTRE_TURNOS', 'BAJA', t.fecha_apertura,
           'Plata que salió del cajón entre turnos',
           format('El turno anterior cerró con %s y este abrió con %s: %s pasaron a la Caja Grande.',
                  public.pesos_ar(t.cierre_anterior),
                  public.pesos_ar(t.monto_inicial),
                  public.pesos_ar(t.cierre_anterior - t.monto_inicial)),
           (t.cierre_anterior - t.monto_inicial)::numeric, t.id
      from turnos t
     where t.fecha_apertura >= v_desde
       and t.cierre_anterior is not null and t.cierre_anterior > t.monto_inicial
       and (t.apertura_anterior at time zone v_tz)::date = (t.fecha_apertura at time zone v_tz)::date

    union all
    -- 6. Un cambio cargado como gasto.
    select 'CAMBIO_COMO_GASTO:' || e.id, 'CAMBIO_COMO_GASTO', 'ALTA', e.fecha,
           'Cambio cargado como gasto',
           format('"%s" está cargado como gasto. Un cambio de efectivo por transferencia es un pase entre cuentas: anulalo y registralo con Transferir.', e.concepto),
           e.monto::numeric, e.turno_caja_id
      from public.egresos e
     where e.negocio_id = v_neg and e.fecha >= v_desde
       and e.concepto ilike '%cambio%'

    union all
    -- 7. Gasto grande que salió de la caja chica.
    select 'GASTO_GRANDE_CAJA_CHICA:' || e.id, 'GASTO_GRANDE_CAJA_CHICA', 'MEDIA', e.fecha,
           'Gasto grande de la caja chica',
           format('"%s" salió del cajón. Si se pagó con la Caja Grande o por transferencia, el arqueo va a dar un sobrante falso.', e.concepto),
           e.monto::numeric, e.turno_caja_id
      from public.egresos e
      join public.cuentas_financieras c on c.negocio_id = e.negocio_id and c.id = e.cuenta_origen_id
     where e.negocio_id = v_neg and e.fecha >= v_desde
       and c.requiere_arqueo and e.monto >= 50000 and e.tipo <> 'DEVOLUCION'
       and e.concepto not ilike '%cambio%'

    union all
    -- 8. Salida grande de la Caja Grande (para que la dueña la vea pasar).
    select 'SALIDA_CAJA_GRANDE:' || e.id, 'SALIDA_CAJA_GRANDE', 'BAJA', e.fecha,
           'Salida grande de la Caja Grande',
           format('"%s".', e.concepto),
           e.monto::numeric, null::uuid
      from public.egresos e
     where e.negocio_id = v_neg and e.fecha >= v_desde
       and e.cuenta_origen_id = v_cg and e.monto >= 100000

    union all
    -- 9. Devolución en efectivo.
    select 'DEVOLUCION_EFECTIVO:' || e.id, 'DEVOLUCION_EFECTIVO', 'BAJA', e.fecha,
           'Devolución en efectivo',
           e.concepto,
           e.monto::numeric, e.turno_caja_id
      from public.egresos e
     where e.negocio_id = v_neg and e.fecha >= v_desde
       and e.tipo = 'DEVOLUCION' and e.monto >= 10000

    union all
    -- 10. Cobro corregido a mano (cambio de medio o de monto).
    select 'COBRO_CORREGIDO:' || m.id, 'COBRO_CORREGIDO', 'MEDIA', m.registrado_en,
           'Cobro corregido a mano',
           'Se cambió el medio de pago o el monto de un cobro después de registrado. Si pasó de efectivo a otro medio (o al revés), cambia lo que tiene que haber en el cajón.',
           m.importe, m.turno_caja_id
      from public.movimientos_financieros m
     where m.negocio_id = v_neg and m.registrado_en >= v_desde
       and m.origen_tipo = 'VENTA_PAGO' and m.evento = 'CORRECCION_APLICADA'
       and m.registrado_por is not null

    union all
    -- 11. Ajuste de conciliación de una cuenta.
    select 'AJUSTE_CUENTA:' || m.id, 'AJUSTE_CUENTA', 'ALTA', m.fecha_movimiento,
           'Ajuste de saldo de una cuenta',
           coalesce(m.descripcion, 'Ajuste manual del saldo.'),
           m.importe, null::uuid
      from public.movimientos_financieros m
     where m.negocio_id = v_neg and m.fecha_movimiento >= v_desde
       and m.origen_tipo = 'AJUSTE' and m.evento = 'REGISTRO'

    union all
    -- 12. Caja Grande en negativo (una por día: si sigue, vuelve a avisar).
    select 'CAJA_GRANDE_NEGATIVA:' || v_hoy, 'CAJA_GRANDE_NEGATIVA', 'ALTA', now(),
           'Caja Grande en negativo',
           'El sistema dice que salió más plata de la que entró. Falta cargar alguna entrada, o una salida se cargó en la cuenta equivocada.',
           s.saldo, null::uuid
      from (select coalesce(sum(m.importe), 0) as saldo
              from public.movimientos_financieros m
             where m.negocio_id = v_neg and m.cuenta_financiera_id = v_cg) s
     where v_cg is not null and s.saldo < 0
  )
  select a.clave, a.tipo, a.severidad, a.fecha, a.titulo, a.detalle, a.monto, a.turno_id,
         (r.clave is not null) as revisada,
         p.nombre as revisada_por,
         r.revisada_en,
         r.nota
    from alertas a
    left join public.alertas_caja_revisadas r on r.negocio_id = v_neg and r.clave = a.clave
    left join public.perfiles p on p.id = r.revisada_por
   order by (r.clave is not null),
            case a.severidad when 'ALTA' then 0 when 'MEDIA' then 1 else 2 end,
            a.fecha desc;
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.alertas_caja_pendientes()
returns integer
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_n integer;
begin
  if security.current_negocio_id() is null
     or not (public.tiene_permiso('caja.ver_movimientos') or public.tiene_permiso('caja.ver_gerencial')) then
    return 0;
  end if;
  select count(*) into v_n
    from public.alertas_caja(30) a
   where not a.revisada and a.severidad in ('ALTA', 'MEDIA');
  return coalesce(v_n, 0);
end;
$$;

-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.marcar_alerta_caja_revisada(p_clave text, p_nota text default null)
returns void
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_neg uuid := security.current_negocio_id();
begin
  if v_neg is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not (public.tiene_permiso('caja.ver_movimientos') or public.tiene_permiso('caja.ver_gerencial')) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_clave is null or btrim(p_clave) = '' then
    raise exception 'CLAVE_REQUERIDA';
  end if;
  insert into public.alertas_caja_revisadas (negocio_id, clave, revisada_por, revisada_en, nota)
  values (v_neg, p_clave, auth.uid(), now(), nullif(btrim(coalesce(p_nota, '')), ''))
  on conflict (negocio_id, clave) do update
    set revisada_por = excluded.revisada_por,
        revisada_en  = excluded.revisada_en,
        nota         = excluded.nota;
end;
$$;

create or replace function public.desmarcar_alerta_caja_revisada(p_clave text)
returns void
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_neg uuid := security.current_negocio_id();
begin
  if v_neg is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not (public.tiene_permiso('caja.ver_movimientos') or public.tiene_permiso('caja.ver_gerencial')) then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  delete from public.alertas_caja_revisadas
   where negocio_id = v_neg and clave = p_clave;
end;
$$;

-- Supabase da EXECUTE a anon y authenticated por default privileges: hay que
-- nombrarlos (ver CLAUDE.md, transferencias reversibles).
revoke all on function public.alertas_caja(integer) from public, anon;
revoke all on function public.alertas_caja_pendientes() from public, anon;
revoke all on function public.marcar_alerta_caja_revisada(text, text) from public, anon;
revoke all on function public.desmarcar_alerta_caja_revisada(text) from public, anon;
grant execute on function public.alertas_caja(integer) to authenticated;
grant execute on function public.alertas_caja_pendientes() to authenticated;
grant execute on function public.marcar_alerta_caja_revisada(text, text) to authenticated;
grant execute on function public.desmarcar_alerta_caja_revisada(text) to authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.alertas_caja(integer)', 'execute')
     or has_function_privilege('anon', 'public.marcar_alerta_caja_revisada(text, text)', 'execute') then
    raise exception 'GUARD: anon puede ejecutar las funciones de auditoría';
  end if;
  if exists (select 1 from pg_policies
              where tablename = 'alertas_caja_revisadas'
                and coalesce(qual, '') like '%same_negocio(%') then
    raise exception 'GUARD: policy con la forma vieja de same_negocio';
  end if;
end;
$guard$;

commit;
