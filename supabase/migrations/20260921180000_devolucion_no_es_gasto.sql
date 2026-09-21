-- Una devolución al cliente saca plata del cajón pero NO es un gasto:
-- `egresos.tipo = 'DEVOLUCION'`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL BUG, MEDIDO EL 21/9/2026
--
-- `anular_venta` y `registrar_devolucion` insertan el egreso del reintegro en
-- efectivo SIN `tipo`, así que caen en el default `OPERATIVO`. Y OPERATIVO es
-- el único tipo que resta de la ganancia (`tipo-egreso.ts`,
-- `get-dashboard-metrics.ts`, y el `impacto_resultado` del ledger). Pero la
-- venta anulada YA salió de los ingresos del panel —y la devolución parcial ya
-- le restó `monto_devuelto` al ticket—, así que la misma plata se descontaba
-- **dos veces**: una al sacar la venta, otra al contar el reintegro como
-- gasto.
--
-- **41 egresos, $1.977.999.** ClickTostado tiene tres por $1.175.000 (26 en
-- Evens por $510.650). "Gastos operativos" del panel venía inflado con eso y
-- la ganancia neta, hundida por lo mismo. Apareció midiendo qué conceptos
-- tienen los egresos OPERATIVO para diseñar las categorías de gastos: 25 de
-- 84 eran devoluciones, y la primera categoría que alguien iba a crear era
-- "Devoluciones" con el impacto en resultado mal.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA REGLA
--
-- DEVOLUCION: `afectaEfectivo = true` (el arqueo la sigue restando: la plata
-- salió del cajón) y `afectaResultado = false` (el resultado ya la absorbió
-- por el lado de la venta). Es el cuarto tipo del CHECK y de `TIPOS_EGRESO`,
-- con la misma forma que RETIRO_SOCIO y COMPRA_MERCADERIA: sale plata, no es
-- gasto.
--
-- La marca es COLUMNA, no heurística sobre el concepto (mismo criterio que
-- `es_venta_libre`): las dos RPCs pasan a escribir el tipo. El backfill sí
-- usa el patrón del concepto, pero es el texto que generan esas dos
-- funciones ("Devolucion en efectivo - Venta #…", "Devolucion parcial -
-- Venta #…", y el "Devolución Venta #…" de la versión anterior), no texto
-- tipeado. El único egreso manual que empieza con "devolucion" ("devolucion
-- de cobro el tala", Librería Colores) queda OPERATIVO a propósito: lo cargó
-- una persona y nadie sabe si es un reintegro de venta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CÓMO SE CORRIGEN LAS DOS RPCs SIN REESCRIBIRLAS
--
-- Son 4.000 y 8.700 caracteres de lógica probada, y `20260904140000` ya
-- enseñó lo que cuesta reescribir un cuerpo desde un archivo viejo. Acá el
-- cambio se aplica SOBRE EL CUERPO VIVO con `replace()` y `execute`: se toma
-- `pg_get_functiondef`, se reemplaza el insert (verificado antes que aparece
-- exactamente UNA vez en cada una) y se vuelve a crear. Un guard confirma que
-- las dos quedaron con `'DEVOLUCION'` adentro y que el insert viejo ya no
-- está. Si el patrón no matchea, la migración falla en vez de dejar la RPC
-- como estaba.
--
-- ─────────────────────────────────────────────────────────────────────────
-- Y LA BITÁCORA: LA CORRECCIÓN LLEVA LA FECHA DEL EGRESO
--
-- `registrar_bitacora_egreso` ya emite CORRECCION_REVERSA + CORRECCION_APLICADA
-- cuando cambia el tipo, con el `impacto_resultado` recalculado: el saldo de la
-- cuenta no se mueve (suman cero) y el resultado se corrige (neto +monto).
-- Pero las fechaba con `now()`, así que el backfill habría cargado en
-- septiembre una corrección de un gasto de julio: julio seguía mal y
-- septiembre se llevaba +$1,9M de "ganancia" que no es de septiembre.
--
-- Ahora la corrección lleva `fecha_movimiento = new.fecha`, la del egreso.
-- El CUÁNDO se corrigió queda en `registrado_en`, que sigue siendo `now()`:
-- la bitácora sigue siendo auditable, solo que la fecha económica y la fecha
-- de registro son dos columnas y cada una dice lo suyo. Es el mismo criterio
-- que `20260921120000` ("la fecha del movimiento es la esperada, nunca
-- now()").
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. EL TIPO
-- ─────────────────────────────────────────────────────────────────────────

alter table public.egresos
  drop constraint if exists egresos_tipo_check;
alter table public.egresos
  add constraint egresos_tipo_check
  check (tipo in ('OPERATIVO', 'RETIRO_SOCIO', 'COMPRA_MERCADERIA', 'DEVOLUCION'));

comment on column public.egresos.tipo is
  'OPERATIVO resta de la ganancia. RETIRO_SOCIO, COMPRA_MERCADERIA y DEVOLUCION sacan plata del cajón pero NO son gasto: el retiro es ganancia ya hecha, la compra ya viaja en precio_costo, la devolución ya salió por el lado de la venta anulada. Espejo en features/caja/lib/tipo-egreso.ts.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. LA BITÁCORA FECHA LA CORRECCIÓN EN EL EGRESO
--
-- Cuerpo vivo (`pg_get_functiondef`, 21/9/2026) con dos cambios: las filas de
-- CORRECCION usan `new.fecha`, y el impacto sale de una sola expresión
-- compartida en vez de tres `case` iguales.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.egreso_impacto_resultado(p_tipo text, p_monto numeric)
returns numeric
language sql
immutable
as $$
  select case when p_tipo = 'OPERATIVO' then -p_monto else 0 end;
$$;

comment on function public.egreso_impacto_resultado(text, numeric) is
  'Cuánto resta del resultado un egreso según su tipo. Solo OPERATIVO. Espejo de esGastoDelNegocio en tipo-egreso.ts.';

create or replace function public.registrar_bitacora_egreso()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  op uuid := gen_random_uuid();
  cambio boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      op, new.negocio_id, new.cuenta_origen_id, 'EGRESO', new.id, 'REGISTRO',
      -new.monto, public.egreso_impacto_resultado(new.tipo, new.monto),
      new.turno_caja_id, new.orden_compra_id, new.concepto,
      public.snapshot_financiero_egreso(new), new.fecha,
      coalesce(auth.uid(), new.creado_por)
    );
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
      importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      op, old.negocio_id, old.cuenta_origen_id, 'EGRESO', old.id, 'ELIMINACION_REVERSA',
      old.monto, -public.egreso_impacto_resultado(old.tipo, old.monto),
      old.turno_caja_id, old.orden_compra_id, old.concepto,
      jsonb_build_object('anterior', public.snapshot_financiero_egreso(old)),
      now(), auth.uid()
    );
    return old;
  end if;

  cambio := row(old.negocio_id, old.cuenta_origen_id, old.monto, old.tipo,
                old.concepto, old.turno_caja_id, old.orden_compra_id)
            is distinct from
            row(new.negocio_id, new.cuenta_origen_id, new.monto, new.tipo,
                new.concepto, new.turno_caja_id, new.orden_compra_id);
  if not cambio then
    return new;
  end if;

  -- Fecha ECONÓMICA del egreso, no now(): ver el encabezado. `registrado_en`
  -- guarda cuándo se corrigió.
  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
    importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values
  (
    op, old.negocio_id, old.cuenta_origen_id, 'EGRESO', old.id, 'CORRECCION_REVERSA',
    old.monto, -public.egreso_impacto_resultado(old.tipo, old.monto),
    old.turno_caja_id, old.orden_compra_id, old.concepto,
    jsonb_build_object('anterior', public.snapshot_financiero_egreso(old),
                       'nuevo', public.snapshot_financiero_egreso(new)),
    new.fecha, auth.uid()
  ),
  (
    op, new.negocio_id, new.cuenta_origen_id, 'EGRESO', new.id, 'CORRECCION_APLICADA',
    -new.monto, public.egreso_impacto_resultado(new.tipo, new.monto),
    new.turno_caja_id, new.orden_compra_id, new.concepto,
    jsonb_build_object('anterior', public.snapshot_financiero_egreso(old),
                       'nuevo', public.snapshot_financiero_egreso(new)),
    new.fecha, auth.uid()
  );
  return new;
end;
$$;

revoke all on function public.registrar_bitacora_egreso() from public;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. LAS DOS RPCs ESCRIBEN EL TIPO (parche sobre el cuerpo vivo)
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
  v_def text;
  v_hdr constant text := E'turno_caja_id)\n    values (\n      v_negocio,';
  v_hdr_nuevo constant text := E'turno_caja_id, tipo)\n    values (\n      v_negocio,';
  v_tail constant text := E'p_turno_id\n    );';
  v_tail_nuevo constant text := E'p_turno_id,\n      \'DEVOLUCION\'\n    );';
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('anular_venta', 'registrar_devolucion')
  loop
    v_def := pg_get_functiondef(r.oid);

    -- Ya parcheada (re-ejecución): nada que hacer.
    if v_def like '%''DEVOLUCION''%' then
      continue;
    end if;

    if (length(v_def) - length(replace(v_def, v_hdr, ''))) / length(v_hdr) <> 1
       or (length(v_def) - length(replace(v_def, v_tail, ''))) / length(v_tail) <> 1 then
      raise exception 'GUARD: el insert de egresos de % no aparece exactamente una vez; revisar a mano', r.proname;
    end if;

    v_def := replace(v_def, v_hdr, v_hdr_nuevo);
    v_def := replace(v_def, v_tail, v_tail_nuevo);
    execute v_def;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. BACKFILL: los 41 reintegros que cayeron en OPERATIVO
--
-- El UPDATE dispara la bitácora: por cada uno, dos filas fechadas en el
-- egreso que dejan el saldo igual y el resultado corregido.
-- ─────────────────────────────────────────────────────────────────────────

update public.egresos
   set tipo = 'DEVOLUCION'
 where tipo = 'OPERATIVO'
   and concepto ~* '^devoluci[oó]n (en efectivo|parcial)? ?-? ?venta #';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  r record;
  v_pend int;
begin
  for r in
    select p.proname, pg_get_functiondef(p.oid) def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('anular_venta', 'registrar_devolucion')
  loop
    if r.def not like '%turno_caja_id, tipo)%' or r.def not like '%''DEVOLUCION''%' then
      raise exception 'GUARD: % no escribe tipo DEVOLUCION', r.proname;
    end if;
    -- Y no se perdió nada del cuerpo: el parche solo agrega.
    if r.proname = 'anular_venta' and r.def not like '%cuenta_corriente_movimientos%' then
      raise exception 'GUARD: anular_venta perdió el crédito de cuenta corriente';
    end if;
    if r.proname = 'registrar_devolucion' and r.def not like '%reintegro_metodo_tipo%' then
      raise exception 'GUARD: registrar_devolucion perdió el medio de reintegro';
    end if;
  end loop;

  select count(*) into v_pend
    from public.egresos
   where tipo = 'OPERATIVO'
     and concepto ~* '^devoluci[oó]n (en efectivo|parcial)? ?-? ?venta #';
  if v_pend > 0 then
    raise exception 'GUARD: quedaron % reintegros como OPERATIVO', v_pend;
  end if;

  -- El saldo de cada cuenta no se movió con el backfill: por egreso
  -- corregido, la suma de sus movimientos sigue siendo -monto.
  if exists (
    select 1
      from public.egresos e
      join public.movimientos_financieros m
        on m.origen_tipo = 'EGRESO' and m.origen_id = e.id
     where e.tipo = 'DEVOLUCION'
     group by e.id, e.monto
    having abs(sum(m.importe) + e.monto) > 0.01
  ) then
    raise exception 'GUARD: un reintegro cambió el saldo de su cuenta al recategorizarse';
  end if;

  -- Y su impacto en resultado quedó en cero.
  if exists (
    select 1
      from public.egresos e
      join public.movimientos_financieros m
        on m.origen_tipo = 'EGRESO' and m.origen_id = e.id
     where e.tipo = 'DEVOLUCION'
     group by e.id
    having abs(sum(m.impacto_resultado)) > 0.01
  ) then
    raise exception 'GUARD: un reintegro sigue restando del resultado';
  end if;

  -- La bitácora fecha la corrección en el egreso.
  if pg_get_functiondef('public.registrar_bitacora_egreso()'::regprocedure)
     not like '%new.fecha, auth.uid()%' then
    raise exception 'GUARD: la corrección de egreso volvió a fecharse con now()';
  end if;
end
$guard$;

commit;
