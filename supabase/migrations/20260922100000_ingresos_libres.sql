-- Ingresos libres: plata que ENTRA sin que venga de una venta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LO QUE FALTABA
--
-- El ledger sabía representar toda la plata que sale (egresos, con cuatro
-- tipos) y una sola forma de plata que entra: el cobro de una venta o de una
-- deuda. Lo demás no tenía puerta. La dueña que pone $500.000 de su bolsillo
-- para comprar mercadería, el hermano que presta, el alquiler del local de
-- al lado que se cobra en el mostrador, el proveedor que devuelve una seña:
-- nada de eso se podía anotar, y lo que no se anota termina como faltante
-- de arqueo o como saldo negativo en una caja (la "Caja Grande" de El Nono
-- Cacho en −$750.000 era exactamente eso: sueldos pagados con plata que
-- nunca entró al sistema). `registrar_saldo_inicial_cuenta` cubre UNA vez
-- por cuenta y a propósito no sirve de ingreso recurrente.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA FORMA: ESPEJO DE LOS EGRESOS, CON SUS TRES REGLAS
--
-- * Tabla propia (`ingresos_financieros`) + fila en el ledger, como
--   egresos, transferencias y acreditaciones. La tabla es el origen
--   auditable (quién, cuándo, qué tipo, si se anuló); el ledger es lo que
--   suma.
-- * TIPO con impacto declarado, espejo de `egresos.tipo`:
--     APORTE_SOCIO           → impacto_resultado 0 (es la contracara de
--                              RETIRO_SOCIO: plata del dueño, no ganancia)
--     PRESTAMO               → 0 (hay que devolverla)
--     INGRESO_EXTRAORDINARIO → +monto (alquiler cobrado, seña devuelta por
--                              un proveedor, venta de un mueble: entró y es
--                              del negocio)
--   `ingreso_impacto_resultado(tipo, monto)` es el espejo de
--   `egreso_impacto_resultado`. CHECK fail-closed: un tipo desconocido no
--   entra.
-- * Cuenta OPCIONAL con la misma regla que el egreso (`20260921170000`):
--   con turno abierto entra al cajón (CAJA_DIARIA), sin turno a la caja
--   general. Y si la cuenta es arqueada, el turno tiene que estar ABIERTO y
--   ser de esa cuenta: un ingreso a un cajón que ya se contó y se firmó no
--   existe (misma regla que `20260921130000` para egresos).
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL ARQUEO LO TIENE QUE VER, Y SON CINCO LUGARES
--
-- El invariante de `20260920180000` dice: saldo de CAJA_DIARIA = suma del
-- esperado de los turnos abiertos. Un ingreso al cajón sube el saldo del
-- ledger, así que el ESPERADO tiene que subir igual o el invariante se
-- rompe y la cajera cierra con un "sobrante" que no es tal.
--
-- El esperado ya suma las transferencias al cajón leyendo el ledger
-- (`origen_tipo = 'TRANSFERENCIA'` con `turno_caja_id`). Un ingreso libre es
-- exactamente la misma forma —plata que entra al cajón y no es venta— así
-- que la fila del ledger lleva `turno_caja_id` y las CINCO consultas que
-- suman ese término pasan a `in ('TRANSFERENCIA','INGRESO')`:
-- `flujo_caja_turno` (el cierre), `efectivo_actual_turnos` (el historial),
-- `posicion_dinero` (Dinero), `resumen_gerencial_caja` (Hoy) y
-- `transferencias_caja_turno` (la lista de "Mi turno"). Son el MISMO número
-- desde cinco pantallas; cambiar cuatro es peor que el bug.
--
-- Las cuatro primeras se parchean SOBRE EL CUERPO VIVO con `replace()` +
-- `execute` (criterio de `20260921180000`): se verifica que la expresión
-- aparece exactamente una vez, se reemplaza, se ejecuta. Si un cuerpo no
-- tiene la forma esperada la migración aborta en vez de adivinar. La quinta
-- se reescribe porque cambia su tipo de retorno (ahora dice qué origen es
-- cada fila, para que "Mi turno" no llame "transferencia" a un ingreso).
--
-- El invariante se vuelve a verificar al final, con el término nuevo.
--
-- ─────────────────────────────────────────────────────────────────────────
-- ANULAR: REVERSA, NO BORRADO
--
-- `anular_egreso` BORRA la fila porque `egresos` la suman siete consumidores
-- sin columna de estado. Acá los consumidores de la tabla son cero —lo que
-- suma es el ledger— así que la fila se queda, marcada (`anulado_en`,
-- `anulado_por`, `motivo_anulacion`), y el ledger recibe una fila
-- `ANULACION` de −monto con el mismo `turno_caja_id`, fechada en el INGRESO
-- (mismo criterio que las correcciones de egreso: si no, anular en octubre
-- un ingreso de septiembre deja septiembre mal). Mismos frenos: permiso
-- `caja.anular_movimiento`, motivo obligatorio, turno ABIERTO si la cuenta
-- es arqueada.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PERMISO: `caja.registrar_ingreso`, SOLO ADMIN
--
-- Es la segunda forma (después del saldo inicial) de hacer aparecer plata
-- sin que venga de una venta, y una vendedora con ese botón puede "cuadrar"
-- un faltante anotando un ingreso. Mismo criterio que `caja.anular_movimiento`
-- y `ventas.elegir_medio_devolucion`. El dueño lo delega desde la pantalla
-- de roles, que lee el catálogo entero.
--
-- LO QUE NO HACE: el panel (`get-dashboard-metrics`) calcula la ganancia
-- desde ventas y egresos y no lee el ledger, así que un
-- INGRESO_EXTRAORDINARIO no le suma todavía. Queda declarado en el ledger
-- (`impacto_resultado`) y en el resumen del período; sumarlo al panel es
-- una decisión de producto aparte.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. PERMISO
-- ─────────────────────────────────────────────────────────────────────────

insert into public.permisos (clave, modulo, descripcion)
values ('caja.registrar_ingreso', 'caja',
        'Registrar ingresos de dinero que no vienen de una venta (aportes, préstamos, otros)')
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select r.id, p.id, r.negocio_id
  from public.roles r
  cross join public.permisos p
 where r.nombre = 'ADMIN'
   and r.negocio_id is not null
   and p.clave = 'caja.registrar_ingreso'
on conflict (rol_id, permiso_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. TIPO E IMPACTO
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.ingreso_impacto_resultado(p_tipo text, p_monto numeric)
returns numeric
language sql
immutable
as $$
  select case when p_tipo = 'INGRESO_EXTRAORDINARIO' then p_monto else 0 end;
$$;

comment on function public.ingreso_impacto_resultado(text, numeric) is
  'Espejo SQL de features/caja/lib/tipo-ingreso.ts: solo INGRESO_EXTRAORDINARIO es resultado; APORTE_SOCIO y PRESTAMO solo mueven plata.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. LA TABLA
-- ─────────────────────────────────────────────────────────────────────────

create table public.ingresos_financieros (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id) on delete restrict,
  cuenta_destino_id uuid not null,
  -- Solo cuando la cuenta es arqueada: el turno abierto al que entró.
  turno_caja_id uuid references public.turnos_caja(id) on delete restrict,
  tipo text not null
    check (tipo in ('APORTE_SOCIO', 'PRESTAMO', 'INGRESO_EXTRAORDINARIO')),
  monto numeric not null check (monto > 0),
  concepto text not null check (length(btrim(concepto)) > 0),
  fecha timestamptz not null default now(),
  registrado_por uuid,
  anulado_en timestamptz,
  anulado_por uuid,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  constraint ingresos_financieros_cuenta_fkey
    foreign key (negocio_id, cuenta_destino_id)
    references public.cuentas_financieras(negocio_id, id) on delete restrict,
  -- Anulado es un estado completo o nada: las tres columnas van juntas.
  constraint ingresos_financieros_anulacion_completa
    check ((anulado_en is null) = (anulado_por is null)
       and (anulado_en is null) = (motivo_anulacion is null))
);

create index ingresos_financieros_fecha_idx
  on public.ingresos_financieros(negocio_id, fecha desc);
create index ingresos_financieros_turno_idx
  on public.ingresos_financieros(negocio_id, turno_caja_id)
  where turno_caja_id is not null;

alter table public.ingresos_financieros enable row level security;

create policy aislamiento_negocio on public.ingresos_financieros
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

-- Leer: quien ve el ledger, o quien lo registró. Escribir: NADIE directo —
-- sin policy de INSERT/UPDATE/DELETE la base lo deniega, y las dos RPCs de
-- abajo (DEFINER) son el único camino.
create policy ingresos_financieros_select
  on public.ingresos_financieros for select to authenticated
  using (
    registrado_por = auth.uid()
    or (select public.tiene_permiso('caja.ver_movimientos'))
  );

comment on table public.ingresos_financieros is
  'Plata que entra sin venir de una venta (aporte, préstamo, ingreso extraordinario). Lo que suma es su fila en movimientos_financieros (origen INGRESO). Se anula con reversa, nunca se borra. Ver 20260922100000.';

alter table public.movimientos_financieros
  drop constraint movimientos_financieros_origen_tipo_check,
  add constraint movimientos_financieros_origen_tipo_check
    check (origen_tipo in (
      'VENTA_PAGO','EGRESO','TRANSFERENCIA','ACREDITACION','TURNO_CAJA',
      'AJUSTE','INGRESO'
    ));

-- ─────────────────────────────────────────────────────────────────────────
-- 4. REGISTRAR
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_ingreso_financiero(
  p_monto numeric,
  p_tipo text,
  p_concepto text,
  p_cuenta_id uuid default null,
  p_turno_caja_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_cuenta_id uuid := p_cuenta_id;
  v_cuenta public.cuentas_financieras;
  v_turno public.turnos_caja;
  v_turno_id uuid;
  v_ingreso uuid;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.registrar_ingreso') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;
  if nullif(btrim(p_concepto), '') is null then
    raise exception 'CONCEPTO_REQUERIDO';
  end if;
  if p_tipo not in ('APORTE_SOCIO', 'PRESTAMO', 'INGRESO_EXTRAORDINARIO') then
    raise exception 'TIPO_INVALIDO';
  end if;

  -- El turno, si viene, tiene que ser de este negocio y estar ABIERTO. Se
  -- valida antes de resolver la cuenta porque la cuenta por defecto sale de
  -- él. DEFINER: cada consulta filtra negocio_id a mano.
  if p_turno_caja_id is not null then
    select * into v_turno
      from public.turnos_caja
     where id = p_turno_caja_id and negocio_id = v_negocio
       for update;
    if v_turno.id is null or v_turno.estado <> 'ABIERTO' then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
  end if;

  -- Sin cuenta: con turno abierto al cajón, sin turno a la caja general.
  -- Misma regla que `asignar_cuenta_financiera_actual` para los egresos.
  if v_cuenta_id is null then
    v_cuenta_id := coalesce(
      v_turno.cuenta_financiera_id,
      public.cuenta_financiera_sistema(v_negocio, 'CAJA_GENERAL')
    );
  end if;

  select * into v_cuenta
    from public.cuentas_financieras
   where id = v_cuenta_id and negocio_id = v_negocio and activa
     for update;
  if v_cuenta.id is null then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;
  if v_cuenta.tipo = 'PUENTE_ACREDITACION' then
    raise exception 'CUENTA_PUENTE_RESERVADA';
  end if;

  -- Cuenta arqueada: turno ABIERTO y de ESA cuenta, o no hay ingreso. Un
  -- ingreso a un cajón sin turno no lo vería ningún arqueo.
  if v_cuenta.requiere_arqueo then
    if v_turno.id is null or v_turno.cuenta_financiera_id <> v_cuenta.id then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
    v_turno_id := v_turno.id;
  end if;

  insert into public.ingresos_financieros (
    negocio_id, cuenta_destino_id, turno_caja_id, tipo, monto, concepto,
    registrado_por
  ) values (
    v_negocio, v_cuenta.id, v_turno_id, p_tipo, p_monto, btrim(p_concepto),
    auth.uid()
  ) returning id into v_ingreso;

  insert into public.movimientos_financieros (
    negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values (
    v_negocio, v_cuenta.id, 'INGRESO', v_ingreso, 'REGISTRO',
    p_monto, public.ingreso_impacto_resultado(p_tipo, p_monto), v_turno_id,
    btrim(p_concepto),
    jsonb_build_object('tipo', p_tipo, 'cuenta_destino_id', v_cuenta.id),
    now(), auth.uid()
  );

  return v_ingreso;
end;
$$;

revoke all on function public.registrar_ingreso_financiero(numeric, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.registrar_ingreso_financiero(numeric, text, text, uuid, uuid)
  to authenticated;

comment on function public.registrar_ingreso_financiero(numeric, text, text, uuid, uuid) is
  'Ingreso que no viene de una venta. Cuenta opcional (con turno → cajón, sin turno → caja general); cuenta arqueada exige turno ABIERTO de esa cuenta. impacto_resultado según tipo. Permiso caja.registrar_ingreso.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. ANULAR
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.anular_ingreso_financiero(
  p_ingreso_id uuid,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_ingreso public.ingresos_financieros;
  v_cuenta public.cuentas_financieras;
  v_turno public.turnos_caja;
  v_filas int;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.anular_movimiento') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO';
  end if;

  select * into v_ingreso
    from public.ingresos_financieros
   where id = p_ingreso_id and negocio_id = v_negocio
     for update;
  if v_ingreso.id is null then
    raise exception 'INGRESO_NO_ENCONTRADO';
  end if;
  if v_ingreso.anulado_en is not null then
    raise exception 'INGRESO_YA_ANULADO';
  end if;

  select * into v_cuenta
    from public.cuentas_financieras
   where id = v_ingreso.cuenta_destino_id and negocio_id = v_negocio;

  if coalesce(v_cuenta.requiere_arqueo, false) then
    if v_ingreso.turno_caja_id is null then
      raise exception 'INGRESO_DE_CAJA_SIN_TURNO';
    end if;
    select * into v_turno
      from public.turnos_caja
     where id = v_ingreso.turno_caja_id and negocio_id = v_negocio
       for update;
    if v_turno.id is null or v_turno.estado <> 'ABIERTO' then
      raise exception 'TURNO_CERRADO'
        using hint = 'El turno de ese ingreso ya se cerró y se firmó. Registrá un egreso de corrección en el turno abierto.';
    end if;
  end if;

  update public.ingresos_financieros
     set anulado_en = now(), anulado_por = auth.uid(),
         motivo_anulacion = btrim(p_motivo)
   where id = v_ingreso.id and negocio_id = v_negocio;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'INGRESO_NO_ANULADO';
  end if;

  -- Reversa fechada en el ingreso (ver el encabezado); `registrado_en`
  -- conserva cuándo se anuló.
  insert into public.movimientos_financieros (
    negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values (
    v_negocio, v_ingreso.cuenta_destino_id, 'INGRESO', v_ingreso.id, 'ANULACION',
    -v_ingreso.monto,
    -public.ingreso_impacto_resultado(v_ingreso.tipo, v_ingreso.monto),
    v_ingreso.turno_caja_id,
    format('Ingreso anulado: %s', btrim(p_motivo)),
    jsonb_build_object('tipo', v_ingreso.tipo, 'motivo', btrim(p_motivo),
                       'concepto', v_ingreso.concepto, 'anulado_en', now()),
    v_ingreso.fecha, auth.uid()
  );

  return jsonb_build_object(
    'ingreso_id', v_ingreso.id,
    'monto', v_ingreso.monto,
    'tipo', v_ingreso.tipo,
    'cuenta_destino_id', v_ingreso.cuenta_destino_id,
    'turno_caja_id', v_ingreso.turno_caja_id
  );
end;
$$;

revoke all on function public.anular_ingreso_financiero(uuid, text) from public, anon;
grant execute on function public.anular_ingreso_financiero(uuid, text) to authenticated;

comment on function public.anular_ingreso_financiero(uuid, text) is
  'Marca el ingreso anulado y escribe la reversa en el ledger (ANULACION, fechada en el ingreso). Turno ABIERTO si la cuenta es arqueada. Permiso caja.anular_movimiento.';

-- ─────────────────────────────────────────────────────────────────────────
-- 6. EL ARQUEO CUENTA LOS INGRESOS AL CAJÓN (cuatro cuerpos vivos)
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
  v_def text;
  v_viejo constant text := 'origen_tipo = ''TRANSFERENCIA''';
  v_nuevo constant text := 'origen_tipo in (''TRANSFERENCIA'', ''INGRESO'')';
  v_veces int;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('flujo_caja_turno', 'efectivo_actual_turnos',
                         'posicion_dinero', 'resumen_gerencial_caja')
  loop
    v_def := pg_get_functiondef(r.oid);

    -- Ya parcheada (re-ejecución): nada que hacer.
    if v_def like '%' || v_nuevo || '%' then
      continue;
    end if;

    v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_veces <> 1 then
      raise exception 'GUARD: % tiene % veces el término de transferencias (se esperaba 1); revisar a mano',
        r.proname, v_veces;
    end if;

    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end $$;

-- La quinta cambia de forma: dice qué origen es cada fila.
drop function if exists public.transferencias_caja_turno(uuid);

create function public.transferencias_caja_turno(p_turno_id uuid)
returns table (
  movimiento_id bigint,
  origen_tipo text,
  origen_id uuid,
  importe numeric,
  descripcion text,
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
  select m.id, m.origen_tipo, m.origen_id, m.importe, m.descripcion,
         m.fecha_movimiento
    from public.turnos_caja t
    join public.movimientos_financieros m
      on m.negocio_id = t.negocio_id
     and m.turno_caja_id = t.id
     and m.cuenta_financiera_id = t.cuenta_financiera_id
     and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO')
   where t.negocio_id = v_negocio
     and t.id = p_turno_id
     and (t.modo = 'UNICA' or t.vendedor_id = auth.uid()
          or public.tiene_permiso('caja.cerrar_ajena'))
   order by m.fecha_movimiento desc, m.id desc;
end;
$$;

revoke all on function public.transferencias_caja_turno(uuid) from public, anon;
grant execute on function public.transferencias_caja_turno(uuid) to authenticated;

comment on function public.transferencias_caja_turno(uuid) is
  'Movimientos del cajón del turno que no son venta ni egreso: transferencias e ingresos libres (origen_tipo lo dice). Es el mismo término que suma el arqueo.';

-- ─────────────────────────────────────────────────────────────────────────
-- 7. EL RESUMEN DEL PERÍODO LOS MUESTRA
--
-- `otros_ingresos`: total, cantidad y por tipo, sin los anulados (el
-- REGISTRO y su ANULACION se netean por `origen_id`). Entran al `neto_caja`
-- —es flujo: plata que entró— y se muestran aparte para que nadie los
-- confunda con cobros. Reescrita desde `20260921235000`, que es la única
-- versión que existió; verificado contra el cuerpo vivo antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.resumen_financiero_periodo(
  p_desde date default null,
  p_hasta date default null,
  p_periodo text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid := security.current_negocio_id();
  v_hoy date := (now() at time zone v_tz)::date;
  v_desde date;
  v_hasta date;
  v_ini timestamptz;
  v_fin timestamptz;
  v_out jsonb;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
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

  -- Rango en timestamptz para que los índices por fecha se usen (un cast por
  -- fila a date los deja afuera).
  v_ini := (v_desde::timestamp) at time zone v_tz;
  v_fin := ((v_hasta + 1)::timestamp) at time zone v_tz;

  with cobros as (
    select vp.metodo_tipo, vp.tipo_movimiento, vp.monto_bruto
      from public.venta_pagos vp
     where vp.negocio_id = v_negocio
       and vp.creado_en >= v_ini and vp.creado_en < v_fin
       and coalesce(vp.estado_pago_operacion, 'CONFIRMADO') <> 'ANULADO'
  ),
  reintegros as (
    select r.metodo_tipo, r.monto
      from public.reintegros_al_cliente r
     where r.negocio_id = v_negocio
       and r.fecha >= v_ini and r.fecha < v_fin
  ),
  egresos_p as (
    select e.tipo, e.monto, e.categoria_id, ce.nombre as categoria_nombre
      from public.egresos e
      left join public.categorias_egreso ce
        on ce.id = e.categoria_id and ce.negocio_id = v_negocio
     where e.negocio_id = v_negocio
       and e.fecha >= v_ini and e.fecha < v_fin
  ),
  -- Ingresos libres vivos: un anulado tiene su fila marcada y no cuenta.
  otros_ingresos as (
    select i.tipo, i.monto
      from public.ingresos_financieros i
     where i.negocio_id = v_negocio
       and i.anulado_en is null
       and i.fecha >= v_ini and i.fecha < v_fin
  ),
  transf as (
    select count(*) as cantidad, coalesce(sum(t.monto), 0) as monto
      from public.transferencias_financieras t
     where t.negocio_id = v_negocio
       and t.fecha >= v_ini and t.fecha < v_fin
  ),
  arqueo as (
    select coalesce(sum(case when m.importe < 0 then -m.importe else 0 end), 0) as faltantes,
           coalesce(sum(case when m.importe > 0 then  m.importe else 0 end), 0) as sobrantes,
           count(*) filter (where m.importe <> 0) as turnos_con_diferencia
      from public.movimientos_financieros m
     where m.negocio_id = v_negocio
       and m.origen_tipo = 'TURNO_CAJA' and m.evento = 'AJUSTE_ARQUEO'
       and m.fecha_movimiento >= v_ini and m.fecha_movimiento < v_fin
  ),
  tot as (
    select
      (select coalesce(sum(monto_bruto), 0) from cobros) as cobrado,
      (select coalesce(sum(monto_bruto), 0) from cobros where tipo_movimiento = 'PAGO_VENTA') as cobrado_ventas,
      (select coalesce(sum(monto_bruto), 0) from cobros where tipo_movimiento <> 'PAGO_VENTA') as cobros_de_deuda,
      (select count(*) from cobros) as cantidad_cobros,
      (select coalesce(sum(monto), 0) from reintegros) as reintegros,
      (select count(*) from reintegros) as cantidad_reintegros,
      (select coalesce(sum(monto), 0) from egresos_p) as egresos_total,
      (select coalesce(sum(monto), 0) from egresos_p where tipo <> 'DEVOLUCION') as egresos_sin_devolucion,
      (select coalesce(sum(monto), 0) from egresos_p where tipo = 'OPERATIVO') as gasto_operativo,
      (select coalesce(sum(monto), 0) from egresos_p where tipo = 'OPERATIVO' and categoria_id is null) as gasto_sin_categoria,
      (select count(*) from egresos_p where tipo = 'OPERATIVO' and categoria_id is null) as cantidad_sin_categoria,
      (select coalesce(sum(monto), 0) from otros_ingresos) as otros_ingresos_total,
      (select count(*) from otros_ingresos) as cantidad_otros_ingresos
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta, 'periodo', p_periodo, 'generado_en', now(),
    'ingresos', jsonb_build_object(
      'cobrado', t.cobrado,
      'cobrado_ventas', t.cobrado_ventas,
      'cobros_de_deuda', t.cobros_de_deuda,
      'cantidad', t.cantidad_cobros,
      'por_medio', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'metodo_tipo', c.metodo_tipo, 'monto', c.monto, 'cantidad', c.cantidad
               ) order by c.monto desc)
          from (select metodo_tipo, sum(monto_bruto) monto, count(*) cantidad
                  from cobros group by metodo_tipo) c
      ), '[]'::jsonb)
    ),
    'otros_ingresos', jsonb_build_object(
      'total', t.otros_ingresos_total,
      'cantidad', t.cantidad_otros_ingresos,
      'por_tipo', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'tipo', o.tipo, 'monto', o.monto, 'cantidad', o.cantidad
               ) order by o.monto desc)
          from (select tipo, sum(monto) monto, count(*) cantidad
                  from otros_ingresos group by tipo) o
      ), '[]'::jsonb)
    ),
    'reintegros', jsonb_build_object(
      'total', t.reintegros,
      'cantidad', t.cantidad_reintegros,
      'por_medio', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'metodo_tipo', r.metodo_tipo, 'monto', r.monto, 'cantidad', r.cantidad
               ) order by r.monto desc)
          from (select metodo_tipo, sum(monto) monto, count(*) cantidad
                  from reintegros group by metodo_tipo) r
      ), '[]'::jsonb)
    ),
    'egresos', jsonb_build_object(
      'total', t.egresos_total,
      'sin_devolucion', t.egresos_sin_devolucion,
      'gasto_operativo', t.gasto_operativo,
      'por_tipo', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'tipo', x.tipo, 'monto', x.monto, 'cantidad', x.cantidad
               ) order by x.monto desc)
          from (select tipo, sum(monto) monto, count(*) cantidad
                  from egresos_p group by tipo) x
      ), '[]'::jsonb),
      'gastos_por_categoria', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'categoria_id', g.categoria_id,
                 'categoria_nombre', coalesce(g.categoria_nombre, 'Sin categoría'),
                 'monto', g.monto, 'cantidad', g.cantidad
               ) order by g.monto desc)
          from (select categoria_id, categoria_nombre, sum(monto) monto, count(*) cantidad
                  from egresos_p where tipo = 'OPERATIVO'
                 group by categoria_id, categoria_nombre) g
      ), '[]'::jsonb),
      'sin_categoria', jsonb_build_object(
        'monto', t.gasto_sin_categoria, 'cantidad', t.cantidad_sin_categoria
      )
    ),
    'transferencias', (select jsonb_build_object('cantidad', cantidad, 'monto', monto) from transf),
    'arqueo', (select jsonb_build_object(
                 'faltantes', faltantes, 'sobrantes', sobrantes,
                 'turnos_con_diferencia', turnos_con_diferencia) from arqueo),
    -- Flujo, no ganancia. Ver el encabezado de 20260921235000.
    'neto_caja', t.cobrado + t.otros_ingresos_total - t.reintegros - t.egresos_sin_devolucion
  )
  into v_out
  from tot t;

  return v_out;
end;
$$;

comment on function public.resumen_financiero_periodo(date, date, text) is
  'Flujo del período para la pestaña Dinero: cobros no anulados (por medio; ventas y cobros de deuda aparte), otros ingresos (libres, por tipo), reintegros, egresos por tipo y gastos operativos por categoría, transferencias, faltantes/sobrantes de arqueo y neto_caja. neto_caja NO es ganancia (no tiene costo de mercadería). Gate caja.ver_gerencial.';

-- ─────────────────────────────────────────────────────────────────────────
-- 8. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_def text;
  r record;
begin
  -- Las cinco consultas del cajón suman los ingresos.
  for r in
    select unnest(array['flujo_caja_turno','efectivo_actual_turnos','posicion_dinero',
                        'resumen_gerencial_caja','transferencias_caja_turno']) as f
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.f;
    if v_def is null or v_def not like '%''INGRESO''%' then
      raise exception 'GUARD: % no suma los ingresos libres al cajón', r.f;
    end if;
  end loop;

  v_def := pg_get_functiondef('public.registrar_ingreso_financiero(numeric,text,text,uuid,uuid)'::regprocedure);
  if v_def not like '%caja.registrar_ingreso%' then
    raise exception 'GUARD: registrar_ingreso_financiero no pide caja.registrar_ingreso';
  end if;
  if v_def not like '%CAJA_DIARIA_REQUIERE_TURNO_ABIERTO%' then
    raise exception 'GUARD: un ingreso a una cuenta arqueada dejó de exigir turno abierto';
  end if;
  -- DEFINER: turno, cuenta, insert (dos) filtran negocio.
  if (select count(*) from regexp_matches(v_def, 'negocio_id = v_negocio', 'g')) < 2 then
    raise exception 'GUARD: registrar_ingreso_financiero no filtra negocio_id en sus consultas';
  end if;

  v_def := pg_get_functiondef('public.anular_ingreso_financiero(uuid,text)'::regprocedure);
  if v_def not like '%caja.anular_movimiento%' then
    raise exception 'GUARD: anular_ingreso_financiero no pide caja.anular_movimiento';
  end if;
  if v_def not like '%TURNO_CERRADO%' then
    raise exception 'GUARD: anular_ingreso_financiero dejó de frenar sobre turno cerrado';
  end if;
  if (select count(*) from regexp_matches(v_def, 'negocio_id = v_negocio', 'g')) < 4 then
    raise exception 'GUARD: anular_ingreso_financiero no filtra negocio_id en sus cuatro consultas';
  end if;

  v_def := pg_get_functiondef('public.resumen_financiero_periodo(date,date,text)'::regprocedure);
  if v_def not like '%caja.ver_gerencial%' then
    raise exception 'GUARD: resumen_financiero_periodo no pide caja.ver_gerencial';
  end if;
  if v_def not like '%<> ''ANULADO''%' then
    raise exception 'GUARD: los ingresos dejaron de excluir los cobros anulados';
  end if;
  if v_def not like '%egresos_sin_devolucion%' or v_def not like '%reintegros_al_cliente%' then
    raise exception 'GUARD: el neto volvió a contar el reintegro en efectivo dos veces';
  end if;
  if v_def not like '%anulado_en is null%' then
    raise exception 'GUARD: el resumen cuenta ingresos anulados';
  end if;
  if (select count(*) from regexp_matches(v_def, 'negocio_id = v_negocio', 'g')) < 7 then
    raise exception 'GUARD: faltan filtros de negocio en resumen_financiero_periodo (DEFINER)';
  end if;

  -- La tabla no se escribe directo: sin policy de INSERT/UPDATE/DELETE.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ingresos_financieros'
       and policyname <> 'aislamiento_negocio'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'GUARD: ingresos_financieros tiene una policy de escritura directa';
  end if;
end;
$guard$;

-- El invariante de 20260920180000, con el término nuevo: hoy no hay ningún
-- ingreso, así que tiene que dar exactamente lo mismo que antes.
do $guard$
declare
  r record;
begin
  for r in
    select n.nombre,
           coalesce((select sum(m.importe) from public.movimientos_financieros m
                      where m.cuenta_financiera_id = c.id), 0) saldo_ledger,
           coalesce((select sum(
               t.monto_inicial
               + coalesce((select sum(vp.monto_bruto) from public.venta_pagos vp
                            where vp.negocio_id = t.negocio_id
                              and vp.turno_caja_id = t.id
                              and vp.metodo_tipo = 'EFECTIVO'), 0)
               - coalesce((select sum(e.monto) from public.egresos e
                            where e.negocio_id = t.negocio_id
                              and e.turno_caja_id = t.id
                              and e.cuenta_origen_id = t.cuenta_financiera_id), 0)
               + coalesce((select sum(mf.importe) from public.movimientos_financieros mf
                            where mf.negocio_id = t.negocio_id
                              and mf.turno_caja_id = t.id
                              and mf.cuenta_financiera_id = t.cuenta_financiera_id
                              and mf.origen_tipo in ('TRANSFERENCIA', 'INGRESO')), 0)
             ) from public.turnos_caja t
              where t.negocio_id = c.negocio_id
                and t.cuenta_financiera_id = c.id
                and t.estado <> 'CERRADO'), 0) esperado_abiertos
      from public.cuentas_financieras c
      join public.negocios n on n.id = c.negocio_id
     where c.codigo = 'CAJA_DIARIA'
  loop
    if abs(r.saldo_ledger - r.esperado_abiertos) > 0.01 then
      raise exception
        'GUARD: la caja diaria de % no cierra contra los turnos abiertos (ledger %, esperado %)',
        r.nombre, r.saldo_ledger, r.esperado_abiertos;
    end if;
  end loop;
end;
$guard$;

commit;
