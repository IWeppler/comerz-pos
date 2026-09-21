-- Etapa 2: un cobro diferido se acredita SOLO cuando llega su fecha.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ PROBLEMA RESUELVE
--
-- La Etapa 2 del ledger (`20260919130000`) decidió que la bitácora "no inventa
-- acreditaciones por fecha estimada: eso vendrá en una etapa posterior". Esta
-- es esa etapa, y el motivo para hacerla es concreto: desde que la pestaña
-- Dinero lee el ledger, "acreditado en el período" sale de los movimientos
-- `ACREDITACION_ENTRADA`, que los escribe `registrar_acreditacion_financiera`
-- — una RPC que **no tiene una sola llamada en el código**. O sea que la
-- tarjeta muestra CERO en los 11 negocios, y el puente POR_ACREDITAR acumula
-- tarjetas que cayeron hace semanas.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA FECHA ESPERADA NO ES UNA INVENCIÓN
--
-- El reparo de la Etapa 2 era bueno pero se aplicó al dato equivocado.
-- `metodos_pago.acreditacion_dias` no lo adivina el sistema: lo configuró el
-- comercio, y es el mismo número con el que `posicion_dinero` viene armando
-- "por acreditar" desde agosto. Lo que sí sería inventar es afirmar que la
-- plata cayó un día distinto del pactado sin haber visto el extracto.
--
-- Por eso la acreditación automática se marca como ESTIMADA
-- (`acreditaciones_financieras.estimada`), y la conciliación real —la RPC
-- manual, cuando exista su pantalla— queda como CORRECCIÓN opcional, no como
-- requisito. Nadie va a tildar 593 cobros para que un número deje de mentir.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO HAY CRON
--
-- `pg_cron` está disponible en el proyecto pero sin instalar, y no hace falta:
-- es el mismo criterio que la mora de cuenta corriente, que "NO se aplica sola
-- al día 31, se materializa cuando la clienta paga". Acá se materializa cuando
-- alguien abre la pestaña Dinero de ese negocio. Un comercio que nadie mira no
-- acumula nada que le importe a nadie, y no se agrega una dependencia de
-- infraestructura para sostener un número que solo se lee en una pantalla.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA IDEMPOTENCIA NO SE ESCRIBE: YA ESTABA
--
-- La acreditación automática usa las MISMAS tablas que la manual, y
-- `acreditaciones_financieras_pagos` tiene `unique (negocio_id, venta_pago_id)`.
-- O sea que un cobro no puede liquidarse dos veces ni aunque dos pestañas
-- abran la pantalla a la vez, y la conciliación manual posterior tampoco puede
-- duplicarlo: choca contra el mismo unique. El advisory lock por negocio es
-- para que dos renders concurrentes no se pisen a mitad del lote, no para la
-- unicidad.
--
-- La fecha del movimiento es la ESPERADA, no `now()`: si una tarjeta del 1/9 a
-- 20 días se acredita el 25/9 porque ese día alguien abrió la pantalla, el
-- movimiento tiene que decir 21/9. Si no, "acreditado este mes" dependería de
-- cuándo se mira, que es exactamente lo que un reporte no puede hacer.

begin;

alter table public.acreditaciones_financieras
  add column if not exists estimada boolean not null default false;

comment on column public.acreditaciones_financieras.estimada is
  'La acreditacion la genero el sistema por la fecha pactada en metodos_pago.acreditacion_dias, no una conciliacion contra el extracto. Ver 20260921120000.';

-- ─────────────────────────────────────────────────────────────────────────
-- ACREDITAR LO VENCIDO
--
-- Trabaja sobre el negocio ACTIVO, no sobre todos: así respeta el mismo
-- aislamiento que el resto de la base y no necesita recorrer tenants desde una
-- función sin sesión.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.acreditar_cobros_vencidos()
returns integer
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_puente  uuid;
  g         record;
  v_acred   uuid;
  v_total   integer := 0;
begin
  if v_negocio is null then
    return 0;
  end if;

  -- Sin permiso no se escribe nada, pero tampoco se rompe: esto lo dispara una
  -- lectura, y una lectura que explota por un permiso que la pantalla ya
  -- controla es peor que una lectura que no acredita.
  if not public.tiene_permiso('caja.ver_gerencial') then
    return 0;
  end if;

  v_puente := public.cuenta_financiera_sistema(v_negocio, 'POR_ACREDITAR');
  if v_puente is null then
    return 0;
  end if;

  -- Serializa dos renders concurrentes del mismo negocio. La unicidad real la
  -- da `acreditaciones_financieras_pagos`; esto evita el trabajo duplicado.
  perform pg_advisory_xact_lock(hashtext('acreditar:' || v_negocio::text));

  for g in
    select
      coalesce(vp.cuenta_destino_id, m.cuenta_destino_id) as cuenta_id,
      ((vp.creado_en + (vp.acreditacion_dias || ' days')::interval)
        at time zone 'America/Argentina/Buenos_Aires')::date as fecha,
      sum(vp.monto_neto) as neto,
      array_agg(vp.id) as pagos
    from public.venta_pagos vp
    left join public.metodos_pago m
      on m.id = vp.metodo_pago_id and m.negocio_id = vp.negocio_id
    where vp.negocio_id = v_negocio
      and vp.metodo_tipo <> 'EFECTIVO'
      and coalesce(vp.acreditacion_dias, 0) > 0
      and vp.creado_en + (vp.acreditacion_dias || ' days')::interval <= now()
      and coalesce(vp.cuenta_destino_id, m.cuenta_destino_id) is not null
      -- El MISMO predicado que `posicion_dinero` usa para el bloque digital:
      -- un cobro anulado y revertido por su propio medio ya salió del puente,
      -- y acreditarlo movería plata que ahí no está.
      and (
        vp.estado_pago_operacion <> 'ANULADO'
        or exists (
          select 1 from public.ventas v
           where v.id = vp.venta_id
             and v.negocio_id = vp.negocio_id
             and v.reintegro_metodo_id is not null
             and v.reintegro_metodo_id is distinct from vp.metodo_pago_id
        )
      )
      and not exists (
        select 1 from public.acreditaciones_financieras_pagos ap
         where ap.negocio_id = vp.negocio_id
           and ap.venta_pago_id = vp.id
      )
    group by 1, 2
    -- `importe_neto` tiene CHECK de > 0. Un grupo que dé cero o negativo no es
    -- una acreditación: es un cobro cuya comisión se lo comió entero, y no hay
    -- nada que mover.
    having sum(vp.monto_neto) > 0
  loop
    -- Una cuenta puente nunca es destino, y una cuenta dada de baja tampoco:
    -- acreditar ahí escondería la plata en un lugar que la pantalla no lista.
    if not exists (
      select 1 from public.cuentas_financieras c
       where c.id = g.cuenta_id
         and c.negocio_id = v_negocio
         and c.activa
         and c.codigo <> 'POR_ACREDITAR'
    ) then
      continue;
    end if;

    insert into public.acreditaciones_financieras (
      negocio_id, cuenta_destino_id, fecha_acreditacion, referencia,
      importe_neto, estimada, creado_por
    ) values (
      v_negocio, g.cuenta_id, g.fecha::timestamptz,
      'Acreditacion estimada por fecha pactada', g.neto, true, null
    )
    returning id into v_acred;

    insert into public.acreditaciones_financieras_pagos (
      acreditacion_id, venta_pago_id, negocio_id, monto_neto
    )
    select v_acred, vp.id, v_negocio, vp.monto_neto
      from public.venta_pagos vp
     where vp.id = any(g.pagos);

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id,
      evento, importe, impacto_resultado, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values
      (v_acred, v_negocio, v_puente, 'ACREDITACION', v_acred,
       'ACREDITACION_SALIDA', -g.neto, 0,
       'Acreditacion estimada por fecha pactada',
       jsonb_build_object('cuenta_destino_id', g.cuenta_id, 'estimada', true),
       g.fecha::timestamptz, null),
      (v_acred, v_negocio, g.cuenta_id, 'ACREDITACION', v_acred,
       'ACREDITACION_ENTRADA', g.neto, 0,
       'Acreditacion estimada por fecha pactada',
       jsonb_build_object('cuenta_puente_id', v_puente, 'estimada', true),
       g.fecha::timestamptz, null);

    v_total := v_total + array_length(g.pagos, 1);
  end loop;

  return v_total;
end;
$$;

revoke all on function public.acreditar_cobros_vencidos() from public, anon;
grant execute on function public.acreditar_cobros_vencidos() to authenticated;

comment on function public.acreditar_cobros_vencidos() is
  'Mueve del puente POR_ACREDITAR a su cuenta los cobros diferidos cuya fecha pactada ya paso. Idempotente por el unique de acreditaciones_financieras_pagos. La dispara la lectura de la pestana Dinero: no hay cron.';

-- ─────────────────────────────────────────────────────────────────────────
-- GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_cuerpo text;
begin
  select pg_get_functiondef(p.oid) into v_cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'acreditar_cobros_vencidos';

  -- La unicidad la da la tabla, pero el filtro tiene que estar igual: sin el
  -- `not exists` cada lectura intentaria reacreditar todo y abortaria con 23505.
  if v_cuerpo not like '%acreditaciones_financieras_pagos%' then
    raise exception 'GUARD: acreditar_cobros_vencidos dejo de chequear lo ya liquidado';
  end if;

  -- La fecha del movimiento tiene que ser la esperada, nunca now(): si no,
  -- "acreditado este mes" cambia segun cuando se mire.
  if v_cuerpo like '%now(), null)%' then
    raise exception 'GUARD: la acreditacion estimada se esta fechando con now()';
  end if;
end;
$guard$;

commit;
