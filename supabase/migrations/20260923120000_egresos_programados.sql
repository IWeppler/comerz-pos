-- ═══════════════════════════════════════════════════════════════════════════
-- EGRESOS PROGRAMADOS: LA PLATA QUE YA ESTÁ COMPROMETIDA
--
-- El alquiler, los sueldos, la suscripción del sistema. Hasta ahora Comerz no
-- sabía nada de esto: la pestaña Dinero contestaba "cuánto tengo" y no "cuánto
-- de esto ya tiene dueño", que es la pregunta que decide si se compra
-- mercadería el día 20.
--
-- ───────────────────────────────────────────────────────────────────────────
-- ES UNA AGENDA, NO UN PAGO. AL LLEGAR LA FECHA NO PASA NADA SOLO.
--
-- Un egreso saca plata de una cuenta y, si esa cuenta se arquea, de un cajón
-- que alguien cuenta a mano. Si el alquiler se registrara solo el día 25, la
-- caja cerraría esa noche con un faltante de un millón que nadie sacó — y la
-- cajera tendría que firmar una diferencia por una decisión del sistema.
--
-- Esto NO contradice la acreditación automática de `20260921120000`, que sí
-- se materializa sola. La diferencia es de naturaleza: la fecha de
-- acreditación es un dato pactado con el procesador y acreditar no es la
-- acción de nadie, es algo que le PASA a la plata. Pagar el alquiler es algo
-- que alguien HACE, y el sistema no puede hacerlo en su nombre.
--
-- Entonces: el programado recuerda, y una persona confirma. Confirmar inserta
-- un egreso de verdad —mismo camino, mismos triggers, mismo arqueo— y recién
-- ahí corre la fecha. Las dos cosas en la misma transacción: si el gasto se
-- registra y la agenda no avanza, el alquiler sigue figurando impago y se
-- paga dos veces.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Y NO ENTRA EN "DISPONIBLE AHORA". Va en "Próximos movimientos", al lado de
-- lo por acreditar, por el mismo motivo por el que eso tampoco entra: mezclar
-- plata que está con plata que va a estar (o a irse) es el error que hace
-- gastar lo que no se tiene.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.egresos_programados (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id) on delete cascade,

  concepto text not null check (btrim(concepto) <> ''),
  -- El ÚLTIMO monto conocido, no una verdad eterna: el alquiler sube. Al
  -- confirmar se puede ajustar y eso actualiza la plantilla, que es lo que
  -- evita que la agenda se vuelva mentira y se abandone.
  monto numeric(14,2) not null check (monto > 0),

  -- Espejo del CHECK de `egresos`, MENOS 'DEVOLUCION': ese tipo lo escriben
  -- `anular_venta` y `registrar_devolucion` cuando se le devuelve plata a un
  -- cliente. No hay forma de programar una devolución, y permitirlo dejaría
  -- que un reintegro se registre sin la venta que lo origina.
  tipo text not null default 'OPERATIVO'
    check (tipo in ('OPERATIVO', 'RETIRO_SOCIO', 'COMPRA_MERCADERIA')),

  -- Igual que en `egresos`: solo un gasto OPERATIVO lleva categoría, porque
  -- en el resto el tipo ya dice todo.
  categoria_id uuid references public.categorias_egreso(id) on delete set null,
  constraint egresos_programados_categoria_solo_operativo
    check (categoria_id is null or tipo = 'OPERATIVO'),

  -- Opcional, mismo criterio que `egresos.cuenta_origen_id` desde
  -- `20260921170000`: vacía, la decide la base al confirmar (con turno
  -- abierto sale del cajón, sin turno de la caja general).
  cuenta_origen_id uuid references public.cuentas_financieras(id) on delete set null,

  frecuencia text not null
    check (frecuencia in ('UNICO', 'SEMANAL', 'QUINCENAL', 'MENSUAL',
                          'BIMESTRAL', 'TRIMESTRAL', 'ANUAL')),

  -- Cuándo vence la PRÓXIMA. Es una sola fecha y no una lista de ocurrencias
  -- materializadas: con una fila por mes habría que decidir hasta cuándo
  -- generar, y un comercio que no confirma tres meses acumularía tres deudas
  -- fantasma. Así, lo que no se confirmó queda vencido UNA vez, que es la
  -- verdad: el alquiler de marzo que no se pagó no son tres alquileres.
  proxima_fecha date not null,

  -- El día del mes que el comercio eligió, para que una frecuencia mensual no
  -- se vaya corriendo sola. Sumar un mes a un 31 de enero da 28 de febrero, y
  -- a partir de ahí el vencimiento queda clavado el 28 para siempre. Con el
  -- ancla se vuelve al 31 en los meses que lo tienen.
  dia_ancla smallint check (dia_ancla between 1 and 31),

  activo boolean not null default true,

  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.egresos_programados is
  'Agenda de gastos que se repiten (alquiler, sueldos, suscripciones). NO registra el gasto al llegar la fecha: recuerda, y una persona confirma. Confirmar inserta en `egresos` por el camino de siempre y corre la fecha, en una transacción.';

create index if not exists idx_egresos_programados_negocio_fecha
  on public.egresos_programados (negocio_id, proxima_fecha)
  where activo;

create index if not exists idx_egresos_programados_categoria
  on public.egresos_programados (categoria_id)
  where categoria_id is not null;

create trigger egresos_programados_updated_at
  before update on public.egresos_programados
  for each row execute function public.marcar_updated_at();

-- ───────────────────────────────────────────────────────────────────────────
-- RLS
--
-- Ver la agenda: cualquiera del negocio que ya puede ver movimientos. Cargar
-- y editar: ADMIN — define lo que la dueña ve como comprometido, y una cifra
-- inflada ahí le dice que no compre mercadería que sí podía comprar.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.egresos_programados enable row level security;

create policy aislamiento_negocio on public.egresos_programados
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy egresos_programados_select on public.egresos_programados
  for select to authenticated using (true);

create policy egresos_programados_insert_admin on public.egresos_programados
  for insert to authenticated with check ((select public.is_admin()));

create policy egresos_programados_update_admin on public.egresos_programados
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy egresos_programados_delete_admin on public.egresos_programados
  for delete to authenticated using ((select public.is_admin()));

-- ───────────────────────────────────────────────────────────────────────────
-- CUÁNDO VENCE LA PRÓXIMA
--
-- Con `dia_ancla`, una mensual del 31 vuelve al 31 en los meses que lo
-- tienen, en vez de quedarse clavada en el 28 después de pasar por febrero.
-- IMMUTABLE porque solo depende de sus argumentos: así se puede usar en un
-- índice o en un CHECK si algún día hace falta.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.siguiente_fecha_programada(
  p_fecha date,
  p_frecuencia text,
  p_dia_ancla smallint default null
)
returns date
language plpgsql
immutable
as $function$
declare
  v_base date;
  v_meses integer;
  v_ultimo_dia integer;
begin
  if p_fecha is null then return null; end if;

  -- UNICO no se repite: quien lo confirma lo da de baja, no lo corre.
  if p_frecuencia = 'UNICO' then return null; end if;
  if p_frecuencia = 'SEMANAL' then return p_fecha + 7; end if;
  if p_frecuencia = 'QUINCENAL' then return p_fecha + 14; end if;

  v_meses := case p_frecuencia
    when 'MENSUAL' then 1
    when 'BIMESTRAL' then 2
    when 'TRIMESTRAL' then 3
    when 'ANUAL' then 12
    else null end;

  -- Fail-closed: una frecuencia que esta función no conoce no se inventa.
  if v_meses is null then
    raise exception 'FRECUENCIA_DESCONOCIDA: %', p_frecuencia;
  end if;

  v_base := (date_trunc('month', p_fecha) + make_interval(months => v_meses))::date;
  v_ultimo_dia := extract(day from (date_trunc('month', v_base)
                    + interval '1 month - 1 day'))::integer;

  -- Sin ancla se conserva el día de la fecha actual, recortado al último día
  -- del mes destino. Con ancla manda el ancla, que es lo que el comercio
  -- eligió.
  return v_base + (least(coalesce(p_dia_ancla, extract(day from p_fecha)::smallint),
                         v_ultimo_dia) - 1);
end;
$function$;

comment on function public.siguiente_fecha_programada is
  'Próximo vencimiento de un egreso programado. Con dia_ancla, una mensual del 31 vuelve al 31 en los meses que lo tienen en vez de quedar clavada en el 28 después de febrero. Devuelve null para UNICO, que no se repite.';

-- ───────────────────────────────────────────────────────────────────────────
-- CONFIRMAR: SE REGISTRA EL GASTO Y SE CORRE LA FECHA, JUNTOS
--
-- SECURITY INVOKER a propósito. El insert en `egresos` pasa por la policy
-- `egresos_insert_propio` —que pide `caja.registrar_egreso`— y por los
-- triggers que ya existen: el que asigna la cuenta cuando no viene, el que
-- exige turno abierto si la cuenta se arquea, y el que escribe la bitácora.
-- Una DEFINER acá sería una puerta de atrás a todo eso.
--
-- El turno llega por parámetro y no se resuelve adentro: esa regla ya vive en
-- `resolverTurnoActivo` y en el trigger de `20260921130000`. Reimplementarla
-- acá sería una segunda versión que se desincroniza.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.confirmar_egreso_programado(
  p_id uuid,
  p_monto numeric default null,
  p_fecha_pago date default null,
  p_cuenta_origen_id uuid default null,
  p_turno_caja_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_prog public.egresos_programados;
  v_monto numeric;
  v_cuenta uuid;
  v_egreso uuid;
  v_siguiente date;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;

  -- El row lock serializa dos confirmaciones simultáneas: sin él, dos
  -- pestañas abiertas registran el alquiler dos veces y las dos corren la
  -- fecha una sola.
  select * into v_prog
    from public.egresos_programados
   where id = p_id and negocio_id = v_negocio
   for update;

  if not found then raise exception 'PROGRAMADO_NO_ENCONTRADO'; end if;
  if not v_prog.activo then raise exception 'PROGRAMADO_DADO_DE_BAJA'; end if;

  v_monto := coalesce(p_monto, v_prog.monto);
  if v_monto <= 0 then raise exception 'MONTO_INVALIDO'; end if;

  v_cuenta := coalesce(p_cuenta_origen_id, v_prog.cuenta_origen_id);

  -- El insert va por el camino de siempre. Todo lo que hace que un egreso
  -- cuadre —cuenta por defecto, turno obligatorio si se arquea, ledger,
  -- impacto en el resultado según el tipo— lo siguen haciendo los triggers.
  insert into public.egresos (
    concepto, monto, tipo, categoria_id, cuenta_origen_id,
    turno_caja_id, creado_por, fecha
  ) values (
    v_prog.concepto, v_monto, v_prog.tipo, v_prog.categoria_id, v_cuenta,
    p_turno_caja_id, auth.uid(), coalesce(p_fecha_pago, current_date)
  )
  returning id into v_egreso;

  -- Y recién ahora corre la agenda. Un UNICO se da de baja: ya cumplió.
  v_siguiente := public.siguiente_fecha_programada(
    greatest(v_prog.proxima_fecha, coalesce(p_fecha_pago, current_date)),
    v_prog.frecuencia,
    v_prog.dia_ancla
  );

  update public.egresos_programados
     set proxima_fecha = coalesce(v_siguiente, proxima_fecha),
         activo = (v_siguiente is not null),
         -- El monto confirmado pasa a ser el esperado: si el alquiler subió,
         -- la agenda tiene que decir el número nuevo o el mes que viene vuelve
         -- a mostrar el viejo y nadie le cree.
         monto = v_monto
   where id = p_id and negocio_id = v_negocio;

  return v_egreso;
end;
$function$;

comment on function public.confirmar_egreso_programado is
  'Registra el gasto de un egreso programado y corre su fecha, en una transacción. SECURITY INVOKER: el insert pasa por la policy de `egresos` y por sus triggers, así que quien no puede registrar un gasto tampoco puede confirmar uno programado.';

-- ───────────────────────────────────────────────────────────────────────────
-- OMITIR: correr la fecha SIN registrar nada
--
-- El mes que no se pagó, o que se pagó por fuera de Comerz. Sin esto, un
-- vencimiento que no corresponde registrar se queda vencido para siempre y la
-- dueña aprende a ignorar el aviso — que es cómo muere una agenda.
--
-- NO crea ningún movimiento, a propósito: omitir no es pagar.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.omitir_egreso_programado(p_id uuid)
returns date
language plpgsql
security invoker
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_prog public.egresos_programados;
  v_siguiente date;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;

  select * into v_prog
    from public.egresos_programados
   where id = p_id and negocio_id = v_negocio
   for update;

  if not found then raise exception 'PROGRAMADO_NO_ENCONTRADO'; end if;
  if not v_prog.activo then raise exception 'PROGRAMADO_DADO_DE_BAJA'; end if;

  v_siguiente := public.siguiente_fecha_programada(
    greatest(v_prog.proxima_fecha, current_date),
    v_prog.frecuencia,
    v_prog.dia_ancla
  );

  update public.egresos_programados
     set proxima_fecha = coalesce(v_siguiente, proxima_fecha),
         activo = (v_siguiente is not null)
   where id = p_id and negocio_id = v_negocio;

  return v_siguiente;
end;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- GUARDS
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  -- Una devolución no se programa: la generan `anular_venta` y
  -- `registrar_devolucion` a partir de una venta.
  if exists (select 1 from pg_constraint
              where conrelid = 'public.egresos_programados'::regclass
                and contype = 'c'
                and pg_get_constraintdef(oid) ilike '%DEVOLUCION%') then
    raise exception 'GUARD: el tipo DEVOLUCION no puede programarse';
  end if;

  -- Confirmar tiene que seguir siendo INVOKER: si pasa a DEFINER, cualquiera
  -- que llegue a la pantalla puede sacar plata sin `caja.registrar_egreso`.
  if (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'confirmar_egreso_programado') then
    raise exception 'GUARD: confirmar_egreso_programado dejó de ser SECURITY INVOKER';
  end if;
end $$;

-- El ancla, mes por mes. Es la trampa clásica de una agenda mensual y por eso
-- se verifica con fechas reales en vez de confiar en la aritmética.
do $$
begin
  -- 31/01 -> 28/02 (2026 no es bisiesto) -> y de vuelta al 31 en marzo.
  if public.siguiente_fecha_programada('2026-01-31'::date, 'MENSUAL', 31::smallint) <> '2026-02-28'::date then
    raise exception 'GUARD: enero 31 no recorta a fin de febrero';
  end if;
  if public.siguiente_fecha_programada('2026-02-28'::date, 'MENSUAL', 31::smallint) <> '2026-03-31'::date then
    raise exception 'GUARD: el ancla no devuelve el vencimiento al 31';
  end if;
  -- Sin ancla, el día se conserva.
  if public.siguiente_fecha_programada('2026-03-05'::date, 'MENSUAL', null::smallint) <> '2026-04-05'::date then
    raise exception 'GUARD: sin ancla no conserva el día';
  end if;
  if public.siguiente_fecha_programada('2026-03-05'::date, 'SEMANAL', null::smallint) <> '2026-03-12'::date then
    raise exception 'GUARD: semanal no suma 7 días';
  end if;
  if public.siguiente_fecha_programada('2026-03-05'::date, 'ANUAL', 5::smallint) <> '2027-03-05'::date then
    raise exception 'GUARD: anual no suma 12 meses';
  end if;
  if public.siguiente_fecha_programada('2026-03-05'::date, 'UNICO', null::smallint) is not null then
    raise exception 'GUARD: UNICO no puede tener próxima fecha';
  end if;
end $$;
