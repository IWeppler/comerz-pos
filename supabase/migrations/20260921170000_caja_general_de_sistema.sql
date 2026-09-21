-- Caja chica y caja grande: CAJA_GENERAL pasa a ser de sistema, el cierre le
-- entrega la plata, la apertura se la pide, y un egreso sin turno sale de ahí.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL PROBLEMA
--
-- Desde `20260920180000` el cierre del turno emite `CIERRE_TURNO` por
-- −declarado sobre CAJA_DIARIA, y la apertura `APERTURA_TURNO` por
-- +monto_inicial. Los dos son asientos de UNA sola pata: la plata que la
-- cajera cuenta y entrega al cerrar desaparece del ledger, y el fondo con el
-- que abre a la mañana aparece de la nada. El modelo sabía cuánto había en el
-- cajón y nada más — dónde está la plata del negocio entre un cierre y la
-- apertura siguiente no tenía respuesta, y la "Caja Grande" que El Nono Cacho
-- se creó a mano para cargar los sueldos vive en −$750.000 porque nada la
-- alimenta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA DECISIÓN (21/9/2026)
--
-- Dos cajas, y la división es por quién la cuenta, no por para qué sirve:
--
--   CAJA_DIARIA   la caja chica. Arqueada por turno, la maneja quien vende.
--   CAJA_GENERAL  la caja grande. El efectivo consolidado del negocio, sin
--                 arqueo, la maneja el dueño. Es de SISTEMA: nace con el
--                 negocio, igual que CAJA_DIARIA y POR_ACREDITAR.
--
-- Y el ciclo del efectivo cierra solo, sin que nadie elija nada:
--
--   Abrir turno   CAJA_GENERAL −fondo   →  CAJA_DIARIA +fondo
--   Cerrar turno  CAJA_DIARIA −declarado →  CAJA_GENERAL +declarado
--
-- Las dos patas hacen falta, no solo la del cierre. Si solo el cierre
-- alimentara la general, el fondo del día siguiente saldría de la nada y la
-- general contaría dos veces lo que volvió al cajón: cerrar con $100.000 y
-- abrir con $20.000 de fondo dejaría $120.000 en el ledger contra $100.000
-- reales.
--
-- No se pide cuenta destino al cerrar. Se descartó a propósito: es la
-- decisión que se guarda cuando nadie mira, y si la plata del cierre va
-- después al banco eso es una TRANSFERENCIA desde la general, con su fila y
-- su concepto. Consolidar y depositar son dos actos.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LO QUE NO SE HACE: BACKFILL DE LOS CIERRES VIEJOS
--
-- Sería fácil sumarle a cada general los ~300 cierres históricos, y sería
-- mentira: esa plata ya se gastó, se depositó y se retiró por caminos que el
-- sistema nunca vio. Evens quedaría con millones en una caja que la dueña no
-- tiene. El saldo de la general al día de hoy NO está en la base, así que se
-- declara con `registrar_saldo_inicial_cuenta` (`20260921140000`), que existe
-- para exactamente esto y no está prohibido para una cuenta con movimientos.
-- Los cierres firmados quedan como estaban: son historia.
--
-- La única excepción son los turnos ABIERTOS en este momento. Su apertura ya
-- puso el fondo en el cajón sin sacarlo de ningún lado, y su cierre —que va a
-- correr con esta versión— va a devolver a la general ese fondo que nunca
-- salió de ella. Para que el ciclo cierre desde el primer turno, a cada turno
-- abierto se le escribe hoy la pata que le falta: −monto_inicial en la general,
-- con la fecha de apertura. Medido en seco antes de aplicar: cuatro turnos
-- (Librería Colores −40.300, El Nono Cacho −29.000, Kiosco Demo −1.000, Ninja
-- Camisetas −1); el de Evens está abierto con fondo cero y no necesita pata.
--
-- Verificado también en seco, abriendo y cerrando un turno de prueba dentro
-- de una transacción revertida: apertura y cierre salen con dos patas de la
-- misma `operacion_id` que suman cero, el egreso con turno cae en la diaria,
-- el egreso sin turno en la general, y el saldo de la diaria no se mueve.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL EGRESO SIN CUENTA
--
-- El trigger `asignar_cuenta_financiera_actual` mandaba todo egreso sin cuenta
-- a CAJA_DIARIA. Con `20260921130000` eso es una contradicción para el egreso
-- sin turno: la caja diaria exige turno abierto, así que "sin cuenta y sin
-- turno" era un error garantizado. La regla nueva es la que la división de
-- cajas ya dice sola:
--
--   con turno   → CAJA_DIARIA  (sale del cajón que se está arqueando)
--   sin turno   → CAJA_GENERAL (no hay cajón; sale del fondo)
--
-- Es lo que permite emitir un egreso desde la pestaña Dinero sin elegir
-- cuenta, y también arregla un caso que hoy falla: anular en efectivo una
-- venta sin turno abierto (`anular_venta` y `registrar_devolucion` insertan
-- el egreso de la devolución con `turno_caja_id = p_turno_id`, que puede ser
-- null). Antes iba al cajón y el trigger lo rechazaba; ahora sale de la
-- general, que es de donde sale la plata cuando el cajón está cerrado.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LAS GENERALES QUE YA EXISTEN SE ADOPTAN, NO SE DUPLICAN
--
-- El Nono Cacho ("Caja Grande") y Kiosco Demo ("Caja General") ya tienen una
-- cuenta de tipo CAJA_GENERAL creada a mano, con código autogenerado y
-- `es_sistema = false`. Crearles otra dejaría dos cajas grandes y la de los
-- sueldos huérfana. Se les cambia el código y la marca; el NOMBRE se respeta,
-- porque lo puso el comercio.
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
begin
  -- Si un negocio tuviera más de una, elegir cuál es la del sistema es una
  -- decisión del comercio, no de una migración. Hoy no pasa (verificado).
  for r in
    select negocio_id, count(*) n
      from public.cuentas_financieras
     where tipo = 'CAJA_GENERAL' and activa
     group by negocio_id having count(*) > 1
  loop
    raise exception 'GUARD: el negocio % tiene % cuentas CAJA_GENERAL activas; resolver a mano',
      r.negocio_id, r.n;
  end loop;
end $$;

update public.cuentas_financieras c
   set codigo = 'CAJA_GENERAL', es_sistema = true
 where c.tipo = 'CAJA_GENERAL'
   and c.activa
   and c.codigo <> 'CAJA_GENERAL'
   and not exists (
     select 1 from public.cuentas_financieras o
      where o.negocio_id = c.negocio_id and o.codigo = 'CAJA_GENERAL'
   );

-- ─────────────────────────────────────────────────────────────────────────
-- 2. NACE CON EL NEGOCIO
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.sembrar_cuentas_financieras_sistema(
  p_negocio_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  if p_negocio_id is null
     or not exists (select 1 from public.negocios where id = p_negocio_id) then
    raise exception 'NEGOCIO_INEXISTENTE';
  end if;

  insert into public.cuentas_financieras (
    negocio_id, codigo, nombre, tipo, es_efectivo, requiere_arqueo, es_sistema
  ) values
    (p_negocio_id, 'CAJA_DIARIA',   'Caja diaria',          'CAJA_DIARIA',          true,  true,  true),
    (p_negocio_id, 'CAJA_GENERAL',  'Caja general',         'CAJA_GENERAL',         true,  false, true),
    (p_negocio_id, 'POR_ACREDITAR', 'Dinero por acreditar', 'PUENTE_ACREDITACION',  false, false, true)
  on conflict (negocio_id, codigo) do nothing;
end;
$$;

revoke all on function public.sembrar_cuentas_financieras_sistema(uuid) from public;

select public.sembrar_cuentas_financieras_sistema(id) from public.negocios;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. EL EGRESO SIN CUENTA: CON TURNO AL CAJÓN, SIN TURNO AL FONDO
--
-- Solo cambia la rama `egresos`. El resto es el cuerpo vivo tal cual
-- (`pg_get_functiondef`, 21/9/2026).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.asignar_cuenta_financiera_actual()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  if tg_table_name = 'turnos_caja' then
    if new.cuenta_financiera_id is null then
      new.cuenta_financiera_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;

  elsif tg_table_name = 'egresos' then
    if new.cuenta_origen_id is null then
      -- Sin turno no hay cajón que arquear: la plata sale del fondo. Con
      -- turno, del cajón, como siempre. Ver el encabezado.
      new.cuenta_origen_id := public.cuenta_financiera_sistema(
        new.negocio_id,
        case when new.turno_caja_id is null then 'CAJA_GENERAL' else 'CAJA_DIARIA' end
      );
    end if;

  elsif tg_table_name = 'metodos_pago' then
    -- Cambiar el tipo invalida la cuenta anterior, PERO solo si quien edita no
    -- mando una nueva en el mismo UPDATE.
    if tg_op = 'UPDATE'
       and old.tipo is distinct from new.tipo
       and new.cuenta_destino_id is not distinct from old.cuenta_destino_id then
      new.cuenta_destino_id := null;
    end if;

    if new.cuenta_destino_id is null and new.negocio_id is not null then
      if new.tipo = 'EFECTIVO' then
        new.cuenta_destino_id := public.cuenta_financiera_sistema(
          new.negocio_id, 'CAJA_DIARIA'
        );
      else
        -- La otra mitad de la regla. Sin esto el cobro cae en el puente y no
        -- sale. La cuenta se llama COMO EL METODO: el nombre lo puso el
        -- comercio, no lo inventa el sistema.
        insert into public.cuentas_financieras (
          negocio_id, codigo, nombre, tipo,
          es_efectivo, requiere_arqueo, es_sistema, activa
        ) values (
          new.negocio_id,
          upper(left(regexp_replace(coalesce(new.nombre, 'CUENTA'),
                                    '[^a-zA-Z0-9]+', '_', 'g'), 24))
            || '_' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
          new.nombre,
          case new.tipo when 'BILLETERA_VIRTUAL' then 'BILLETERA' else 'BANCO' end,
          false, false, false, true
        )
        returning id into new.cuenta_destino_id;
      end if;
    end if;

  elsif tg_table_name = 'venta_pagos' then
    -- Una correccion de medio debe recalcular el snapshot. Si conservara la
    -- cuenta anterior, corregir Efectivo a Debito seguiria moviendo Caja.
    if tg_op = 'UPDATE'
       and row(old.metodo_pago_id, old.metodo_tipo)
           is distinct from row(new.metodo_pago_id, new.metodo_tipo) then
      new.cuenta_destino_id := null;
    end if;

    if new.cuenta_destino_id is null and new.metodo_pago_id is not null then
      select m.cuenta_destino_id
        into new.cuenta_destino_id
        from public.metodos_pago m
       where m.id = new.metodo_pago_id
         and m.negocio_id = new.negocio_id;
    end if;

    if new.cuenta_destino_id is null and new.metodo_tipo = 'EFECTIVO' then
      new.cuenta_destino_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. APERTURA Y CIERRE CON LAS DOS PATAS
--
-- Cuerpo vivo de `20260920180000` más la pata de la general en cada uno. Las
-- dos patas comparten `operacion_id` y suman cero. La pata de la general va
-- SIN `turno_caja_id` a propósito: todas las consultas de arqueo filtran
-- por turno Y por cuenta, así que no cambiaría nada, pero "movimientos del
-- turno" significa "lo que pasó en el cajón", y esto pasó afuera. El vínculo
-- con el turno ya está en `origen_id`.
--
-- Si un negocio no tuviera CAJA_GENERAL (no puede pasar después del paso 2,
-- y un guard abajo lo verifica) la pata se omite en vez de reventar el cierre
-- de una caja en producción por un detalle del ledger.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.registrar_bitacora_turno_caja()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_saldo numeric;
  v_declarado numeric;
  v_retiro numeric;
  v_general uuid;
  v_operacion uuid;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.monto_inicial, 0) <> 0 and new.cuenta_financiera_id is not null then
      v_operacion := gen_random_uuid();
      v_general := public.cuenta_financiera_sistema(new.negocio_id, 'CAJA_GENERAL');

      insert into public.movimientos_financieros (
        operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion,
        fecha_movimiento, registrado_por
      ) values (
        v_operacion, new.negocio_id, new.cuenta_financiera_id, 'TURNO_CAJA', new.id,
        'APERTURA_TURNO', new.monto_inicial, 0, new.id,
        'Fondo inicial del turno', new.fecha_apertura, new.vendedor_id
      );

      if v_general is not null and v_general <> new.cuenta_financiera_id then
        insert into public.movimientos_financieros (
          operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
          importe, impacto_resultado, turno_caja_id, descripcion, datos,
          fecha_movimiento, registrado_por
        ) values (
          v_operacion, new.negocio_id, v_general, 'TURNO_CAJA', new.id,
          'APERTURA_TURNO', -new.monto_inicial, 0, null,
          'Fondo entregado a la caja diaria',
          jsonb_build_object('turno_caja_id', new.id,
                             'cuenta_contraparte_id', new.cuenta_financiera_id),
          new.fecha_apertura, new.vendedor_id
        );
      end if;
    end if;
    return new;
  end if;

  if old.estado = 'CERRADO' or new.estado <> 'CERRADO'
     or new.cuenta_financiera_id is null then
    return new;
  end if;

  -- El saldo sale del LEDGER, no de efectivo_esperado: esa columna es una foto
  -- congelada, y estuvo mal en 17 turnos hasta 20260920160000.
  select coalesce(sum(m.importe), 0) into v_saldo
    from public.movimientos_financieros m
   where m.negocio_id = new.negocio_id
     and m.turno_caja_id = new.id
     and m.cuenta_financiera_id = new.cuenta_financiera_id;

  v_declarado := new.monto_declarado;

  if v_declarado is not null and v_declarado - v_saldo <> 0 then
    insert into public.movimientos_financieros (
      negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      new.negocio_id, new.cuenta_financiera_id, 'TURNO_CAJA', new.id,
      'AJUSTE_ARQUEO', v_declarado - v_saldo, v_declarado - v_saldo, new.id,
      case when v_declarado > v_saldo then 'Sobrante de arqueo'
           else 'Faltante de arqueo' end,
      jsonb_build_object('esperado_ledger', v_saldo, 'declarado', v_declarado),
      coalesce(new.fecha_cierre, now()), new.cerrada_por
    );
  end if;

  -- Sin declarado no se sabe cuanto se conto: se retira el saldo y no se
  -- inventa ningun ajuste.
  v_retiro := coalesce(v_declarado, v_saldo);

  if v_retiro <> 0 then
    v_operacion := gen_random_uuid();
    v_general := public.cuenta_financiera_sistema(new.negocio_id, 'CAJA_GENERAL');

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, new.cuenta_financiera_id, 'TURNO_CAJA', new.id,
      'CIERRE_TURNO', -v_retiro, 0, new.id,
      'Retiro del efectivo al cerrar el turno',
      jsonb_build_object('declarado', v_declarado, 'esperado_ledger', v_saldo),
      coalesce(new.fecha_cierre, now()), new.cerrada_por
    );

    if v_general is not null and v_general <> new.cuenta_financiera_id then
      insert into public.movimientos_financieros (
        operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
        importe, impacto_resultado, turno_caja_id, descripcion, datos,
        fecha_movimiento, registrado_por
      ) values (
        v_operacion, new.negocio_id, v_general, 'TURNO_CAJA', new.id,
        'CIERRE_TURNO', v_retiro, 0, null,
        'Efectivo recibido del cierre de la caja diaria',
        jsonb_build_object('turno_caja_id', new.id,
                           'cuenta_contraparte_id', new.cuenta_financiera_id,
                           'declarado', v_declarado, 'esperado_ledger', v_saldo),
        coalesce(new.fecha_cierre, now()), new.cerrada_por
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.registrar_bitacora_turno_caja() from public;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. LOS TURNOS ABIERTOS HOY RECIBEN LA PATA QUE LES FALTA
-- ─────────────────────────────────────────────────────────────────────────

insert into public.movimientos_financieros (
  operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
  importe, impacto_resultado, turno_caja_id, descripcion, datos,
  fecha_movimiento, registrado_por
)
select
  coalesce(a.operacion_id, gen_random_uuid()),
  t.negocio_id,
  public.cuenta_financiera_sistema(t.negocio_id, 'CAJA_GENERAL'),
  'TURNO_CAJA', t.id, 'APERTURA_TURNO',
  -t.monto_inicial, 0, null,
  'Fondo entregado a la caja diaria',
  jsonb_build_object('turno_caja_id', t.id,
                     'cuenta_contraparte_id', t.cuenta_financiera_id,
                     'backfill', '20260921170000'),
  t.fecha_apertura, t.vendedor_id
  from public.turnos_caja t
  left join lateral (
    select m.operacion_id
      from public.movimientos_financieros m
     where m.origen_tipo = 'TURNO_CAJA' and m.origen_id = t.id
       and m.evento = 'APERTURA_TURNO'
       and m.cuenta_financiera_id = t.cuenta_financiera_id
     limit 1
  ) a on true
 where t.estado <> 'CERRADO'
   and coalesce(t.monto_inicial, 0) <> 0
   and t.cuenta_financiera_id is not null
   and public.cuenta_financiera_sistema(t.negocio_id, 'CAJA_GENERAL') is not null
   and not exists (
     select 1 from public.movimientos_financieros m
      where m.origen_tipo = 'TURNO_CAJA' and m.origen_id = t.id
        and m.evento = 'APERTURA_TURNO'
        and m.cuenta_financiera_id = public.cuenta_financiera_sistema(t.negocio_id, 'CAJA_GENERAL')
   );

-- ─────────────────────────────────────────────────────────────────────────
-- 6. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  r record;
  v_faltan int;
begin
  -- Toda cuenta de negocio tiene exactamente UNA CAJA_GENERAL de sistema.
  select count(*) into v_faltan
    from public.negocios n
   where (select count(*) from public.cuentas_financieras c
           where c.negocio_id = n.id and c.codigo = 'CAJA_GENERAL'
             and c.es_sistema and c.activa) <> 1;
  if v_faltan > 0 then
    raise exception 'GUARD: % negocios sin exactamente una CAJA_GENERAL de sistema', v_faltan;
  end if;

  -- Y ninguna general adoptada quedó duplicada.
  if exists (
    select 1 from public.cuentas_financieras
     where tipo = 'CAJA_GENERAL' and activa
     group by negocio_id having count(*) > 1
  ) then
    raise exception 'GUARD: quedó un negocio con dos CAJA_GENERAL activas';
  end if;

  -- El invariante de la caja diaria (20260920180000) sigue intacto: nada de
  -- lo de arriba tocó movimientos de CAJA_DIARIA.
  for r in
    select n.nombre,
           coalesce((select sum(m.importe) from public.movimientos_financieros m
                      where m.cuenta_financiera_id = c.id), 0) saldo_ledger,
           coalesce((select sum(
                       t.monto_inicial
                       + coalesce((select sum(vp.monto_bruto) from public.venta_pagos vp
                                    where vp.turno_caja_id = t.id and vp.metodo_tipo = 'EFECTIVO'), 0)
                       - coalesce((select sum(e.monto) from public.egresos e
                                    where e.turno_caja_id = t.id
                                      and e.cuenta_origen_id = t.cuenta_financiera_id), 0)
                       + coalesce((select sum(x.importe) from public.movimientos_financieros x
                                    where x.turno_caja_id = t.id
                                      and x.cuenta_financiera_id = t.cuenta_financiera_id
                                      and x.origen_tipo = 'TRANSFERENCIA'), 0))
                      from public.turnos_caja t
                     where t.cuenta_financiera_id = c.id
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

  -- Cada turno abierto tiene su pata en la general, una sola.
  if exists (
    select 1 from public.turnos_caja t
     where t.estado <> 'CERRADO' and coalesce(t.monto_inicial, 0) <> 0
       and (select count(*) from public.movimientos_financieros m
             where m.origen_tipo = 'TURNO_CAJA' and m.origen_id = t.id
               and m.evento = 'APERTURA_TURNO'
               and m.cuenta_financiera_id
                   = public.cuenta_financiera_sistema(t.negocio_id, 'CAJA_GENERAL')) <> 1
  ) then
    raise exception 'GUARD: un turno abierto quedó sin su pata en la general (o con dos)';
  end if;

  -- Los cuerpos dicen lo que tienen que decir.
  if pg_get_functiondef('public.registrar_bitacora_turno_caja()'::regprocedure)
     not like '%CAJA_GENERAL%' then
    raise exception 'GUARD: la bitácora del turno no toca la general';
  end if;
  if pg_get_functiondef('public.asignar_cuenta_financiera_actual()'::regprocedure)
     not like '%CAJA_GENERAL%' then
    raise exception 'GUARD: el egreso sin turno no va a la general';
  end if;
  -- ...y no perdieron lo que tenían.
  if pg_get_functiondef('public.asignar_cuenta_financiera_actual()'::regprocedure)
     not like '%BILLETERA_VIRTUAL%' then
    raise exception 'GUARD: la reescritura perdió la creación de cuenta por método';
  end if;
end
$guard$;

commit;
