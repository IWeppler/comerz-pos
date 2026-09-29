-- BASELINE del esquema: `supabase db dump` de producción, 29/9/2026.
-- Reemplaza a todas las migraciones anteriores (tag de git
-- `migraciones-pre-baseline`). Lo que el dump no trae (permisos, planes,
-- Storage) está en `20260929120001_baseline_datos_y_storage.sql`.
-- Ver AGENTS.md, "Las migraciones arrancan en un BASELINE".

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "archivo";


ALTER SCHEMA "archivo" OWNER TO "postgres";


COMMENT ON SCHEMA "archivo" IS 'Tablas fuera de uso que se conservan por las dudas. Sin acceso para anon ni authenticated: sólo service_role/postgres.';



COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "respaldos";


ALTER SCHEMA "respaldos" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "security";


ALTER SCHEMA "security" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."aceptar_invitacion"("p_token" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user  uuid := auth.uid();
    v_email text;
    v_inv   public.invitaciones;
    v_rol   text;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Hay que iniciar sesión para aceptar una invitación';
    END IF;

    SELECT email INTO v_email FROM auth.users WHERE id = v_user;
    IF v_email IS NULL THEN
        RAISE EXCEPTION 'La cuenta no tiene email verificable';
    END IF;

    INSERT INTO public.perfiles (id, email, nombre)
    VALUES (v_user, v_email, split_part(v_email, '@', 1))
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.invitaciones
    SET estado = 'ACEPTADA'
    WHERE token = p_token
      AND estado = 'PENDIENTE'
      AND expira_en > now()
      AND lower(email) = lower(v_email)
    RETURNING * INTO v_inv;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitación inválida, vencida o de otro email';
    END IF;

    SELECT CASE WHEN r.nombre = 'ENCARGADO' THEN 'VENDEDOR' ELSE r.nombre END
    INTO v_rol
    FROM public.roles r WHERE r.id = v_inv.rol_id;

    INSERT INTO public.usuarios_negocios (usuario_id, negocio_id, rol_id, rol)
    VALUES (v_user, v_inv.negocio_id, v_inv.rol_id, v_rol)
    ON CONFLICT (usuario_id, negocio_id) DO NOTHING;

    RETURN v_inv.negocio_id;
END;
$$;


ALTER FUNCTION "public"."aceptar_invitacion"("p_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aceptar_invitaciones_pendientes"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user    uuid := auth.uid();
  v_email   text;
  v_inv     public.invitaciones;
  v_rol     text;
  v_negocio uuid;
begin
  if v_user is null then
    return null;
  end if;

  select email into v_email from auth.users where id = v_user;
  if v_email is null then
    return null;
  end if;

  -- El perfil puede no existir todavía (cuenta creada por el invite, sin
  -- pasar por el alta). Mismo guard que aceptar_invitacion.
  insert into public.perfiles (id, email, nombre)
  values (v_user, v_email, split_part(v_email, '@', 1))
  on conflict (id) do nothing;

  for v_inv in
    update public.invitaciones
    set estado = 'ACEPTADA'
    where lower(email) = lower(v_email)
      and estado = 'PENDIENTE'
      and expira_en > now()
    returning *
  loop
    select case when r.nombre = 'ENCARGADO' then 'VENDEDOR' else r.nombre end
    into v_rol
    from public.roles r
    where r.id = v_inv.rol_id;

    insert into public.usuarios_negocios (usuario_id, negocio_id, rol_id, rol)
    values (v_user, v_inv.negocio_id, v_inv.rol_id, v_rol)
    on conflict (usuario_id, negocio_id) do nothing;

    v_negocio := coalesce(v_negocio, v_inv.negocio_id);
  end loop;

  return v_negocio;
end;
$$;


ALTER FUNCTION "public"."aceptar_invitaciones_pendientes"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."aceptar_invitaciones_pendientes"() IS 'Acepta todas las invitaciones PENDIENTES vigentes del email de la sesión y devuelve el negocio de la primera (null si no había). El email verificado es la credencial, no el token del link.';



CREATE OR REPLACE FUNCTION "public"."acreditar_cobros_vencidos"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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
  -- lectura.
  if not public.tiene_permiso('caja.ver_gerencial') then
    return 0;
  end if;

  v_puente := public.cuenta_financiera_sistema(v_negocio, 'POR_ACREDITAR');
  if v_puente is null then
    return 0;
  end if;

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
      -- El MISMO predicado que posicion_dinero usa para el bloque digital.
      and (
        vp.estado_pago_operacion <> 'ANULADO'
        or exists (
          select 1 from public.ventas v
           where v.id = vp.venta_id
             and v.negocio_id = vp.negocio_id
             and (v.reintegro_metodo_tipo = 'SALDO_A_FAVOR' or (v.reintegro_metodo_id is not null and v.reintegro_metodo_id is distinct from vp.metodo_pago_id))
        )
      )
      and not exists (
        select 1 from public.acreditaciones_financieras_pagos ap
         where ap.negocio_id = vp.negocio_id
           and ap.venta_pago_id = vp.id
      )
    group by 1, 2
    having sum(vp.monto_neto) > 0
  loop
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


ALTER FUNCTION "public"."acreditar_cobros_vencidos"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."acreditar_cobros_vencidos"() IS 'Mueve del puente POR_ACREDITAR a su cuenta los cobros diferidos cuya fecha pactada ya paso. Idempotente por el unique de acreditaciones_financieras_pagos. La dispara la lectura de la pestana Dinero: no hay cron.';



CREATE OR REPLACE FUNCTION "public"."ajustar_saldo_cliente"("p_cliente_id" "uuid", "p_delta" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio     uuid := security.current_negocio_id();
  v_saldo       numeric;
  v_vencimiento date;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if p_cliente_id is null or p_delta is null then
    raise exception 'AJUSTE_SALDO_DATOS_INVALIDOS';
  end if;

  -- El movimiento del libro ya está escrito por quien llama: el vencimiento
  -- lo ve. Delta en el mismo statement, sin recorte.
  update public.clientes c
     set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + p_delta,
         fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(p_cliente_id)
   where c.id = p_cliente_id
     and c.negocio_id = v_negocio
  returning c.saldo_pendiente, c.fecha_vencimiento_deuda
    into v_saldo, v_vencimiento;

  -- Un UPDATE filtrado por RLS es un éxito silencioso: se falla fuerte.
  if not found then
    raise exception 'CLIENTE_NO_ENCONTRADO';
  end if;

  return jsonb_build_object(
    'saldo_pendiente', v_saldo,
    'fecha_vencimiento_deuda', v_vencimiento
  );
end;
$$;


ALTER FUNCTION "public"."ajustar_saldo_cliente"("p_cliente_id" "uuid", "p_delta" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ajustar_saldo_cliente"("p_cliente_id" "uuid", "p_delta" numeric) IS 'Mueve el caché de saldo de un cliente por delta, en un statement y sin recorte a cero, y recalcula el vencimiento. El movimiento del libro lo escribe quien llama ANTES. SECURITY INVOKER.';



CREATE OR REPLACE FUNCTION "public"."ajustar_stock_legacy"("p_producto_id" "uuid", "p_variante" "text", "p_delta" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
begin
  insert into public.productos_stock (negocio_id, producto_id, variante, cantidad)
  values (
    security.current_negocio_id(),
    p_producto_id,
    p_variante,
    greatest(0, p_delta)
  )
  on conflict (producto_id, variante) do update
    set cantidad = greatest(0, public.productos_stock.cantidad + p_delta);
end;
$$;


ALTER FUNCTION "public"."ajustar_stock_legacy"("p_producto_id" "uuid", "p_variante" "text", "p_delta" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ajustar_stock_legacy"("p_producto_id" "uuid", "p_variante" "text", "p_delta" numeric) IS 'Suma (o resta) sobre el espejo legacy productos_stock en un solo statement. Existe para no volver a leer-y-despues-escribir esa tabla. El stock real se mueve con ajustar_stock_variante; esto solo mantiene el espejo.';



CREATE OR REPLACE FUNCTION "public"."ajustar_stock_variante"("p_variante_id" "uuid", "p_delta" numeric, "p_permitir_negativo" boolean DEFAULT false, "p_origen" "text" DEFAULT NULL::"text", "p_referencia_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "stock" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
begin
  if p_origen is not null then
    perform public.marcar_origen_movimiento(p_origen, p_referencia_id);
  end if;

  return query
  update public.producto_variantes
     set stock      = producto_variantes.stock + p_delta,
         updated_at = now()
   where producto_variantes.id = p_variante_id
     and (p_permitir_negativo or producto_variantes.stock + p_delta >= 0)
  returning producto_variantes.id, producto_variantes.stock;
end;
$$;


ALTER FUNCTION "public"."ajustar_stock_variante"("p_variante_id" "uuid", "p_delta" numeric, "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ajustar_stock_variante"("p_variante_id" "uuid", "p_delta" numeric, "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") IS 'Descuenta o repone stock de UNA variante con UPDATE condicional atomico. Escribe updated_at desde 20260902160000: sin eso la venta no dejaba marca de tiempo y el 99,7% de las variantes tenia updated_at = created_at.';



CREATE OR REPLACE FUNCTION "public"."ajustar_stock_variantes"("p_movimientos" "jsonb", "p_permitir_negativo" boolean DEFAULT false, "p_origen" "text" DEFAULT NULL::"text", "p_referencia_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("id" "uuid", "stock" numeric)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  v_pedidos    jsonb;
  v_esperados  integer;
  v_aplicados  integer;
  v_faltantes  jsonb;
begin
  if p_origen is not null then
    perform public.marcar_origen_movimiento(p_origen, p_referencia_id);
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('variante_id', t.variante_id, 'delta', t.delta)),
           '[]'::jsonb
         )
    into v_pedidos
    from (
      select (m->>'variante_id')::uuid as variante_id,
             sum((m->>'delta')::numeric) as delta
        from jsonb_array_elements(coalesce(p_movimientos, '[]'::jsonb)) as m
       group by 1
    ) t;

  v_esperados := jsonb_array_length(v_pedidos);
  if v_esperados = 0 then
    return;
  end if;

  perform 1
     from public.producto_variantes v
    where v.id in (
            select p.variante_id
              from jsonb_to_recordset(v_pedidos) as p(variante_id uuid, delta numeric)
          )
    order by v.id
      for update;

  select coalesce(jsonb_agg(p.variante_id), '[]'::jsonb)
    into v_faltantes
    from jsonb_to_recordset(v_pedidos) as p(variante_id uuid, delta numeric)
    left join public.producto_variantes v on v.id = p.variante_id
   where v.id is null
      or (not p_permitir_negativo and v.stock + p.delta < 0);

  if jsonb_array_length(v_faltantes) > 0 then
    raise exception 'STOCK_INSUFICIENTE'
      using detail = v_faltantes::text, errcode = 'P0001';
  end if;

  return query
  update public.producto_variantes v
     set stock      = v.stock + p.delta,
         updated_at = now()
    from jsonb_to_recordset(v_pedidos) as p(variante_id uuid, delta numeric)
   where v.id = p.variante_id
     and (p_permitir_negativo or v.stock + p.delta >= 0)
  returning v.id, v.stock;

  get diagnostics v_aplicados = row_count;

  if v_aplicados <> v_esperados then
    raise exception 'STOCK_INSUFICIENTE'
      using detail = '[]', errcode = 'P0001';
  end if;
end;
$$;


ALTER FUNCTION "public"."ajustar_stock_variantes"("p_movimientos" "jsonb", "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ajustar_stock_variantes"("p_movimientos" "jsonb", "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") IS 'Descuenta o repone stock de VARIAS variantes en un statement, con lock ordenado por id para evitar deadlocks. Escribe updated_at desde 20260902160000, por el mismo motivo que la version de a una.';



CREATE OR REPLACE FUNCTION "public"."alertas_caja"("p_dias" integer DEFAULT 30) RETURNS TABLE("clave" "text", "tipo" "text", "severidad" "text", "fecha" timestamp with time zone, "titulo" "text", "detalle" "text", "monto" numeric, "turno_id" "uuid", "revisada" boolean, "revisada_por" "text", "revisada_en" timestamp with time zone, "nota" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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
       and not (t.estado = 'CERRADO' and t.monto_inicial = 0 and coalesce(t.monto_declarado, 0) = 0)
  ),
  alertas as (
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
    select 'CAMBIO_COMO_GASTO:' || e.id, 'CAMBIO_COMO_GASTO', 'ALTA', e.fecha,
           'Cambio cargado como gasto',
           format('"%s" está cargado como gasto. Un cambio de efectivo por transferencia es un pase entre cuentas: anulalo y registralo con Transferir.', e.concepto),
           e.monto::numeric, e.turno_caja_id
      from public.egresos e
     where e.negocio_id = v_neg and e.fecha >= v_desde
       and e.concepto ilike '%cambio%'

    union all
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
    select 'SALIDA_CAJA_GRANDE:' || e.id, 'SALIDA_CAJA_GRANDE', 'BAJA', e.fecha,
           'Salida grande de la Caja Grande',
           format('"%s".', e.concepto),
           e.monto::numeric, null::uuid
      from public.egresos e
     where e.negocio_id = v_neg and e.fecha >= v_desde
       and e.cuenta_origen_id = v_cg and e.monto >= 100000

    union all
    select 'DEVOLUCION_EFECTIVO:' || e.id, 'DEVOLUCION_EFECTIVO', 'BAJA', e.fecha,
           'Devolución en efectivo',
           e.concepto,
           e.monto::numeric, e.turno_caja_id
      from public.egresos e
     where e.negocio_id = v_neg and e.fecha >= v_desde
       and e.tipo = 'DEVOLUCION' and e.monto >= 10000

    union all
    select 'COBRO_CORREGIDO:' || m.id, 'COBRO_CORREGIDO', 'MEDIA', m.registrado_en,
           'Cobro corregido a mano',
           'Se cambió el medio de pago o el monto de un cobro después de registrado. Si pasó de efectivo a otro medio (o al revés), cambia lo que tiene que haber en el cajón.',
           m.importe, m.turno_caja_id
      from public.movimientos_financieros m
     where m.negocio_id = v_neg and m.registrado_en >= v_desde
       and m.origen_tipo = 'VENTA_PAGO' and m.evento = 'CORRECCION_APLICADA'
       and m.registrado_por is not null

    union all
    select 'AJUSTE_CUENTA:' || m.id, 'AJUSTE_CUENTA', 'ALTA', m.fecha_movimiento,
           'Ajuste de saldo de una cuenta',
           coalesce(m.descripcion, 'Ajuste manual del saldo.'),
           m.importe, null::uuid
      from public.movimientos_financieros m
     where m.negocio_id = v_neg and m.fecha_movimiento >= v_desde
       and m.origen_tipo = 'AJUSTE' and m.evento = 'REGISTRO'

    union all
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


ALTER FUNCTION "public"."alertas_caja"("p_dias" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alertas_caja_pendientes"() RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."alertas_caja_pendientes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."alta_empleado_local"("p_usuario_id" "uuid", "p_rol_id" "uuid", "p_nombre" "text", "p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_rol     text;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_usuario_id) then
    raise exception 'USUARIO_NO_EXISTE';
  end if;
  if exists (select 1 from public.usuarios_negocios where usuario_id = p_usuario_id) then
    raise exception 'USUARIO_YA_TIENE_NEGOCIO';
  end if;

  select case when r.nombre = 'ENCARGADO' then 'VENDEDOR' else r.nombre end
    into v_rol
    from public.roles r
   where r.id = p_rol_id and r.negocio_id = v_negocio;
  if v_rol is null then
    raise exception 'ROL_INVALIDO';
  end if;

  insert into public.perfiles (id, email, nombre)
  values (
    p_usuario_id,
    lower(p_email),
    coalesce(nullif(trim(p_nombre), ''), split_part(lower(p_email), '@', 1))
  )
  on conflict (id) do update
    set nombre = coalesce(nullif(trim(p_nombre), ''), public.perfiles.nombre),
        email  = lower(p_email);

  insert into public.usuarios_negocios (usuario_id, negocio_id, rol_id, rol)
  values (p_usuario_id, v_negocio, p_rol_id, v_rol);

  return v_negocio;
end;
$$;


ALTER FUNCTION "public"."alta_empleado_local"("p_usuario_id" "uuid", "p_rol_id" "uuid", "p_nombre" "text", "p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."alta_empleado_local"("p_usuario_id" "uuid", "p_rol_id" "uuid", "p_nombre" "text", "p_email" "text") IS 'Perfil + membresia para un usuario recien creado por el admin con contrasena (sin invitacion). SECURITY DEFINER acotado: is_admin(), usuario sin ninguna membresia previa, rol del negocio activo. El tope del plan lo sigue aplicando el trigger.';



CREATE OR REPLACE FUNCTION "public"."antiguedad_saldo_cc"("p_limite" integer DEFAULT 15) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_limite  int := greatest(1, least(coalesce(p_limite, 15), 100));
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenes permiso para ver la antiguedad de la deuda'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;

  with mov as (
    select cliente_id, tipo, monto, creado_en
      from public.cuenta_corriente_movimientos
     where negocio_id = v_negocio
       and coalesce(anulado, false) = false
       and cliente_id is not null
  ),
  creditos as (
    select cliente_id, sum(monto) as pagado
      from mov where tipo = 'CREDITO' group by cliente_id
  ),
  debitos as (
    select
      d.cliente_id,
      d.monto,
      (d.creado_en at time zone v_tz)::date as fecha,
      sum(d.monto) over (
        partition by d.cliente_id order by d.creado_en
        rows between unbounded preceding and current row
      ) as acumulado
    from mov d
    where d.tipo = 'DEBITO'
  ),
  vivo as (
    select
      d.cliente_id,
      d.fecha,
      greatest(0, least(d.monto, d.acumulado - coalesce(c.pagado, 0))) as saldo,
      (v_hoy - d.fecha) as dias
    from debitos d
    left join creditos c on c.cliente_id = d.cliente_id
  ),
  vivos as (select * from vivo where saldo > 0.05),
  tramos as (
    select
      case when dias <= 30 then '0_30' when dias <= 60 then '31_60'
           when dias <= 90 then '61_90' else 'MAS_90' end as tramo,
      case when dias <= 30 then 1 when dias <= 60 then 2
           when dias <= 90 then 3 else 4 end as orden,
      sum(saldo) as saldo,
      count(distinct cliente_id) as clientes
    from vivos group by 1, 2
  ),
  por_cliente as (
    select
      v.cliente_id,
      coalesce(cl.nombre, 'Cliente eliminado') as cliente,
      cl.telefono,
      sum(v.saldo)  as saldo,
      max(v.dias)   as dias_mas_viejo
    from vivos v
    left join public.clientes cl on cl.id = v.cliente_id
    group by v.cliente_id, cl.nombre, cl.telefono
  ),
  descuadre as (
    select count(*) as clientes
    from public.clientes cl
    left join (
      select cliente_id,
             sum(case when tipo = 'DEBITO' then monto else -monto end) as libro
      from mov group by cliente_id
    ) l on l.cliente_id = cl.id
    where cl.negocio_id = v_negocio
      and (coalesce(cl.saldo_pendiente, 0) > 0 or l.libro is not null)
      and abs(coalesce(l.libro, 0) - coalesce(cl.saldo_pendiente, 0)) > 1
  )
  select jsonb_build_object(
    'generado_en', now(),
    'hoy', v_hoy,
    'imputacion', 'FIFO: los pagos cancelan las deudas mas viejas primero. Los pagos de cuenta corriente no estan imputados a una venta, asi que esto es un supuesto, no un dato.',
    'total_vivo', (select round(coalesce(sum(saldo), 0), 2) from vivos),
    'clientes_con_deuda', (select count(*) from por_cliente),
    'clientes_descuadrados', (select clientes from descuadre),
    'tramos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'tramo', tramo,
        'saldo', round(saldo, 2),
        'clientes', clientes,
        'pct', round(saldo * 100.0 / nullif((select sum(saldo) from vivos), 0), 2)
      ) order by orden), '[]'::jsonb)
      from tramos
    ),
    'peores_deudores', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cliente', cliente,
        'telefono', telefono,
        'saldo', round(saldo, 2),
        'dias_mas_viejo', dias_mas_viejo
      ) order by saldo desc), '[]'::jsonb)
      from (select * from por_cliente order by saldo desc limit v_limite) x
    ),
    'mas_antiguos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cliente', cliente,
        'telefono', telefono,
        'saldo', round(saldo, 2),
        'dias_mas_viejo', dias_mas_viejo
      ) order by dias_mas_viejo desc), '[]'::jsonb)
      from (select * from por_cliente order by dias_mas_viejo desc limit v_limite) x
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."antiguedad_saldo_cc"("p_limite" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."antiguedad_saldo_cc"("p_limite" integer) IS 'Comerz Insights: antiguedad del saldo de cuenta corriente por tramo y por cliente. Sustituto honesto de la incobrabilidad, que con 5 semanas de historia no se puede calcular. Imputa FIFO y lo declara. Gate: caja.ver_gerencial.';



CREATE OR REPLACE FUNCTION "public"."anular_egreso"("p_egreso_id" "uuid", "p_motivo" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare v_negocio uuid := security.current_negocio_id(); v_egreso public.egresos; v_cuenta public.cuentas_financieras; v_turno public.turnos_caja; v_filas int;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.anular_movimiento') then raise exception 'SIN_PERMISO' using errcode = '42501'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;
  -- DEFINER: cada consulta filtra negocio_id a mano.
  select * into v_egreso from public.egresos where id = p_egreso_id and negocio_id = v_negocio for update;
  if v_egreso.id is null then raise exception 'EGRESO_NO_ENCONTRADO'; end if;
  if v_egreso.tipo = 'DEVOLUCION' then
    raise exception 'EGRESO_ES_REINTEGRO_DE_VENTA' using hint = 'Ese reintegro lo generó una anulación o devolución de venta; se corrige desde la venta.';
  end if;
  select * into v_cuenta from public.cuentas_financieras where id = v_egreso.cuenta_origen_id and negocio_id = v_negocio;
  if coalesce(v_cuenta.requiere_arqueo, false) then
    if v_egreso.turno_caja_id is null then raise exception 'EGRESO_DE_CAJA_SIN_TURNO'; end if;
    select * into v_turno from public.turnos_caja where id = v_egreso.turno_caja_id and negocio_id = v_negocio for update;
    if v_turno.id is null or v_turno.estado <> 'ABIERTO' then
      raise exception 'TURNO_CERRADO' using hint = 'El turno de ese gasto ya se cerró y se firmó. Registrá un ingreso de corrección en el turno abierto.';
    end if;
  end if;
  perform set_config('comerz.motivo_anulacion', btrim(p_motivo), true);
  delete from public.egresos where id = v_egreso.id and negocio_id = v_negocio;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'EGRESO_NO_ANULADO'; end if;
  return jsonb_build_object('egreso_id', v_egreso.id, 'monto', v_egreso.monto, 'tipo', v_egreso.tipo, 'cuenta_origen_id', v_egreso.cuenta_origen_id, 'turno_caja_id', v_egreso.turno_caja_id);
end; $$;


ALTER FUNCTION "public"."anular_egreso"("p_egreso_id" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."anular_egreso"("p_egreso_id" "uuid", "p_motivo" "text") IS 'Borra el egreso; la bitácora conserva el snapshot (ELIMINACION_REVERSA, fechada en el egreso, con motivo). Exige turno abierto si la cuenta es arqueada. No anula reintegros de venta (tipo DEVOLUCION). Permiso caja.anular_movimiento.';



CREATE OR REPLACE FUNCTION "public"."anular_ingreso_financiero"("p_ingreso_id" "uuid", "p_motivo" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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

  -- Reversa fechada en el ingreso; `registrado_en` conserva cuándo se anuló.
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


ALTER FUNCTION "public"."anular_ingreso_financiero"("p_ingreso_id" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."anular_ingreso_financiero"("p_ingreso_id" "uuid", "p_motivo" "text") IS 'Marca el ingreso anulado y escribe la reversa en el ledger (ANULACION, fechada en el ingreso). Turno ABIERTO si la cuenta es arqueada. Permiso caja.anular_movimiento.';



CREATE OR REPLACE FUNCTION "public"."anular_venta"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid" DEFAULT NULL::"uuid", "p_motivo_codigo" "text" DEFAULT NULL::"text", "p_motivo_detalle" "text" DEFAULT NULL::"text", "p_reintegro_metodo_id" "uuid" DEFAULT NULL::"uuid", "p_reintegro_a_cuenta" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_cliente uuid;
  v_pendiente numeric;
  v_efectivo numeric;
  v_otros numeric;
  v_recargo numeric;
  v_saldo numeric;
  v_credito numeric := 0;
  v_excedente numeric := 0;
  v_ticket text := upper(split_part(p_venta_id::text, '-', 1));
  v_rein_id uuid;
  v_rein_tipo text;
  v_rein_nombre text;
  v_egreso numeric := 0;
  v_por_fuera numeric := 0;
  v_favor numeric := 0;
  v_a_cuenta numeric := 0;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  select r.metodo_id, r.metodo_tipo, r.metodo_nombre
    into v_rein_id, v_rein_tipo, v_rein_nombre
    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;

  -- Reintegro A CUENTA (20260928240000): lo cobrado no sale en plata, queda
  -- como saldo a favor. No pide ventas.elegir_medio_devolucion: no saca plata
  -- del cajón.
  if p_reintegro_a_cuenta then
    if p_reintegro_metodo_id is not null then
      raise exception 'REINTEGRO_AMBIGUO';
    end if;
    v_rein_id := null;
    v_rein_tipo := 'SALDO_A_FAVOR';
    v_rein_nombre := 'A cuenta del cliente';
  end if;

  update public.ventas
     set estado_operacion   = 'ANULADA',
         estado_pago        = 'ANULADA',
         motivo_anulacion   = p_motivo,
         destino_mercaderia = p_motivo,
         motivo_codigo      = p_motivo_codigo,
         motivo_detalle     = nullif(btrim(coalesce(p_motivo_detalle, '')), ''),
         anulada_por        = auth.uid(),
         anulada_en         = now(),
         reintegro_metodo_id     = v_rein_id,
         reintegro_metodo_tipo   = v_rein_tipo,
         reintegro_metodo_nombre = v_rein_nombre
   where id = p_venta_id
     and estado_operacion <> 'ANULADA'
  returning cliente_id, coalesce(monto_pendiente, 0), coalesce(saldo_a_favor_aplicado, 0)
       into v_cliente, v_pendiente, v_favor;

  if not found then
    raise exception 'VENTA_NO_ANULABLE';
  end if;

  if v_rein_tipo = 'SALDO_A_FAVOR' and v_cliente is null then
    raise exception 'A_CUENTA_SIN_CLIENTE';
  end if;

  select
    coalesce(sum(monto_base) filter (where metodo_tipo = 'EFECTIVO'), 0),
    coalesce(sum(monto_base) filter (where metodo_tipo <> 'EFECTIVO'), 0),
    coalesce(sum(recargo_monto), 0)
    into v_efectivo, v_otros, v_recargo
  from public.venta_pagos
  where venta_id = p_venta_id;

  -- SIEMPRE. 'ANULADO' significa "no fue venta" y nada mas; el flujo de dinero
  -- no lo mira.
  update public.venta_pagos
     set estado_pago_operacion = 'ANULADO'
   where venta_id = p_venta_id;

  if v_rein_tipo = 'SALDO_A_FAVOR' then
    -- A cuenta: no sale plata del cajón ni del banco; lo cobrado (sin el
    -- recargo por método, que no se devuelve) queda a favor del cliente.
    v_egreso    := 0;
    v_por_fuera := 0;
    v_a_cuenta  := v_efectivo + v_otros;
  elsif v_rein_id is null then
    v_egreso    := v_efectivo;
    v_por_fuera := v_otros;
  elsif v_rein_tipo = 'EFECTIVO' then
    v_egreso    := v_efectivo + v_otros;
    v_por_fuera := 0;
  else
    v_egreso    := 0;
    v_por_fuera := v_efectivo + v_otros;
  end if;

  if v_egreso > 0 then
    insert into public.egresos (negocio_id, concepto, monto, creado_por, turno_caja_id, tipo)
    values (
      v_negocio,
      'Devolucion en efectivo - Venta #' || v_ticket,
      round(v_egreso)::int,
      auth.uid(),
      p_turno_id,
      'DEVOLUCION'
    );
  end if;

  if v_cliente is not null and v_pendiente > 0 then
    select coalesce(saldo_pendiente, 0) into v_saldo
      from public.clientes
     where id = v_cliente
       for update;

    if found then
      -- La deuda ENTERA de la venta: si el cliente ya había pagado parte, el
      -- saldo queda negativo y eso es su saldo a favor. `v_excedente` dice
      -- cuánto quedó a favor por esta anulación.
      v_credito := v_pendiente;
      v_excedente := greatest(0, v_pendiente - greatest(v_saldo, 0));

      if v_credito > 0 then
        insert into public.cuenta_corriente_movimientos (
          negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por
        )
        values (
          v_negocio, v_cliente, p_venta_id, 'CREDITO', v_credito,
          'Anulacion de Venta #' || v_ticket, auth.uid()
        );

        update public.clientes
           set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_credito,
               fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)
         where id = v_cliente;
      end if;
    end if;
  end if;

  -- El saldo a favor que usó la venta vuelve a la cuenta, siempre: no salió
  -- de ninguna caja, así que no tiene medio de reintegro.
  if v_favor > 0 then
    if v_cliente is null then
      raise exception 'SALDO_A_FAVOR_SIN_CLIENTE';
    end if;
    insert into public.cuenta_corriente_movimientos (
      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
      es_saldo_a_favor
    ) values (
      v_negocio, v_cliente, p_venta_id, 'CREDITO', v_favor,
      'Anulacion de Venta #' || v_ticket || ': vuelve el saldo a favor usado',
      auth.uid(), true
    );
    update public.clientes
       set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_favor,
           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)
     where id = v_cliente;
  end if;

  if v_a_cuenta > 0 then
    insert into public.cuenta_corriente_movimientos (
      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
      es_saldo_a_favor
    ) values (
      v_negocio, v_cliente, p_venta_id, 'CREDITO', v_a_cuenta,
      'Anulacion de Venta #' || v_ticket || ': reintegro a cuenta',
      auth.uid(), true
    );
    update public.clientes
       set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_a_cuenta,
           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)
     where id = v_cliente;
  end if;

  return jsonb_build_object(
    'efectivo_devuelto', v_egreso,
    'no_efectivo_a_devolver', v_por_fuera,
    'recargo_no_devuelto', v_recargo,
    'credito_aplicado', v_credito,
    'excedente_ya_pagado', v_excedente,
    'cliente_id', v_cliente,
    'reintegro_metodo_tipo', v_rein_tipo,
    'reintegro_metodo_nombre', v_rein_nombre,
    'saldo_a_favor_devuelto', v_favor,
    'a_cuenta', v_a_cuenta
  );
end;
$$;


ALTER FUNCTION "public"."anular_venta"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."anular_venta_facturada"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_comprobante" "jsonb", "p_reintegro_metodo_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_resultado jsonb;
  v_id        uuid;
  v_factura   uuid;
begin
  if p_comprobante is null
     or p_comprobante->>'tipo' not like 'NOTA_CREDITO%'
     or nullif(p_comprobante->>'cae', '') is null then
    raise exception 'NOTA_CREDITO_REQUERIDA';
  end if;

  v_factura := (p_comprobante->>'anula_comprobante_id')::uuid;

  if not exists (
    select 1 from public.comprobantes c
     where c.id = v_factura
       and c.venta_id = p_venta_id
       and c.tipo like 'FACTURA%'
  ) then
    raise exception 'FACTURA_NO_CORRESPONDE';
  end if;

  v_resultado := public.anular_venta(
    p_venta_id, p_motivo, p_turno_id, p_motivo_codigo, p_motivo_detalle,
    p_reintegro_metodo_id
  );

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    receptor_doc_tipo, receptor_doc_nro,
    neto, iva_monto, exento, no_gravado, total,
    cae, cae_vencimiento, fecha_comprobante,
    arca_ambiente, arca_resultado, arca_observaciones,
    anula_comprobante_id, emitido_por
  )
  select
    p_venta_id,
    p_comprobante->>'tipo',
    (p_comprobante->>'punto_venta')::integer,
    (p_comprobante->>'numero')::bigint,
    f.cliente_id, f.receptor_razon_social, f.receptor_cuit, f.receptor_condicion_iva,
    f.receptor_doc_tipo, f.receptor_doc_nro,
    (p_comprobante->>'neto')::numeric,
    (p_comprobante->>'iva_monto')::numeric,
    coalesce((p_comprobante->>'exento')::numeric, 0),
    coalesce((p_comprobante->>'no_gravado')::numeric, 0),
    (p_comprobante->>'total')::numeric,
    p_comprobante->>'cae',
    (p_comprobante->>'cae_vencimiento')::date,
    (p_comprobante->>'fecha_comprobante')::date,
    p_comprobante->>'arca_ambiente',
    p_comprobante->>'arca_resultado',
    p_comprobante->'arca_observaciones',
    v_factura,
    (p_comprobante->>'emitido_por')::uuid
  from public.comprobantes f
  where f.id = v_factura
  returning id into v_id;

  insert into public.comprobantes_iva (comprobante_id, alicuota_id, base_imponible, importe)
  select v_id,
         (x->>'id')::integer,
         (x->>'base_imponible')::numeric,
         (x->>'importe')::numeric
    from jsonb_array_elements(coalesce(p_comprobante->'iva', '[]'::jsonb)) as x;

  return v_resultado || jsonb_build_object('nota_credito_id', v_id);
end;
$$;


ALTER FUNCTION "public"."anular_venta_facturada"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_comprobante" "jsonb", "p_reintegro_metodo_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aprobar_orden_compra"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  perform public.marcar_origen_movimiento('REMITO', p_orden_id);
  return public.aprobar_orden_compra_impl(p_orden_id, p_proveedor, p_items);
end;
$$;


ALTER FUNCTION "public"."aprobar_orden_compra"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."aprobar_orden_compra_impl"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_item jsonb;
  v_producto_id uuid;
  v_item_id uuid;
  v_raw_nombre text;
  v_estado_match text;
  v_variante text;
  v_atributos jsonb;
  v_sku text;
  v_imei text;
  v_cantidad numeric(12,3);
  v_precio_costo numeric;
  v_precio_venta numeric;
  v_precio_base numeric;
  v_difiere_precio boolean;
  v_alias_key text;
  v_negocio_id uuid;

  v_variante_id uuid;
  v_nombre_variante text;
  v_identidad text;
  v_stock_id uuid;
  v_estado_actual text;
  v_colisiones text;
  v_impactables integer;
  v_sin_producto integer;

  v_productos_actualizados uuid[] := '{}';
  v_alias_registrados text[] := '{}';
  v_precio_base_por_producto jsonb := '{}'::jsonb;

  v_lote_id uuid;
  v_precio_viejo numeric;
  v_costo_viejo numeric;
  v_precio_efectivo numeric;
  v_costo_efectivo numeric;
  v_precio_final numeric;
  v_costo_final numeric;
  v_filas integer;
  v_productos_reprecio integer := 0;
  v_variantes_alineadas integer := 0;
  v_variantes_conservadas integer := 0;

  v_lineas integer := 0;
  v_variantes_creadas integer := 0;
  v_imeis_creados integer := 0;
begin
  -- GUARD DE FUSION: va primero, antes de cualquier escritura.
  with lineas as (
    select
      nullif(it->>'producto_id', '')::uuid as producto_id,
      lower(trim(coalesce(nullif(it->>'raw_nombre', ''), '(sin nombre)'))) as raw_nombre,
      coalesce(
        nullif(public.atributos_comparables(coalesce(it->'atributos', '{}'::jsonb)), ''),
        'display:' || lower(trim(coalesce(nullif(it->>'variante', ''), 'Unico')))
      ) as identidad
    from jsonb_array_elements(p_items) as it
    where nullif(it->>'producto_id', '') is not null
  ),
  choques as (
    select
      l.producto_id,
      l.identidad,
      string_agg(distinct l.raw_nombre, ' + ' order by l.raw_nombre) as nombres
    from lineas l
    group by l.producto_id, l.identidad
    having count(distinct l.raw_nombre) > 1
  )
  select string_agg(
           coalesce(p.nombre, c.producto_id::text) || ' (' || c.nombres || ')',
           '; '
         )
    into v_colisiones
  from choques c
  left join productos p on p.id = c.producto_id;

  if v_colisiones is not null then
    raise exception
      'REMITO_VARIANTE_COLISION: hay renglones de productos distintos que caen en la misma variante: %',
      v_colisiones
      using errcode = 'P0001';
  end if;

  -- GUARD DE APROBACION EN VACIO.
  select count(*)
    into v_impactables
  from jsonb_array_elements(p_items) as it
  where nullif(it->>'producto_id', '') is not null;

  if v_impactables = 0 then
    raise exception
      'REMITO_SIN_LINEAS_IMPACTABLES: ninguna linea del remito esta vinculada a un producto, no hay nada que impactar'
      using errcode = 'P0001';
  end if;

  select count(*)
    into v_sin_producto
  from ordenes_items oi
  where oi.orden_id = p_orden_id
    and oi.producto_id is null
    and not exists (
      select 1
      from jsonb_array_elements(p_items) as it
      where nullif(it->>'item_id', '')::uuid = oi.id
        and nullif(it->>'producto_id', '') is not null
    );

  if v_sin_producto > 0 then
    raise exception
      'REMITO_LINEAS_SIN_PRODUCTO: % renglon(es) del remito no estan vinculados a ningun producto; se perderian al aprobar',
      v_sin_producto
      using errcode = 'P0001';
  end if;

  update ordenes_compra
  set estado = 'APROBADA'
  where id = p_orden_id
    and estado <> 'APROBADA'
  returning negocio_id into v_negocio_id;

  if not found then
    select estado into v_estado_actual
    from ordenes_compra
    where id = p_orden_id;

    if v_estado_actual is null then
      raise exception 'Orden % no encontrada o sin permiso para aprobarla', p_orden_id;
    end if;

    return jsonb_build_object(
      'ya_aprobada', true,
      'lineas_impactadas', 0,
      'productos_actualizados', 0,
      'variantes_creadas', 0,
      'alias_registrados', 0,
      'imeis_creados', 0,
      'productos_reprecio', 0,
      'variantes_alineadas', 0,
      'variantes_conservadas', 0
    );
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := nullif(v_item->>'producto_id', '')::uuid;
    if v_producto_id is null then
      continue;
    end if;

    v_item_id      := nullif(v_item->>'item_id', '')::uuid;
    v_raw_nombre   := coalesce(v_item->>'raw_nombre', '');
    v_estado_match := v_item->>'estado_match';
    v_variante     := coalesce(nullif(v_item->>'variante', ''), 'Unico');
    v_atributos    := coalesce(v_item->'atributos', '{}'::jsonb);
    v_sku          := nullif(trim(coalesce(v_item->>'sku', '')), '');
    v_imei         := nullif(trim(coalesce(v_item->>'imei', '')), '');
    v_cantidad     := coalesce((v_item->>'cantidad')::numeric, 0);
    v_precio_costo := nullif(v_item->>'precio_costo', '')::numeric;
    v_precio_venta := nullif(v_item->>'precio_venta_actualizado', '')::numeric;

    if v_item_id is not null then
      update ordenes_items
      set producto_id = v_producto_id,
          variante_match = v_variante
      where id = v_item_id;
    end if;

    if not (v_producto_id = any (v_productos_actualizados)) then
      if coalesce(v_precio_costo, 0) <> 0 or coalesce(v_precio_venta, 0) <> 0 then
        -- El precio viejo se lee DOS veces: el de cabecera (lo que hay que
        -- auditar) y el EFECTIVO (lo que se estaba cobrando). En 30 productos
        -- no son el mismo numero. Misma expresion que la vista
        -- productos_precio_efectivo, 20260908180000.
        select
          p.precio,
          p.precio_costo,
          case
            when v.total > 0 and v.con_precio = v.total and v.precios_distintos = 1
              then v.precio_unico
            else p.precio
          end,
          case
            when v.total > 0 and v.con_costo = v.total and v.costos_distintos = 1
              then v.costo_unico
            else p.precio_costo
          end
          into v_precio_viejo, v_costo_viejo, v_precio_efectivo, v_costo_efectivo
        from productos p
        left join lateral (
          select
            count(*)                  as total,
            count(pv.precio)          as con_precio,
            count(distinct pv.precio) as precios_distintos,
            min(pv.precio)            as precio_unico,
            count(pv.costo)           as con_costo,
            count(distinct pv.costo)  as costos_distintos,
            min(pv.costo)             as costo_unico
          from producto_variantes pv
          where pv.producto_id = p.id
        ) v on true
        where p.id = v_producto_id;

        v_precio_final := case
          when coalesce(v_precio_venta, 0) <> 0 then v_precio_venta
          else v_precio_viejo
        end;
        v_costo_final := case
          when coalesce(v_precio_costo, 0) <> 0 then v_precio_costo
          else v_costo_viejo
        end;

        update productos
        set precio_costo = v_costo_final,
            precio = v_precio_final
        where id = v_producto_id;

        if v_precio_final is distinct from v_precio_viejo
           or v_costo_final is distinct from v_costo_viejo
        then
          -- Lote perezoso: un remito que no mueve ningun precio no deja fila.
          if v_lote_id is null then
            insert into actualizaciones_precio (
              negocio_id, nombre, tipo_alcance, tipo_operacion,
              campo_objetivo, valor, redondeo, cantidad_afectada, creado_por
            )
            values (
              coalesce(v_negocio_id, security.current_negocio_id()),
              'Ingreso de mercaderia - ' || coalesce(nullif(trim(p_proveedor), ''), 'sin proveedor'),
              'REMITO', 'REMITO', 'AMBOS', 0, 'SIN_REDONDEO', 0, auth.uid()
            )
            returning id into v_lote_id;
          end if;

          insert into actualizaciones_precio_items (
            negocio_id, lote_id, producto_id, variante_id,
            costo_anterior, costo_nuevo, precio_anterior, precio_nuevo
          )
          values (
            coalesce(v_negocio_id, security.current_negocio_id()),
            v_lote_id, v_producto_id, null,
            v_costo_viejo, v_costo_final,
            v_precio_viejo, v_precio_final
          );

          v_productos_reprecio := v_productos_reprecio + 1;

          -- La auditoria de las variantes va ANTES del update: despues, el
          -- valor anterior ya no esta en ningun lado.
          insert into actualizaciones_precio_items (
            negocio_id, lote_id, producto_id, variante_id,
            costo_anterior, costo_nuevo, precio_anterior, precio_nuevo
          )
          select
            coalesce(v_negocio_id, security.current_negocio_id()),
            v_lote_id, v_producto_id, pv.id,
            pv.costo,
            case when pv.costo = v_costo_efectivo then v_costo_final else pv.costo end,
            pv.precio,
            case when pv.precio = v_precio_efectivo then v_precio_final else pv.precio end
          from producto_variantes pv
          where pv.producto_id = v_producto_id
            and (
              (pv.precio = v_precio_efectivo and pv.precio is distinct from v_precio_final)
              or (pv.costo = v_costo_efectivo and pv.costo is distinct from v_costo_final)
            );

          -- Solo la variante cuyo precio propio era una COPIA del que se
          -- cobraba. La que decia otra cosa es un precio especial y se
          -- respeta. `pv.precio = v_precio_efectivo` ya descarta los NULL:
          -- esos heredan de la cabecera y no hay nada que mover.
          update producto_variantes pv
          set precio = case
                when pv.precio = v_precio_efectivo then v_precio_final
                else pv.precio
              end,
              costo = case
                when pv.costo = v_costo_efectivo then v_costo_final
                else pv.costo
              end,
              updated_at = now()
          where pv.producto_id = v_producto_id
            and (
              (pv.precio = v_precio_efectivo and pv.precio is distinct from v_precio_final)
              or (pv.costo = v_costo_efectivo and pv.costo is distinct from v_costo_final)
            );

          get diagnostics v_filas = row_count;
          v_variantes_alineadas := v_variantes_alineadas + v_filas;

          select count(*)
            into v_filas
          from producto_variantes pv
          where pv.producto_id = v_producto_id
            and pv.precio is not null
            and pv.precio is distinct from v_precio_final;

          v_variantes_conservadas := v_variantes_conservadas + v_filas;
        end if;
      end if;

      v_productos_actualizados := v_productos_actualizados || v_producto_id;
      v_precio_base_por_producto := v_precio_base_por_producto
        || jsonb_build_object(v_producto_id::text, coalesce(v_precio_venta, 0));
    end if;

    v_precio_base := coalesce(
      (v_precio_base_por_producto->>v_producto_id::text)::numeric,
      0
    );

    -- IDENTIDAD DE LA VARIANTE: misma expresion que idx_variante_identidad.
    v_identidad := public.atributos_comparables(v_atributos);
    v_variante_id := null;
    v_nombre_variante := null;

    if v_identidad = '' then
      select id, nombre_display into v_variante_id, v_nombre_variante
      from producto_variantes
      where producto_id = v_producto_id
        and nombre_display = v_variante
      limit 1;
    else
      select id, nombre_display into v_variante_id, v_nombre_variante
      from producto_variantes
      where producto_id = v_producto_id
        and public.atributos_comparables(atributos) = v_identidad
      limit 1;

      if v_variante_id is null then
        select id, nombre_display into v_variante_id, v_nombre_variante
        from producto_variantes
        where producto_id = v_producto_id
          and nombre_display = v_variante
          and public.atributos_comparables(atributos) = ''
        limit 1;
      end if;
    end if;

    if v_variante_id is not null then
      update producto_variantes
      set
        stock = stock + v_cantidad,
        atributos = case
          when v_atributos = '{}'::jsonb then producto_variantes.atributos
          else v_atributos
        end,
        sku = coalesce(v_sku, sku),
        updated_at = now()
      where id = v_variante_id;
    else
      v_difiere_precio := coalesce(v_precio_venta, 0) is distinct from v_precio_base;

      insert into producto_variantes (
        producto_id, nombre_display, atributos, sku, precio, costo, stock
      )
      values (
        v_producto_id,
        v_variante,
        v_atributos,
        v_sku,
        case when v_difiere_precio then v_precio_venta else null end,
        case when v_difiere_precio then v_precio_costo else null end,
        v_cantidad
      )
      returning id into v_variante_id;

      v_nombre_variante := v_variante;
      v_variantes_creadas := v_variantes_creadas + 1;
    end if;

    if v_imei is not null and v_variante_id is not null then
      insert into unidades_serie (negocio_id, producto_variante_id, imei, estado)
      values (
        coalesce(v_negocio_id, security.current_negocio_id()),
        v_variante_id,
        v_imei,
        'disponible'
      )
      on conflict (negocio_id, imei) do nothing;

      if found then
        v_imeis_creados := v_imeis_creados + 1;
      end if;
    end if;

    v_nombre_variante := coalesce(v_nombre_variante, v_variante);

    select id into v_stock_id
    from productos_stock
    where producto_id = v_producto_id
      and variante = v_nombre_variante
    limit 1;

    if v_stock_id is not null then
      update productos_stock
      set cantidad = cantidad + v_cantidad
      where id = v_stock_id;
    else
      insert into productos_stock (producto_id, variante, cantidad)
      values (v_producto_id, v_nombre_variante, v_cantidad);
    end if;

    if v_estado_match in ('DESCONOCIDO', 'NUEVO_ALIAS') then
      v_alias_key := lower(trim(v_raw_nombre));
      if not (v_alias_key = any (v_alias_registrados)) then
        insert into diccionario_alias (proveedor, raw_nombre, producto_id)
        values (p_proveedor, v_alias_key, v_producto_id)
        on conflict (negocio_id, proveedor, raw_nombre)
        do update set producto_id = excluded.producto_id;

        v_alias_registrados := v_alias_registrados || v_alias_key;
      end if;
    end if;

    v_lineas := v_lineas + 1;
  end loop;

  if v_lote_id is not null then
    update actualizaciones_precio
    set cantidad_afectada = v_productos_reprecio
    where id = v_lote_id;
  end if;

  return jsonb_build_object(
    'ya_aprobada', false,
    'lineas_impactadas', v_lineas,
    'productos_actualizados', coalesce(array_length(v_productos_actualizados, 1), 0),
    'variantes_creadas', v_variantes_creadas,
    'alias_registrados', coalesce(array_length(v_alias_registrados, 1), 0),
    'imeis_creados', v_imeis_creados,
    'productos_reprecio', v_productos_reprecio,
    'variantes_alineadas', v_variantes_alineadas,
    'variantes_conservadas', v_variantes_conservadas
  );
end;
$$;


ALTER FUNCTION "public"."aprobar_orden_compra_impl"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."aprobar_orden_compra_impl"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") IS 'Impacta un remito: precios, stock, variantes, IMEI y alias, en una transaccion. Desde 20260908190000 tambien alinea el precio propio de las variantes que era copia del vigente, y audita el cambio en actualizaciones_precio(_items) con tipo_operacion REMITO.';



CREATE OR REPLACE FUNCTION "public"."asignar_cuenta_financiera_actual"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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
      -- turno, del cajón, como siempre.
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


ALTER FUNCTION "public"."asignar_cuenta_financiera_actual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."atributos_comparables"("p_atributos" "jsonb") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(
    string_agg(
      translate(lower(clave), 'áéíóúüñ', 'aeiouun')
        || '=' ||
        translate(lower(valor), 'áéíóúüñ', 'aeiouun'),
      '|' order by translate(lower(clave), 'áéíóúüñ', 'aeiouun')
    ),
    ''
  )
  from jsonb_each_text(coalesce(p_atributos, '{}'::jsonb)) as t(clave, valor)
$$;


ALTER FUNCTION "public"."atributos_comparables"("p_atributos" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."atributos_comparables"("p_atributos" "jsonb") IS 'Clave normalizada de un conjunto de atributos de variante, para comparar "COLOR: NEGRO" con "Color: Negro" como lo mismo. La igualdad JSONB directa es byte a byte y hacía que un cambio de mayúsculas borrara y recreara la variante, perdiéndole el stock.';



CREATE OR REPLACE FUNCTION "public"."bloquear_edicion_turno_cerrado"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF OLD.estado = 'CERRADO' THEN
    RAISE EXCEPTION 'No se puede modificar un turno de caja ya cerrado (id: %).', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bloquear_edicion_turno_cerrado"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calcular_egresos_turno"("p_turno_id" "uuid") RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$ select coalesce(sum(e.monto),0) from public.turnos_caja t left join public.egresos e on e.turno_caja_id=t.id and e.negocio_id=t.negocio_id and e.cuenta_origen_id=t.cuenta_financiera_id where t.id=p_turno_id and t.negocio_id=security.current_negocio_id(); $$;


ALTER FUNCTION "public"."calcular_egresos_turno"("p_turno_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cambiar_slug_negocio"("p_slug" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_negocio uuid;
  v_slug    text;
begin
  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.is_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  v_slug := lower(btrim(coalesce(p_slug, '')));

  if v_slug !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
     or char_length(v_slug) < 3
     or char_length(v_slug) > 30 then
    raise exception 'SLUG_INVALIDO';
  end if;

  if v_slug = any (array[
    'app','www','admin','api','mail','status','support','help',
    'blog','docs','cdn','static','assets','auth','login'
  ]) then
    raise exception 'SLUG_RESERVADO';
  end if;

  if exists (select 1 from public.negocios where id = v_negocio and slug = v_slug) then
    return v_slug;
  end if;

  update public.negocios set slug = v_slug where id = v_negocio;

  if not found then
    raise exception 'NEGOCIO_NO_ENCONTRADO';
  end if;

  return v_slug;
exception
  when unique_violation then
    raise exception 'SLUG_OCUPADO';
end;
$_$;


ALTER FUNCTION "public"."cambiar_slug_negocio"("p_slug" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cambiar_slug_negocio"("p_slug" "text") IS 'Cambia la direccion web del negocio ACTIVO (la del catalogo publico). Solo ADMIN. No recibe negocio_id a proposito: sale de security.current_negocio_id().';



CREATE OR REPLACE FUNCTION "public"."cantidad_base"("p_cantidad" numeric, "p_factor" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select round(coalesce(p_cantidad, 0) * coalesce(p_factor, 1), 3);
$$;


ALTER FUNCTION "public"."cantidad_base"("p_cantidad" numeric, "p_factor" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cantidad_base"("p_cantidad" numeric, "p_factor" numeric) IS 'cantidad_stock = cantidad_presentacion × factor, redondeada a la resolución del stock (3 decimales). Es la ÚNICA cuenta que convierte presentaciones a unidad base del lado SQL.';



CREATE OR REPLACE FUNCTION "public"."categoria_en_temporada"("p_temporada" "text", "p_fecha" "date" DEFAULT NULL::"date") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select case coalesce(p_temporada, 'TODO_EL_ANIO')
    when 'VERANO'         then extract(month from f.d) in (10, 11, 12, 1, 2, 3)
    when 'INVIERNO'       then extract(month from f.d) in (4, 5, 6, 7, 8, 9)
    when 'MEDIA_ESTACION' then extract(month from f.d) in (3, 4, 5, 9, 10, 11)
    else true
  end
  from (select coalesce(p_fecha, (now() at time zone 'America/Argentina/Buenos_Aires')::date) as d) f;
$$;


ALTER FUNCTION "public"."categoria_en_temporada"("p_temporada" "text", "p_fecha" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."categoria_en_temporada"("p_temporada" "text", "p_fecha" "date") IS 'Si esa temporada se vende en esa fecha (hemisferio sur, ventanas de VENTA no meteorologicas). Ante cualquier valor inesperado devuelve true: no silenciar es el lado seguro. Espejo de shared/lib/temporada-categoria.ts.';



CREATE OR REPLACE FUNCTION "public"."cerrar_sesiones_usuario"("p_usuario_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_filas integer;
begin
  delete from auth.refresh_tokens where user_id = p_usuario_id::text;
  delete from auth.sessions where user_id = p_usuario_id;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;


ALTER FUNCTION "public"."cerrar_sesiones_usuario"("p_usuario_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ciclo_de_vida_negocios"() RETURNS TABLE("negocio_id" "uuid", "nombre" "text", "estado" "text", "creado" timestamp with time zone, "plan_vencimiento" timestamp with time zone, "plan_nombre" "text", "plan_precio" numeric, "plan_link" "text", "duenio_id" "uuid", "duenio_email" "text", "productos" integer, "ventas" integer, "ultima_venta" timestamp with time zone, "pagos" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security'
    AS $$
  select
    n.id as negocio_id,
    n.nombre::text,
    n.estado::text,
    n.created_at as creado,
    n.plan_vencimiento,
    p.nombre::text as plan_nombre,
    p.precio_mensual as plan_precio,
    p.link_suscripcion::text as plan_link,
    d.usuario_id as duenio_id,
    d.email::text as duenio_email,
    (select count(*)::int from public.productos pr where pr.negocio_id = n.id) as productos,
    (select count(*)::int from public.ventas v where v.negocio_id = n.id) as ventas,
    (select max(v.fecha_venta) from public.ventas v where v.negocio_id = n.id) as ultima_venta,
    (select count(*)::int from public.pagos_suscripcion ps where ps.negocio_id = n.id) as pagos
  from public.negocios n
  left join public.planes p on p.id = n.plan_id
  left join lateral (
    select un.usuario_id, pe.email
    from public.usuarios_negocios un
    join public.perfiles pe on pe.id = un.usuario_id
    where un.negocio_id = n.id and un.es_owner
    order by un.created_at asc
    limit 1
  ) d on true
  where security.is_super_admin();
$$;


ALTER FUNCTION "public"."ciclo_de_vida_negocios"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ciclo_de_vida_negocios"() IS 'Hechos del ciclo de vida de cada comercio (vencimiento, uso, dueno, link de pago del plan) para decidir que mail le toca. SECURITY DEFINER: el where is_super_admin() es lo unico que la protege. Ver 20260910130000 y 20260910140000.';



CREATE OR REPLACE FUNCTION "public"."cobrar_pedido"("p_pedido_id" "uuid", "p_venta_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_filas integer;
begin
  update public.pedidos
     set estado = 'COBRADO',
         venta_id = p_venta_id,
         cobrado_por = auth.uid(),
         actualizado_en = now()
   where id = p_pedido_id
     and estado = 'POR_COBRAR';
  get diagnostics v_filas = row_count;
  return v_filas = 1;
end;
$$;


ALTER FUNCTION "public"."cobrar_pedido"("p_pedido_id" "uuid", "p_venta_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."comercios_con_uso"() RETURNS TABLE("id" "uuid", "nombre" "text", "slug" "text", "estado" "text", "duenio" "text", "plan_id" "uuid", "plan_nombre" "text", "plan_precio" numeric, "plan_vencimiento" timestamp with time zone, "usuarios" bigint, "clientes_cc" bigint, "productos" bigint, "max_usuarios" integer, "max_clientes_cc" integer, "max_productos" integer, "rubro" "text", "ventas_7d" bigint, "monto_7d" numeric, "email_confirmado_en" timestamp with time zone, "ultimo_ingreso" timestamp with time zone, "ultima_actividad" timestamp with time zone, "whatsapp" "text", "activacion" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
  with owner as (
    select un.negocio_id, un.usuario_id
    from public.usuarios_negocios un
    where un.es_owner
  )
  select
    n.id,
    n.nombre,
    n.slug,
    n.estado,
    (select p.email from owner o join public.perfiles p on p.id = o.usuario_id
      where o.negocio_id = n.id limit 1) as duenio,
    n.plan_id,
    pl.nombre as plan_nombre,
    coalesce(pl.precio_mensual, 0) as plan_precio,
    n.plan_vencimiento,
    (select count(*) from public.usuarios_negocios u where u.negocio_id = n.id),
    (select count(*) from public.clientes c
      where c.negocio_id = n.id and c.saldo_pendiente > 0),
    (select count(*) from public.productos pr where pr.negocio_id = n.id),
    nullif(public.reglas_negocio(n.id) ->> 'max_usuarios', 'null')::int,
    nullif(public.reglas_negocio(n.id) ->> 'max_clientes_cuenta_corriente', 'null')::int,
    nullif(public.reglas_negocio(n.id) ->> 'max_productos', 'null')::int,
    (select c.rubro from public.configuracion_pos c where c.negocio_id = n.id limit 1) as rubro,
    (select count(*) from public.ventas v
      where v.negocio_id = n.id
        and v.estado_operacion <> 'ANULADA'
        and v.fecha_venta >= now() - interval '7 days') as ventas_7d,
    (select coalesce(sum(v.total), 0) from public.ventas v
      where v.negocio_id = n.id
        and v.estado_operacion <> 'ANULADA'
        and v.fecha_venta >= now() - interval '7 days') as monto_7d,
    (select u.email_confirmed_at from owner o
      join auth.users u on u.id = o.usuario_id
      where o.negocio_id = n.id limit 1) as email_confirmado_en,
    (select u.last_sign_in_at from owner o
      join auth.users u on u.id = o.usuario_id
      where o.negocio_id = n.id limit 1) as ultimo_ingreso,
    greatest(
      (select u.last_sign_in_at from owner o
        join auth.users u on u.id = o.usuario_id
        where o.negocio_id = n.id limit 1),
      (select max(s.updated_at) from owner o
        join auth.sessions s on s.user_id = o.usuario_id
        where o.negocio_id = n.id)
    ) as ultima_actividad,
    (select c.whatsapp from public.configuracion_pos c
      where c.negocio_id = n.id limit 1) as whatsapp,
    public.estado_activacion_de(n.id) as activacion
  from public.negocios n
  left join public.planes pl on pl.id = n.plan_id
  where security.is_super_admin()
  order by n.created_at;
$$;


ALTER FUNCTION "public"."comercios_con_uso"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."comercios_con_uso"() IS 'La tabla del panel de Comerz: uso contra limites, actividad, acceso del dueno (confirmacion de mail, ultimo ingreso y ultima actividad) y estado de onboarding. Solo super admin.';



CREATE OR REPLACE FUNCTION "public"."composicion_ticket"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_desde   date;
  v_hasta   date;
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenes permiso para ver la composicion del ticket'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;

  if p_periodo is not null then
    v_hasta := v_hoy;
    v_desde := case p_periodo
      when 'hoy'    then v_hoy
      when 'semana' then (date_trunc('week',  v_hoy)::date)
      when 'mes'    then (date_trunc('month', v_hoy)::date)
      when 'anio'   then (date_trunc('year',  v_hoy)::date)
      else v_hoy
    end;
  else
    v_hasta := coalesce(p_hasta, v_hoy);
    v_desde := coalesce(p_desde, v_hasta - 29);
  end if;

  with tickets as (
    select
      v.id,
      v.vendedor_id,
      count(i.id)                                         as renglones,
      sum(i.cantidad)                                     as unidades,
      sum(i.precio_final * i.cantidad)                    as ingreso,
      sum((i.precio_final - i.precio_costo) * i.cantidad) as margen,
      min(i.precio_final)                                 as adicional_precio,
      min(i.precio_final - i.precio_costo)                as adicional_margen
    from public.ventas v
    join public.ventas_items i on i.venta_id = v.id
    where v.negocio_id = v_negocio
      and v.estado_operacion is distinct from 'ANULADA'
      and (v.fecha_venta at time zone v_tz)::date between v_desde and v_hasta
    group by v.id, v.vendedor_id
  ),
  tramos as (
    select
      least(renglones, 6) as tramo,
      count(*)            as tickets,
      avg(ingreso)        as ticket_prom,
      avg(margen)         as margen_prom,
      avg(unidades)       as unidades_prom,
      sum(ingreso)        as ingreso_total
    from tickets
    group by least(renglones, 6)
  ),
  totales as (
    select
      count(*)       as tickets,
      avg(renglones) as renglones_prom,
      avg(unidades)  as unidades_prom,
      avg(ingreso)   as ticket_prom,
      avg(margen)    as margen_prom,
      sum(ingreso)   as ingreso_total,
      sum(margen)    as margen_total
    from tickets
  ),
  adicional as (
    select
      count(*)              as tickets_de_dos,
      avg(adicional_precio) as precio_prom,
      avg(adicional_margen) as margen_prom
    from tickets
    where renglones = 2
  ),
  uno as (select * from tramos where tramo = 1),
  dos as (select * from tramos where tramo = 2)
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', p_periodo,
    'generado_en', now(),
    'totales', (
      select jsonb_build_object(
        'tickets', t.tickets,
        'renglones_promedio', round(coalesce(t.renglones_prom, 0), 2),
        'unidades_promedio', round(coalesce(t.unidades_prom, 0), 2),
        'ticket_promedio', round(coalesce(t.ticket_prom, 0), 2),
        'margen_promedio', round(coalesce(t.margen_prom, 0), 2),
        'ingreso_total', round(coalesce(t.ingreso_total, 0), 2),
        'margen_total', round(coalesce(t.margen_total, 0), 2)
      )
      from totales t
    ),
    'distribucion', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'renglones', tramo,
        'es_tramo_abierto', tramo = 6,
        'tickets', tickets,
        'pct_tickets', round(tickets * 100.0 / nullif((select tickets from totales), 0), 2),
        'ticket_promedio', round(ticket_prom, 2),
        'margen_promedio', round(margen_prom, 2),
        'unidades_promedio', round(unidades_prom, 2),
        'ingreso_total', round(ingreso_total, 2)
      ) order by tramo), '[]'::jsonb)
      from tramos
    ),
    'renglon_adicional', (
      select jsonb_build_object(
        'base_tickets_de_dos', a.tickets_de_dos,
        'precio_promedio', round(coalesce(a.precio_prom, 0), 2),
        'margen_promedio', round(coalesce(a.margen_prom, 0), 2),
        'tickets_de_un_renglon', u.tickets,
        'pct_de_un_renglon', round(u.tickets * 100.0 / nullif((select tickets from totales), 0), 2),
        'margen_si_convierte_10pct', round(coalesce(a.margen_prom, 0) * u.tickets * 0.10, 2)
      )
      from adicional a, uno u
    ),
    'brecha_1_a_2', (
      select jsonb_build_object(
        'ticket_promedio_1', round(u.ticket_prom, 2),
        'ticket_promedio_2', round(d.ticket_prom, 2),
        'diferencia_ticket', round(d.ticket_prom - u.ticket_prom, 2),
        'diferencia_margen', round(d.margen_prom - u.margen_prom, 2),
        'es_descriptiva', true,
        'no_usar_para_proyectar', true
      )
      from uno u, dos d
    ),
    'por_vendedora', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'vendedora', vendedora,
        'tickets', tickets,
        'tickets_de_un_renglon', de_uno,
        'pct_multi_item', round((tickets - de_uno) * 100.0 / nullif(tickets, 0), 2),
        'renglones_promedio', round(reng_prom, 2),
        'ticket_promedio', round(ticket_prom, 2)
      ) order by tickets desc), '[]'::jsonb)
      from (
        select
          coalesce(p.nombre, 'Sin identificar')   as vendedora,
          count(*)                                as tickets,
          count(*) filter (where t.renglones = 1) as de_uno,
          avg(t.renglones)                        as reng_prom,
          avg(t.ingreso)                          as ticket_prom
        from tickets t
        left join public.perfiles p on p.id = t.vendedor_id
        group by coalesce(p.nombre, 'Sin identificar')
      ) v
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."composicion_ticket"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."composicion_ticket"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") IS 'Comerz Insights: distribucion de tickets por renglones, valor del renglon adicional y corte por vendedora. renglon_adicional es el numero que se puede prometer (la prenda que se agrega); brecha_1_a_2 es correlacional y NO sirve para proyectar. Gate: caja.ver_gerencial.';



CREATE OR REPLACE FUNCTION "public"."configurar_pedidos_a_caja"("p_activo" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_rol     uuid;
  v_permiso uuid;
  v_clave   text;
  v_filas   integer;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.tiene_permiso('configuracion.empleados_y_permisos') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_activo and not public.tiene_feature('pedidos_a_caja') then
    raise exception 'FEATURE_NO_INCLUIDA';
  end if;

  update public.configuracion_pos
     set pedidos_a_caja = p_activo
   where negocio_id = v_negocio;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'CONFIGURACION_NO_ENCONTRADA';
  end if;

  select id into v_rol
    from public.roles
   where negocio_id = v_negocio and nombre = 'VENDEDOR';

  if v_rol is not null then
    foreach v_clave in array array['ventas.cobrar', 'caja.operar'] loop
      select id into v_permiso from public.permisos where clave = v_clave;
      if v_permiso is null then continue; end if;
      if p_activo then
        delete from public.rol_permisos
         where rol_id = v_rol and permiso_id = v_permiso;
      else
        insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
        values (v_rol, v_permiso, v_negocio)
        on conflict (rol_id, permiso_id) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('pedidos_a_caja', p_activo, 'rol_vendedor', v_rol is not null);
end;
$$;


ALTER FUNCTION "public"."configurar_pedidos_a_caja"("p_activo" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."configurar_pedidos_a_caja"("p_activo" boolean) IS 'Prende/apaga pedidos a caja y, en la misma transaccion, le saca (o devuelve) ventas.cobrar al rol VENDEDOR del negocio. Exige configuracion.empleados_y_permisos y la feature pedidos_a_caja.';



CREATE OR REPLACE FUNCTION "public"."confirmar_egreso_programado"("p_id" "uuid", "p_monto" numeric DEFAULT NULL::numeric, "p_fecha_pago" "date" DEFAULT NULL::"date", "p_cuenta_origen_id" "uuid" DEFAULT NULL::"uuid", "p_turno_caja_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_prog public.egresos_programados;
  v_monto numeric;
  v_cuenta uuid;
  v_egreso uuid;
  v_siguiente date;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;

  select * into v_prog
    from public.egresos_programados
   where id = p_id and negocio_id = v_negocio
   for update;

  if not found then raise exception 'PROGRAMADO_NO_ENCONTRADO'; end if;
  if not v_prog.activo then raise exception 'PROGRAMADO_DADO_DE_BAJA'; end if;

  v_monto := coalesce(p_monto, v_prog.monto);
  if v_monto <= 0 then raise exception 'MONTO_INVALIDO'; end if;

  v_cuenta := coalesce(p_cuenta_origen_id, v_prog.cuenta_origen_id);

  insert into public.egresos (
    concepto, monto, tipo, categoria_id, cuenta_origen_id,
    turno_caja_id, creado_por, fecha
  ) values (
    v_prog.concepto, v_monto, v_prog.tipo, v_prog.categoria_id, v_cuenta,
    p_turno_caja_id, auth.uid(), coalesce(p_fecha_pago, current_date)
  )
  returning id into v_egreso;

  v_siguiente := public.siguiente_fecha_programada(
    greatest(v_prog.proxima_fecha, coalesce(p_fecha_pago, current_date)),
    v_prog.frecuencia,
    v_prog.dia_ancla
  );

  update public.egresos_programados
     set proxima_fecha = coalesce(v_siguiente, proxima_fecha),
         activo = (v_siguiente is not null),
         monto = v_monto
   where id = p_id and negocio_id = v_negocio;

  return v_egreso;
end;
$$;


ALTER FUNCTION "public"."confirmar_egreso_programado"("p_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_cuenta_origen_id" "uuid", "p_turno_caja_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirmar_egreso_programado"("p_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_cuenta_origen_id" "uuid", "p_turno_caja_id" "uuid") IS 'Registra el gasto de un egreso programado y corre su fecha, en una transaccion. SECURITY INVOKER: el insert pasa por la policy de `egresos` y por sus triggers, asi que quien no puede registrar un gasto tampoco puede confirmar uno programado.';



CREATE OR REPLACE FUNCTION "public"."contexto_sesion"() RETURNS TABLE("rol" "text", "es_super_admin" boolean, "negocio_id" "uuid")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    public.rol_actual(),
    security.is_super_admin(),
    security.current_negocio_id();
$$;


ALTER FUNCTION "public"."contexto_sesion"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."contexto_sesion"() IS 'Rol en el negocio activo + si es super admin + negocio activo, en un solo round-trip. Para el middleware, que corre en cada request. No amplia permisos: compone rol_actual() e is_super_admin(), que ya eran publicas para authenticated.';



CREATE OR REPLACE FUNCTION "public"."corregir_metodo_pago_cobro_cc"("p_pago_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $_$
declare
  v_negocio       uuid := security.current_negocio_id();
  v_usuario       uuid := auth.uid();
  v_pago          public.venta_pagos%rowtype;
  v_movimiento    public.cuenta_corriente_movimientos%rowtype;
  v_metodo        public.metodos_pago%rowtype;
  v_turno         public.turnos_caja%rowtype;
  v_creditos      integer;
  v_base          numeric;
  v_recargo       numeric;
  v_bruto         numeric;
  v_comision      numeric;
  v_descripcion   text;
  v_anterior      jsonb;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.tiene_permiso('clientes.corregir_cobro_cc') then
    raise exception 'SIN_PERMISO';
  end if;

  select * into v_pago
    from public.venta_pagos
   where id = p_pago_id
   for update;

  if not found or v_pago.negocio_id is distinct from v_negocio then
    raise exception 'COBRO_INEXISTENTE';
  end if;

  if v_pago.tipo_movimiento <> 'PAGO_CUENTA_CORRIENTE'
     or v_pago.venta_id is not null
     or v_pago.cliente_id is null
     or v_pago.estado_pago_operacion <> 'CONFIRMADO' then
    raise exception 'COBRO_NO_CORREGIBLE';
  end if;

  select count(*) into v_creditos
    from public.cuenta_corriente_movimientos
   where pago_id = p_pago_id
     and tipo = 'CREDITO'
     and not coalesce(anulado, false);

  if v_creditos <> 1 then
    raise exception 'COBRO_SIN_MOVIMIENTO';
  end if;

  select * into v_movimiento
    from public.cuenta_corriente_movimientos
   where pago_id = p_pago_id
     and tipo = 'CREDITO'
     and not coalesce(anulado, false)
   for update;

  if v_movimiento.negocio_id is distinct from v_negocio
     or v_movimiento.cliente_id is distinct from v_pago.cliente_id then
    raise exception 'COBRO_SIN_MOVIMIENTO';
  end if;

  if v_movimiento.creado_por is distinct from v_usuario
     and not coalesce(public.is_admin(), false) then
    raise exception 'COBRO_AJENO';
  end if;

  select * into v_turno
    from public.turnos_caja
   where id = v_pago.turno_caja_id;

  if not found or v_turno.negocio_id is distinct from v_negocio then
    raise exception 'COBRO_NO_CORREGIBLE';
  end if;

  if v_turno.estado = 'CERRADO'
     and not coalesce(public.is_admin(), false) then
    raise exception 'TURNO_CERRADO_REQUIERE_ADMIN';
  end if;

  select * into v_metodo
    from public.metodos_pago
   where id = p_metodo_pago_id
     and negocio_id = v_negocio
     and activo;

  if not found then
    raise exception 'METODO_INEXISTENTE';
  end if;

  if v_metodo.id = v_pago.metodo_pago_id then
    raise exception 'MISMO_METODO';
  end if;

  v_base := coalesce(v_pago.monto_base, v_movimiento.monto);
  v_recargo := round(v_base * coalesce(v_metodo.recargo_porcentaje, 0) / 100);
  v_bruto := v_base + v_recargo;
  v_comision := round(v_bruto * coalesce(v_metodo.comision, 0) / 100, 2);
  v_descripcion := case
    when v_recargo > 0 then
      format(
        'Pago a cuenta - %s (incluye $%s de recargo por %s)',
        v_metodo.nombre,
        v_recargo,
        v_metodo.nombre
      )
    else format('Pago a cuenta - %s', v_metodo.nombre)
  end;

  v_anterior := jsonb_build_object(
    'metodo_pago_id',       v_pago.metodo_pago_id,
    'metodo_nombre',        v_pago.metodo_nombre,
    'metodo_tipo',          v_pago.metodo_tipo,
    'recargo_porcentaje',   v_pago.recargo_porcentaje,
    'recargo_monto',        v_pago.recargo_monto,
    'monto_bruto',          v_pago.monto_bruto,
    'comision_porcentaje',  v_pago.comision_porcentaje,
    'comision_monto',       v_pago.comision_monto,
    'monto_neto',           v_pago.monto_neto,
    'acreditacion_dias',    v_pago.acreditacion_dias
  );

  update public.venta_pagos
     set metodo_pago_id      = v_metodo.id,
         metodo_nombre       = v_metodo.nombre,
         metodo_tipo         = v_metodo.tipo,
         recargo_porcentaje  = coalesce(v_metodo.recargo_porcentaje, 0),
         recargo_monto       = v_recargo,
         monto_bruto         = v_bruto,
         comision_porcentaje = coalesce(v_metodo.comision, 0),
         comision_monto      = v_comision,
         monto_neto          = v_bruto - v_comision,
         acreditacion_dias   = coalesce(v_metodo.acreditacion_dias, 0)
   where id = p_pago_id;

  update public.cuenta_corriente_movimientos
     set descripcion = v_descripcion
   where id = v_movimiento.id;

  insert into public.cobros_cc_correcciones (
    negocio_id,
    pago_id,
    cliente_id,
    valor_anterior,
    valor_nuevo,
    turno_estado,
    motivo,
    corregido_por
  ) values (
    v_negocio,
    p_pago_id,
    v_pago.cliente_id,
    v_anterior,
    jsonb_build_object(
      'metodo_pago_id',       v_metodo.id,
      'metodo_nombre',        v_metodo.nombre,
      'metodo_tipo',          v_metodo.tipo,
      'recargo_porcentaje',   coalesce(v_metodo.recargo_porcentaje, 0),
      'recargo_monto',        v_recargo,
      'monto_bruto',          v_bruto,
      'comision_porcentaje',  coalesce(v_metodo.comision, 0),
      'comision_monto',       v_comision,
      'monto_neto',           v_bruto - v_comision,
      'acreditacion_dias',    coalesce(v_metodo.acreditacion_dias, 0)
    ),
    v_turno.estado,
    nullif(btrim(coalesce(p_motivo, '')), ''),
    v_usuario
  );

  return jsonb_build_object(
    'metodo_anterior',  v_pago.metodo_nombre,
    'metodo_nuevo',     v_metodo.nombre,
    'total_anterior',   v_pago.monto_bruto,
    'total_nuevo',      v_bruto,
    'diferencia_total', v_bruto - v_pago.monto_bruto,
    'turno_cerrado',    v_turno.estado = 'CERRADO'
  );
end;
$_$;


ALTER FUNCTION "public"."corregir_metodo_pago_cobro_cc"("p_pago_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."corregir_metodo_pago_cobro_cc"("p_pago_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") IS 'Corrige en una transacción el medio de un cobro de cuenta corriente, sin cambiar el capital amortizado. Conserva el snapshot de turnos cerrados y registra antes/después en cobros_cc_correcciones.';



CREATE OR REPLACE FUNCTION "public"."corregir_metodo_pago_venta"("p_venta_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio    uuid := security.current_negocio_id();
  v_usuario    uuid := auth.uid();
  v_venta      public.ventas%rowtype;
  v_pago       public.venta_pagos%rowtype;
  v_metodo     public.metodos_pago%rowtype;
  v_turno      public.turnos_caja%rowtype;
  v_cobros     int;
  v_base       numeric;
  v_recargo    numeric;
  v_bruto      numeric;
  v_comision   numeric;
  v_total      numeric;
  v_legacy     text;
  v_anterior   jsonb;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.tiene_permiso('ventas.corregir_pago') then
    raise exception 'SIN_PERMISO';
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found or v_venta.negocio_id is distinct from v_negocio then
    raise exception 'VENTA_INEXISTENTE';
  end if;

  if v_venta.vendedor_id is distinct from v_usuario
     and not public.tiene_permiso('ventas.ver_todas') then
    raise exception 'VENTA_AJENA';
  end if;

  if v_venta.estado_operacion <> 'CONFIRMADA' then
    raise exception 'VENTA_NO_CORREGIBLE';
  end if;

  if coalesce(v_venta.monto_pendiente, 0) > 0 then
    raise exception 'VENTA_CON_DEUDA';
  end if;

  select count(*) into v_cobros
    from public.venta_pagos
   where venta_id = p_venta_id
     and tipo_movimiento = 'PAGO_VENTA';

  if v_cobros <> 1 then
    raise exception 'VENTA_SIN_UN_UNICO_COBRO';
  end if;

  select * into v_pago
    from public.venta_pagos
   where venta_id = p_venta_id
     and tipo_movimiento = 'PAGO_VENTA'
   for update;

  if v_pago.estado_pago_operacion <> 'CONFIRMADO' then
    raise exception 'COBRO_NO_CONFIRMADO';
  end if;

  select * into v_turno
    from public.turnos_caja
   where id = coalesce(v_pago.turno_caja_id, v_venta.turno_caja_id);

  if not found or v_turno.estado <> 'ABIERTO' then
    raise exception 'TURNO_CERRADO';
  end if;

  select * into v_metodo
    from public.metodos_pago
   where id = p_metodo_pago_id
     and negocio_id = v_negocio
     and activo;

  if not found then
    raise exception 'METODO_INEXISTENTE';
  end if;

  if v_metodo.id = v_pago.metodo_pago_id then
    raise exception 'MISMO_METODO';
  end if;

  v_base     := coalesce(v_pago.monto_base, v_pago.monto_bruto);
  v_recargo  := round(v_base * coalesce(v_metodo.recargo_porcentaje, 0) / 100);
  v_bruto    := v_base + v_recargo;
  v_comision := round(v_bruto * coalesce(v_metodo.comision, 0) / 100, 2);
  v_total    := v_venta.total - coalesce(v_venta.recargo_metodo_total, 0) + v_recargo;

  v_legacy := case v_metodo.tipo
                when 'TRANSFERENCIA' then 'TRANSFERENCIA'
                when 'TARJETA' then 'TARJETA'
                when 'BILLETERA_VIRTUAL' then 'TARJETA'
                else 'EFECTIVO'
              end;

  v_anterior := jsonb_build_object(
    'metodo_pago_id',      v_pago.metodo_pago_id,
    'metodo_nombre',       v_pago.metodo_nombre,
    'metodo_tipo',         v_pago.metodo_tipo,
    'recargo_porcentaje',  v_pago.recargo_porcentaje,
    'recargo_monto',       v_pago.recargo_monto,
    'monto_bruto',         v_pago.monto_bruto,
    'comision_monto',      v_pago.comision_monto,
    'total_venta',         v_venta.total
  );

  update public.venta_pagos
     set metodo_pago_id     = v_metodo.id,
         metodo_nombre      = v_metodo.nombre,
         metodo_tipo        = v_metodo.tipo,
         recargo_porcentaje = coalesce(v_metodo.recargo_porcentaje, 0),
         recargo_monto      = v_recargo,
         monto_bruto        = v_bruto,
         comision_porcentaje= coalesce(v_metodo.comision, 0),
         comision_monto     = v_comision,
         monto_neto         = v_bruto - v_comision,
         acreditacion_dias  = coalesce(v_metodo.acreditacion_dias, 0)
   where id = v_pago.id;

  update public.ventas
     set metodo_pago          = v_legacy,
         recargo_metodo_total = v_recargo,
         total                = v_total,
         monto_cobrado        = v_bruto,
         total_bruto          = v_bruto,
         comision_total       = v_comision,
         total_neto           = v_bruto - v_comision
   where id = p_venta_id;

  insert into public.ventas_correcciones (
    negocio_id, venta_id, campo, valor_anterior, valor_nuevo, motivo, corregido_por
  ) values (
    v_negocio, p_venta_id, 'METODO_PAGO', v_anterior,
    jsonb_build_object(
      'metodo_pago_id',     v_metodo.id,
      'metodo_nombre',      v_metodo.nombre,
      'metodo_tipo',        v_metodo.tipo,
      'recargo_porcentaje', coalesce(v_metodo.recargo_porcentaje, 0),
      'recargo_monto',      v_recargo,
      'monto_bruto',        v_bruto,
      'comision_monto',     v_comision,
      'total_venta',        v_total
    ),
    nullif(btrim(coalesce(p_motivo, '')), ''),
    v_usuario
  );

  return jsonb_build_object(
    'metodo_anterior',   v_pago.metodo_nombre,
    'metodo_nuevo',      v_metodo.nombre,
    'total_anterior',    v_venta.total,
    'total_nuevo',       v_total,
    'diferencia_total',  v_total - v_venta.total,
    'recargo_nuevo',     v_recargo
  );
end;
$$;


ALTER FUNCTION "public"."corregir_metodo_pago_venta"("p_venta_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."corregir_metodo_pago_venta"("p_venta_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") IS 'Cambia el metodo de pago de una venta de UN solo cobro cuyo turno sigue abierto, recalculando recargo, comision y total, y dejando la correccion en ventas_correcciones. SECURITY DEFINER con los chequeos de negocio, permiso y pertenencia escritos adentro. Ver 20260903130000.';



CREATE OR REPLACE FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_plan" "text" DEFAULT NULL::"text", "p_modalidad" "text" DEFAULT 'mensual'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_negocio uuid;
    v_plan    uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sin sesion' USING ERRCODE = '42501';
    END IF;

    SELECT id INTO v_plan FROM public.planes
    WHERE lower(nombre) = lower(coalesce(p_plan, '')) AND activo
    LIMIT 1;

    IF v_plan IS NULL THEN
        SELECT id INTO v_plan FROM public.planes
        WHERE activo ORDER BY precio_mensual ASC LIMIT 1;
    END IF;

    -- Nace en 'prueba' y no en 'activo': durante los 14 dias todavia no pago
    -- nada. El estado lo dice explicitamente en vez de deducirse de que
    -- plan_vencimiento este cerca del alta.
    INSERT INTO public.negocios (nombre, slug, estado, plan_id, plan_vencimiento, modalidad)
    VALUES (p_nombre, p_slug, 'prueba', v_plan, now() + interval '14 days', coalesce(p_modalidad, 'mensual'))
    RETURNING id INTO v_negocio;

    INSERT INTO public.usuarios_negocios (usuario_id, negocio_id, rol, es_owner)
    VALUES (auth.uid(), v_negocio, 'ADMIN', true);

    INSERT INTO public.rol_permisos_negocio (negocio_id, rol, permiso_id)
    SELECT v_negocio, 'ADMIN', p.id FROM public.permisos p;

    RETURN v_negocio;
END;
$$;


ALTER FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_plan" "text", "p_modalidad" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_whatsapp" "text", "p_rubro_comercial" "text" DEFAULT NULL::"text", "p_tamano_equipo" "text" DEFAULT NULL::"text", "p_rubro" "text" DEFAULT 'indumentaria'::"text", "p_razon_social" "text" DEFAULT NULL::"text", "p_cuit" "text" DEFAULT NULL::"text", "p_condicion_iva" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user      uuid := auth.uid();
    v_negocio   uuid;
    v_rol_admin uuid;
    v_plan      uuid;
BEGIN
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'Hay que iniciar sesión para crear un negocio';
    END IF;

    SELECT id INTO v_plan FROM public.planes WHERE nombre = 'Prueba';
    IF v_plan IS NULL THEN
        RAISE EXCEPTION 'No existe el plan de prueba';
    END IF;

    -- 'prueba' y no 'activo': entra igual a todo, pero el panel lo cuenta como
    -- lo que es hasta que pague. Ver CLAUDE.md: lo que separa activo de prueba
    -- es el COBRO, no el acceso.
    INSERT INTO public.negocios (
      nombre, slug, estado, plan_id, plan_vencimiento, rubro_comercial, tamano_equipo
    )
    VALUES (
      p_nombre, p_slug, 'prueba', v_plan, now() + interval '14 days',
      p_rubro_comercial, p_tamano_equipo
    )
    RETURNING id INTO v_negocio;

    INSERT INTO public.roles (nombre, negocio_id, es_sistema)
    VALUES ('ADMIN', v_negocio, true), ('ENCARGADO', v_negocio, true), ('VENDEDOR', v_negocio, true);

    SELECT id INTO v_rol_admin FROM public.roles
    WHERE negocio_id = v_negocio AND nombre = 'ADMIN';

    INSERT INTO public.rol_permisos (rol_id, permiso_id, negocio_id)
    SELECT v_rol_admin, p.id, v_negocio FROM public.permisos p;

    -- Lo mínimo para que una vendedora recién invitada pueda vender: cobrar
    -- y operar su caja. El resto lo reparte el dueño en Empleados y Permisos.
    INSERT INTO public.rol_permisos (rol_id, permiso_id, negocio_id)
    SELECT r.id, p.id, v_negocio
      FROM public.roles r
     CROSS JOIN public.permisos p
     WHERE r.negocio_id = v_negocio AND r.nombre IN ('ENCARGADO', 'VENDEDOR')
       AND p.clave IN ('ventas.cobrar', 'caja.operar');

    INSERT INTO public.configuracion_pos (
      negocio_id, "posName", whatsapp, rubro, razon_social, cuit, condicion_iva
    )
    VALUES (
      v_negocio, p_nombre, p_whatsapp,
      CASE WHEN p_rubro = 'electro' THEN 'electro' ELSE 'indumentaria' END,
      nullif(btrim(coalesce(p_razon_social, '')), ''),
      nullif(btrim(coalesce(p_cuit, '')), ''),
      nullif(btrim(coalesce(p_condicion_iva, '')), '')
    );

    INSERT INTO public.metodos_pago (negocio_id, nombre, tipo, comision, acreditacion_dias, activo)
    VALUES
      (v_negocio, 'Efectivo',      'EFECTIVO',          0, 0, true),
      (v_negocio, 'Transferencia', 'TRANSFERENCIA',     0, 0, true),
      (v_negocio, 'Mercado Pago',  'BILLETERA_VIRTUAL', 0, 0, true);

    INSERT INTO public.usuarios_negocios (usuario_id, negocio_id, rol_id, rol, es_owner)
    VALUES (v_user, v_negocio, v_rol_admin, 'ADMIN', true);

    RETURN v_negocio;
END;
$$;


ALTER FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_whatsapp" "text", "p_rubro_comercial" "text", "p_tamano_equipo" "text", "p_rubro" "text", "p_razon_social" "text", "p_cuit" "text", "p_condicion_iva" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_pedido"("p_items" "jsonb", "p_cliente_id" "uuid" DEFAULT NULL::"uuid", "p_total_estimado" numeric DEFAULT 0, "p_nota" "text" DEFAULT NULL::"text", "p_contexto" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_dia    date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_numero integer;
  v_id     uuid;
begin
  if security.current_negocio_id() is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  insert into public.pedidos_numeracion as n (dia, ultimo)
  values (v_dia, 1)
  on conflict (negocio_id, dia) do update set ultimo = n.ultimo + 1
  returning n.ultimo into v_numero;

  insert into public.pedidos (numero, dia, cliente_id, items, total_estimado, nota, contexto)
  values (v_numero, v_dia, p_cliente_id, p_items, coalesce(p_total_estimado, 0), nullif(trim(p_nota), ''), p_contexto)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'numero', v_numero, 'dia', v_dia);
end;
$$;


ALTER FUNCTION "public"."crear_pedido"("p_items" "jsonb", "p_cliente_id" "uuid", "p_total_estimado" numeric, "p_nota" "text", "p_contexto" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crear_productos_desde_remito"("p_orden_id" "uuid", "p_items" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_item          jsonb;
  v_item_ids      uuid[];
  v_producto_id   uuid;
  v_categoria_id  uuid;
  v_categoria_nom text;
  v_nombre        text;
  v_slug          text;
  v_tipo          text;
  v_precio        numeric;
  v_costo         numeric;
  v_marca         text;
  v_creados       integer := 0;
  v_reusados      integer := 0;
  v_mapa          jsonb := '{}'::jsonb;
begin
  perform 1 from ordenes_compra where id = p_orden_id for update;
  if not found then
    raise exception 'Orden % no encontrada o sin permiso', p_orden_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select array_agg(x::uuid)
      into v_item_ids
      from jsonb_array_elements_text(coalesce(v_item->'item_ids', '[]'::jsonb)) x;

    if v_item_ids is null or array_length(v_item_ids, 1) is null then
      continue;
    end if;

    select producto_id
      into v_producto_id
      from ordenes_items
     where id = any(v_item_ids)
       and producto_id is not null
     limit 1;

    if v_producto_id is not null then
      v_reusados := v_reusados + 1;
    else
      v_nombre := nullif(trim(coalesce(v_item->>'nombre', '')), '');
      if v_nombre is null then
        raise exception 'Hay una fila sin nombre de producto';
      end if;

      v_categoria_id  := nullif(v_item->>'categoria_id', '')::uuid;
      v_categoria_nom := nullif(trim(coalesce(v_item->>'categoria_nombre_nueva', '')), '');
      v_precio        := coalesce(nullif(v_item->>'precio', '')::numeric, 0);
      v_costo         := coalesce(nullif(v_item->>'costo', '')::numeric, 0);
      v_marca         := nullif(trim(coalesce(v_item->>'marca', '')), '');

      if v_categoria_id is null and v_categoria_nom is not null then
        insert into categorias (nombre, slug, parent_id, activa)
        values (
          v_categoria_nom,
          regexp_replace(
            lower(public.unaccent_immutable(v_categoria_nom)),
            '[^a-z0-9]+', '-', 'g'
          ),
          null,
          true
        )
        on conflict (negocio_id, slug) where parent_id is null do nothing
        returning id into v_categoria_id;

        if v_categoria_id is null then
          select id into v_categoria_id
            from categorias
           where parent_id is null
             and slug = regexp_replace(
                   lower(public.unaccent_immutable(v_categoria_nom)),
                   '[^a-z0-9]+', '-', 'g'
                 )
           limit 1;
        end if;
      end if;

      select nombre into v_tipo from categorias where id = v_categoria_id;
      v_tipo := coalesce(v_tipo, 'General');

      v_slug := regexp_replace(
                  lower(public.unaccent_immutable(v_nombre)),
                  '[^a-z0-9]+', '-', 'g'
                ) || '-' || substr(md5(random()::text), 1, 4);

      insert into productos (
        nombre, slug, tipo, categoria_id, marca,
        precio, precio_costo, publicado, atributos_globales
      )
      values (
        v_nombre, v_slug, v_tipo, v_categoria_id, v_marca,
        v_precio, v_costo, true, '{}'::jsonb
      )
      returning id into v_producto_id;

      v_creados := v_creados + 1;
    end if;

    update ordenes_items
       set producto_id  = v_producto_id,
           estado_match = case
             when estado_match = 'DESCONOCIDO' then 'NUEVO_ALIAS'
             else estado_match
           end,
           precio_costo = case
             when nullif(v_item->>'costo', '') is not null
               then (v_item->>'costo')::numeric
             else precio_costo
           end
     where id = any(v_item_ids);

    v_mapa := v_mapa || jsonb_build_object(
      coalesce(v_item->>'raw_nombre', ''), v_producto_id
    );
  end loop;

  return jsonb_build_object(
    'creados', v_creados,
    'reusados', v_reusados,
    'productos_por_raw_nombre', v_mapa
  );
end;
$$;


ALTER FUNCTION "public"."crear_productos_desde_remito"("p_orden_id" "uuid", "p_items" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."crear_productos_desde_remito"("p_orden_id" "uuid", "p_items" "jsonb") IS 'Crea en lote las cabeceras de producto de un remito en modo carga inicial. Idempotente: si la línea ya tiene producto_id, lo reusa. No toca stock — eso sigue siendo aprobar_orden_compra.';



CREATE OR REPLACE FUNCTION "public"."cuenta_actual_venta_pago"("p_negocio_id" "uuid", "p_metodo_tipo" "text", "p_acreditacion_dias" integer, "p_cuenta_destino_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$declare v uuid; begin
 if p_metodo_tipo='EFECTIVO' then v:=coalesce(p_cuenta_destino_id,public.cuenta_financiera_sistema(p_negocio_id,'CAJA_DIARIA'));
 elsif coalesce(p_acreditacion_dias,0)=0 and p_cuenta_destino_id is not null then v:=p_cuenta_destino_id;
 else v:=public.cuenta_financiera_sistema(p_negocio_id,'POR_ACREDITAR'); end if;
 if v is null then raise exception 'CUENTA_FINANCIERA_SISTEMA_INEXISTENTE'; end if; return v; end;$$;


ALTER FUNCTION "public"."cuenta_actual_venta_pago"("p_negocio_id" "uuid", "p_metodo_tipo" "text", "p_acreditacion_dias" integer, "p_cuenta_destino_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cuenta_financiera_sistema"("p_negocio_id" "uuid", "p_codigo" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$select id from public.cuentas_financieras where negocio_id=p_negocio_id and codigo=p_codigo and es_sistema and activa limit 1;$$;


ALTER FUNCTION "public"."cuenta_financiera_sistema"("p_negocio_id" "uuid", "p_codigo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."curva_de_precio"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_desde   date;
  v_hasta   date;
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenes permiso para ver la curva de precio'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;

  if p_periodo is not null then
    v_hasta := v_hoy;
    v_desde := case p_periodo
      when 'hoy'    then v_hoy
      when 'semana' then (date_trunc('week',  v_hoy)::date)
      when 'mes'    then (date_trunc('month', v_hoy)::date)
      when 'anio'   then (date_trunc('year',  v_hoy)::date)
      else v_hoy
    end;
  else
    v_hasta := coalesce(p_hasta, v_hoy);
    v_desde := coalesce(p_desde, v_hasta - 29);
  end if;

  with r as (
    select
      i.cantidad,
      i.precio_final    * i.cantidad                 as ingreso,
      i.descuento_monto * i.cantidad                 as descuento,
      (i.precio_final - i.precio_costo) * i.cantidad as margen,
      v.vendedor_id,
      case
        when coalesce(i.descuento_monto, 0) <= 0                      then 'PRECIO_LLENO'
        when i.descuento_monto / nullif(i.precio_unitario, 0) <= 0.10 then 'HASTA_10'
        when i.descuento_monto / nullif(i.precio_unitario, 0) <= 0.20 then 'HASTA_20'
        when i.descuento_monto / nullif(i.precio_unitario, 0) <= 0.30 then 'HASTA_30'
        else 'MAS_DE_30'
      end as tramo
    from public.ventas_items i
    join public.ventas v on v.id = i.venta_id
    where i.negocio_id = v_negocio
      and v.estado_operacion is distinct from 'ANULADA'
      and (v.fecha_venta at time zone v_tz)::date between v_desde and v_hasta
  ),
  tot as (
    select sum(cantidad) unidades, sum(ingreso) ingreso,
           sum(descuento) descuento, sum(margen) margen
    from r
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', p_periodo,
    'generado_en', now(),
    'totales', (
      select jsonb_build_object(
        'unidades', coalesce(t.unidades, 0),
        'ingreso', round(coalesce(t.ingreso, 0), 2),
        'margen', round(coalesce(t.margen, 0), 2),
        'margen_pct', case when t.ingreso > 0 then round(t.margen * 100.0 / t.ingreso, 2) end,
        'descuento_resignado', round(coalesce(t.descuento, 0), 2),
        'margen_pct_a_precio_lleno', case when (t.ingreso + t.descuento) > 0
          then round((t.margen + t.descuento) * 100.0 / (t.ingreso + t.descuento), 2) end
      )
      from tot t
    ),
    'tramos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'tramo', tramo,
        'unidades', unidades,
        'pct_unidades', round(unidades * 100.0 / nullif((select unidades from tot), 0), 2),
        'ingreso', round(ingreso, 2),
        'margen', round(margen, 2),
        'margen_pct', case when ingreso > 0 then round(margen * 100.0 / ingreso, 2) end,
        'descuento_resignado', round(descuento, 2)
      ) order by orden), '[]'::jsonb)
      from (
        select tramo,
               case tramo when 'PRECIO_LLENO' then 1 when 'HASTA_10' then 2
                          when 'HASTA_20' then 3 when 'HASTA_30' then 4 else 5 end as orden,
               sum(cantidad) unidades, sum(ingreso) ingreso,
               sum(margen) margen, sum(descuento) descuento
        from r group by 1, 2
      ) x
    ),
    'por_vendedora', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'vendedora', vendedora,
        'unidades', unidades,
        'unidades_con_descuento', con_desc,
        'pct_unidades_con_descuento', round(con_desc * 100.0 / nullif(unidades, 0), 2),
        'descuento_resignado', round(descuento, 2),
        'descuento_pct_sobre_ingreso', case when ingreso > 0
          then round(descuento * 100.0 / ingreso, 2) end
      ) order by unidades desc), '[]'::jsonb)
      from (
        select coalesce(p.nombre, 'Sin identificar') as vendedora,
               sum(r.cantidad)                       as unidades,
               sum(r.cantidad) filter (where r.tramo <> 'PRECIO_LLENO') as con_desc,
               sum(r.descuento)                      as descuento,
               sum(r.ingreso)                        as ingreso
        from r left join public.perfiles p on p.id = r.vendedor_id
        group by coalesce(p.nombre, 'Sin identificar')
      ) v
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."curva_de_precio"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."curva_de_precio"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") IS 'Comerz Insights: a que precio se vendio cada unidad (lleno / con descuento por tramo), con el margen de cada tramo y el corte por vendedora. Con markup uniforme, aca vive toda la variacion real del margen. Gate: caja.ver_gerencial.';



CREATE OR REPLACE FUNCTION "public"."custom_access_token_hook"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id  uuid;
  v_claims   jsonb;
  v_negocios jsonb;
  v_unico    uuid;
begin
  begin
    v_user_id := (event ->> 'user_id')::uuid;

    if v_user_id is null then
      return event;
    end if;

    select coalesce(jsonb_object_agg(un.negocio_id, un.rol), '{}'::jsonb)
      into v_negocios
      from public.usuarios_negocios un
     where un.usuario_id = v_user_id;

    if jsonb_typeof(v_negocios) = 'object'
       and (select count(*) from jsonb_object_keys(v_negocios)) = 1 then
      v_unico := (select k::uuid from jsonb_object_keys(v_negocios) as k limit 1);
    else
      v_unico := null;
    end if;

    v_claims := coalesce(event -> 'claims', '{}'::jsonb);

    v_claims := jsonb_set(
      v_claims,
      '{comerz}',
      jsonb_build_object(
        'v',             1,
        'negocios',      v_negocios,
        'negocio_unico', v_unico,
        'super_admin',   coalesce(security.es_super_admin(v_user_id), false),
        'src',           event ->> 'authentication_method'
      ),
      true
    );

    return jsonb_set(event, '{claims}', v_claims, true);
  exception
    when others then
      return event;
  end;
end;
$$;


ALTER FUNCTION "public"."custom_access_token_hook"("event" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") IS 'Custom access token hook: agrega el claim comerz con el mapa {negocio: rol}, el negocio unico, si es super admin y el authentication_method. NUNCA lanza: ante cualquier error devuelve el evento intacto, porque un hook que falla deja a Auth sin emitir tokens. Ver 20260903110000.';



CREATE OR REPLACE FUNCTION "public"."dar_de_baja_mails"("p_envio_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_email text;
begin
  select e.email into v_email
  from public.envios_email e
  where e.id = p_envio_id;

  if v_email is null then
    return null;
  end if;

  insert into public.email_bajas (email, motivo)
  values (v_email, 'link del pie del mail')
  on conflict (email) do nothing;

  return v_email;
end;
$$;


ALTER FUNCTION "public"."dar_de_baja_mails"("p_envio_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."dar_de_baja_mails"("p_envio_id" "uuid") IS 'Da de baja la direccion de UN envio, identificada por el uuid del envio. La direccion sale de la fila, nunca del parametro. Ver 20260910120000.';



CREATE OR REPLACE FUNCTION "public"."desmarcar_alerta_caja_revisada"("p_clave" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."desmarcar_alerta_caja_revisada"("p_clave" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detalle_medios_pago_dia"("p_fecha" "date" DEFAULT NULL::"date") RETURNS TABLE("pago_id" "uuid", "venta_id" "uuid", "metodo_tipo" "text", "metodo_nombre" "text", "monto" numeric, "es_cobranza_cc" boolean, "fecha" timestamp with time zone, "vendedor" "text", "cliente" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_fecha   date;
  v_negocio uuid;
BEGIN
  IF NOT public.tiene_permiso('caja.ver_gerencial') THEN
    RAISE EXCEPTION 'No tenés permiso para ver el resumen gerencial de caja'
      USING ERRCODE = '42501';
  END IF;

  v_negocio := security.current_negocio_id();
  IF v_negocio IS NULL THEN
    RAISE EXCEPTION 'No hay un negocio activo' USING ERRCODE = '42501';
  END IF;

  v_fecha := COALESCE(p_fecha, (now() AT TIME ZONE v_tz)::date);

  RETURN QUERY
  SELECT
    vp.id,
    vp.venta_id,
    vp.metodo_tipo,
    vp.metodo_nombre,
    vp.monto_bruto,
    (vp.tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'),
    vp.creado_en,
    perf.nombre,
    cli.nombre
  FROM public.venta_pagos vp
  JOIN public.turnos_caja t ON t.id = vp.turno_caja_id
  LEFT JOIN public.perfiles perf ON perf.id = t.vendedor_id
  LEFT JOIN public.clientes cli ON cli.id = vp.cliente_id
  WHERE (t.fecha_apertura AT TIME ZONE v_tz)::date = v_fecha
    AND vp.estado_pago_operacion <> 'ANULADO'
    AND vp.negocio_id = v_negocio
    AND t.negocio_id = v_negocio
  ORDER BY vp.creado_en DESC;
END;
$$;


ALTER FUNCTION "public"."detalle_medios_pago_dia"("p_fecha" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deuda_cc_vencida"("p_cliente_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("cliente_id" "uuid", "saldo_vivo" numeric, "vencido" numeric, "fecha_mas_antigua" "date", "mora_viva" numeric, "capital_vivo" numeric, "debito_capital_mas_antiguo_id" "uuid")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
  with plazos as (
    select c.id as cliente_id, coalesce(cp.cc_plazo_mora, 30) as dias
    from public.clientes c
    left join public.configuracion_pos cp on cp.negocio_id = c.negocio_id
    where p_cliente_id is null or c.id = p_cliente_id
  ),
  debitos as (
    select
      m.cliente_id,
      m.id as debito_id,
      coalesce(m.fecha_origen, (m.creado_en at time zone 'UTC')::date) as fecha,
      m.monto,
      m.creado_en,
      m.pago_id is not null as es_mora,
      sum(m.monto) over (
        partition by m.cliente_id
        order by coalesce(m.fecha_origen, (m.creado_en at time zone 'UTC')::date), m.creado_en
        rows unbounded preceding
      ) as acumulado
    from public.cuenta_corriente_movimientos m
    join plazos p on p.cliente_id = m.cliente_id
    where m.tipo = 'DEBITO'
      and m.anulado = false
  ),
  pagado as (
    select m.cliente_id, coalesce(sum(m.monto), 0) as total
    from public.cuenta_corriente_movimientos m
    join plazos p on p.cliente_id = m.cliente_id
    where m.tipo = 'CREDITO'
      and m.anulado = false
    group by m.cliente_id
  ),
  vivos as (
    select
      d.cliente_id,
      d.debito_id,
      d.fecha,
      d.creado_en,
      d.es_mora,
      greatest(0, least(d.monto, d.acumulado - coalesce(pg.total, 0))) as vivo,
      pl.dias
    from debitos d
    join plazos pl on pl.cliente_id = d.cliente_id
    left join pagado pg on pg.cliente_id = d.cliente_id
  ),
  ancla as (
    select distinct on (v.cliente_id) v.cliente_id, v.debito_id
    from vivos v
    where v.vivo > 0 and not v.es_mora
    order by v.cliente_id, v.fecha, v.creado_en
  )
  select
    v.cliente_id,
    round(sum(v.vivo), 2) as saldo_vivo,
    round(sum(v.vivo) filter (
      where v.vivo > 0 and v.fecha + v.dias < current_date
    ), 2) as vencido,
    min(v.fecha) filter (where v.vivo > 0) as fecha_mas_antigua,
    round(coalesce(sum(v.vivo) filter (where v.es_mora), 0), 2) as mora_viva,
    round(coalesce(sum(v.vivo) filter (where not v.es_mora), 0), 2) as capital_vivo,
    a.debito_id as debito_capital_mas_antiguo_id
  from vivos v
  left join ancla a on a.cliente_id = v.cliente_id
  group by v.cliente_id, a.debito_id
  having sum(v.vivo) > 0;
$$;


ALTER FUNCTION "public"."deuda_cc_vencida"("p_cliente_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."deuda_cc_vencida"("p_cliente_id" "uuid") IS 'Deuda viva por cliente imputando los pagos FIFO. `capital_vivo` es la base del recargo por mora: excluye los DEBITO que son recargos previos (pago_id no nulo), para que la mora no se calcule sobre mora. `debito_capital_mas_antiguo_id` es el ticket al que pertenece el proximo recargo, para que el cobro lo declare.';



CREATE OR REPLACE FUNCTION "public"."devolver_unidades_venta"("p_venta_id" "uuid", "p_a_stock" boolean) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_afectadas integer;
BEGIN
  IF p_a_stock THEN
    UPDATE public.unidades_serie
    SET estado = 'disponible',
        fecha_venta = NULL,
        venta_id = NULL
    WHERE venta_id = p_venta_id
      AND estado = 'vendido';
  ELSE
    UPDATE public.unidades_serie
    SET estado = 'baja'
    WHERE venta_id = p_venta_id
      AND estado = 'vendido';
  END IF;

  GET DIAGNOSTICS v_afectadas = ROW_COUNT;
  RETURN v_afectadas;
END;
$$;


ALTER FUNCTION "public"."devolver_unidades_venta"("p_venta_id" "uuid", "p_a_stock" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editar_empleado"("p_usuario_id" "uuid", "p_nombre" "text", "p_email" "text", "p_rol_id" "uuid", "p_cerrar_sesiones" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_negocio   uuid := security.current_negocio_id();
  v_rol       text;
  v_rol_admin uuid;
  v_otras     integer;
  v_admins    integer;
  v_rol_actual uuid;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select rol_id into v_rol_actual
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id = v_negocio;
  if v_rol_actual is null then
    raise exception 'NO_ES_MIEMBRO';
  end if;

  select case when r.nombre = 'ENCARGADO' then 'VENDEDOR' else r.nombre end
    into v_rol
    from public.roles r
   where r.id = p_rol_id and r.negocio_id = v_negocio;
  if v_rol is null then
    raise exception 'ROL_INVALIDO';
  end if;

  select id into v_rol_admin from public.roles where negocio_id = v_negocio and nombre = 'ADMIN';
  if v_rol_actual = v_rol_admin and p_rol_id <> v_rol_admin then
    select count(*) into v_admins
      from public.usuarios_negocios
     where negocio_id = v_negocio and rol_id = v_rol_admin;
    if v_admins <= 1 then
      raise exception 'ULTIMO_ADMIN';
    end if;
  end if;

  select count(*) into v_otras
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id <> v_negocio;

  update public.perfiles
     set nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
         email  = case when v_otras = 0 and nullif(trim(p_email), '') is not null
                       then lower(trim(p_email)) else email end
   where id = p_usuario_id;

  update public.usuarios_negocios
     set rol_id = p_rol_id, rol = v_rol
   where usuario_id = p_usuario_id and negocio_id = v_negocio;

  if p_cerrar_sesiones and v_otras = 0 then
    perform public.cerrar_sesiones_usuario(p_usuario_id);
  end if;

  return jsonb_build_object('otras_membresias', v_otras);
end;
$$;


ALTER FUNCTION "public"."editar_empleado"("p_usuario_id" "uuid", "p_nombre" "text", "p_email" "text", "p_rol_id" "uuid", "p_cerrar_sesiones" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."efectivo_actual_turnos"("p_turno_ids" "uuid"[]) RETURNS TABLE("turno_id" "uuid", "efectivo_esperado_actual" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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
    -- Mismo criterio que flujo_caja_turno, y tiene que seguir siendolo: este
    -- es el numero que el historial compara contra el que se firmo al cerrar.
    + coalesce((select sum(vp.monto_bruto) from public.venta_pagos vp
        where vp.negocio_id = t.negocio_id and vp.turno_caja_id = t.id
          and vp.metodo_tipo = 'EFECTIVO'), 0)
    - coalesce((select sum(e.monto) from public.egresos e
        where e.negocio_id = t.negocio_id and e.turno_caja_id = t.id
          and e.cuenta_origen_id = t.cuenta_financiera_id), 0)
    + coalesce((select sum(m.importe) from public.movimientos_financieros m
        where m.negocio_id = t.negocio_id and m.turno_caja_id = t.id
          and m.cuenta_financiera_id = t.cuenta_financiera_id
          and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO')), 0)
    from public.turnos_caja t
   where t.negocio_id = v_negocio
     and t.id = any(coalesce(p_turno_ids, '{}'::uuid[]));
end;
$$;


ALTER FUNCTION "public"."efectivo_actual_turnos"("p_turno_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."egreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_tipo = 'OPERATIVO' then -p_monto else 0 end;
$$;


ALTER FUNCTION "public"."egreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."egreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) IS 'Cuánto resta del resultado un egreso según su tipo. Solo OPERATIVO. Espejo de esGastoDelNegocio en tipo-egreso.ts.';



CREATE OR REPLACE FUNCTION "public"."egresos_solo_descriptivo_editable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if row(old.negocio_id, old.monto, old.tipo, old.cuenta_origen_id,
         old.turno_caja_id, old.orden_compra_id, old.fecha, old.creado_por)
     is distinct from
     row(new.negocio_id, new.monto, new.tipo, new.cuenta_origen_id,
         new.turno_caja_id, new.orden_compra_id, new.fecha, new.creado_por) then
    raise exception 'EGRESO_SOLO_CATEGORIA_Y_CONCEPTO_EDITABLES'
      using hint = 'Para corregir monto, tipo o cuenta, anulá el gasto y registralo de nuevo.';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."egresos_solo_descriptivo_editable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eliminar_productos"("p_producto_ids" "uuid"[]) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_borrados integer;
begin
  if p_producto_ids is null or array_length(p_producto_ids, 1) is null then
    return 0;
  end if;

  perform public.marcar_origen_movimiento('BAJA_PRODUCTO', null);

  delete from public.productos
  where id = any (p_producto_ids);

  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;


ALTER FUNCTION "public"."eliminar_productos"("p_producto_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."eliminar_productos"("p_producto_ids" "uuid"[]) IS 'Borra productos declarando el origen BAJA_PRODUCTO en la misma transaccion, para que la baja de stock que cascadea quede fechada y explicada en movimientos_stock. SECURITY INVOKER: el permiso lo sigue decidiendo la RLS.';



CREATE OR REPLACE FUNCTION "public"."embudo_de_alta"() RETURNS TABLE("id" "uuid", "email" "text", "registrado" timestamp with time zone, "confirmado" timestamp with time zone, "ultima_sesion" timestamp with time zone, "vio_formulario" timestamp with time zone, "negocio_creado" timestamp with time zone, "miembro_de_algun_negocio" boolean, "invitacion_pendiente" boolean, "es_super_admin" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'security'
    AS $$
  select
    u.id, u.email::text, u.created_at, u.email_confirmed_at, u.last_sign_in_at,
    (select o.visto_en from public.onboarding_pasos_vistos o
      where o.usuario_id = u.id and o.paso = 'PASO_2_NEGOCIO'),
    (select min(n.created_at) from public.usuarios_negocios un
       join public.negocios n on n.id = un.negocio_id
      where un.usuario_id = u.id and un.es_owner),
    exists (select 1 from public.usuarios_negocios un where un.usuario_id = u.id),
    exists (select 1 from public.invitaciones i
             where lower(i.email) = lower(u.email) and i.estado = 'PENDIENTE'),
    security.es_super_admin(u.id)
  from auth.users u
  where security.is_super_admin()
  order by u.created_at desc;
$$;


ALTER FUNCTION "public"."embudo_de_alta"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."embudo_de_alta"() IS 'Hechos crudos del embudo de alta (registro -> confirmacion -> sesion -> vio el formulario -> negocio), una fila por usuario de auth.users. Solo super admin. Las metricas se calculan en features/admin/lib/embudo-alta.ts. Ver 20260909120000 y 20260909140000.';



CREATE OR REPLACE FUNCTION "public"."emitir_comprobante_venta"("p_venta_id" "uuid", "p_tipo" "text", "p_punto_venta" integer, "p_total" numeric, "p_emitido_por" "uuid", "p_cliente_id" "uuid" DEFAULT NULL::"uuid", "p_receptor_razon_social" "text" DEFAULT NULL::"text", "p_receptor_cuit" "text" DEFAULT NULL::"text", "p_receptor_condicion_iva" "text" DEFAULT NULL::"text") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_numero bigint;
begin
  -- Numeración: EXACTAMENTE el mismo insert...on conflict que
  -- siguiente_numero_comprobante. Es un solo statement, así que el row lock
  -- que serializa dos cajas vendiendo a la vez sigue siendo el mismo.
  -- Nunca un max(numero) + 1.
  insert into public.comprobante_numeracion as n
    (punto_venta, tipo, ultimo_numero)
  values (p_punto_venta, p_tipo, 1)
  on conflict (negocio_id, punto_venta, tipo) do update
    set ultimo_numero = n.ultimo_numero + 1,
        actualizado_en = now()
  returning n.ultimo_numero into v_numero;

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    neto, iva_monto, total, emitido_por
  ) values (
    p_venta_id, p_tipo, p_punto_venta, v_numero,
    p_cliente_id, p_receptor_razon_social, p_receptor_cuit, p_receptor_condicion_iva,
    0, 0, p_total, p_emitido_por
  );

  return v_numero;
end;
$$;


ALTER FUNCTION "public"."emitir_comprobante_venta"("p_venta_id" "uuid", "p_tipo" "text", "p_punto_venta" integer, "p_total" numeric, "p_emitido_por" "uuid", "p_cliente_id" "uuid", "p_receptor_razon_social" "text", "p_receptor_cuit" "text", "p_receptor_condicion_iva" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."emitir_comprobante_venta"("p_venta_id" "uuid", "p_tipo" "text", "p_punto_venta" integer, "p_total" numeric, "p_emitido_por" "uuid", "p_cliente_id" "uuid", "p_receptor_razon_social" "text", "p_receptor_cuit" "text", "p_receptor_condicion_iva" "text") IS 'Numera y graba el comprobante de una venta en UN round-trip. Antes eran dos (siguiente_numero_comprobante + insert), ~140 ms en TODA venta. SECURITY INVOKER a proposito: el aislamiento sigue siendo la RLS del que llama, igual que registrar_venta. Al ir en una transaccion, si el insert falla el numero tambien se revierte: ya no quedan huecos en la numeracion.';



CREATE OR REPLACE FUNCTION "public"."estado_activacion"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select case
    when not public.is_admin() then null::jsonb
    else jsonb_build_object(
      'rubro', coalesce(
        (select c.rubro from public.configuracion_pos c limit 1),
        'indumentaria'
      ),
      'marca', (
        select coalesce(btrim(c."posLogo"), '') <> ''
           and coalesce(btrim(c.whatsapp), '') <> ''
        from public.configuracion_pos c limit 1
      ),
      'metodos_pago', exists (
        select 1 from public.metodos_pago m where m.activo
      ),
      'productos', exists (select 1 from public.productos p),
      -- `producto_variantes.precio` es un OVERRIDE: vale 0 salvo que la
      -- variante cueste distinto del producto. Sin el coalesce contra
      -- productos.precio, comercios que venden a diario daban "te falta poner
      -- precios".
      'stock_y_precios', exists (
        select 1
        from public.producto_variantes v
        join public.productos p on p.id = v.producto_id
        where v.activa
          and v.stock > 0
          and coalesce(nullif(v.precio, 0), p.precio, 0) > 0
      ),
      'empleados', (
        select count(*) > 1 from public.usuarios_negocios u
        where u.negocio_id = security.current_negocio_id()
      ),
      'catalogo_publicado', (
        select coalesce(c.catalogo_activo, false) from public.configuracion_pos c limit 1
      ) and exists (
        select 1 from public.productos p where p.publicado
      ),
      'caja', exists (select 1 from public.turnos_caja t),
      'primera_venta', exists (select 1 from public.ventas ven)
    )
  end;
$$;


ALTER FUNCTION "public"."estado_activacion"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."estado_activacion"() IS 'Checklist de activación del negocio activo, derivado de datos reales (sin flags persistidos). Devuelve null si el usuario no es ADMIN.';



CREATE OR REPLACE FUNCTION "public"."estado_activacion_de"("p_negocio" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
  select case
    when not security.is_super_admin() then null::jsonb
    else jsonb_build_object(
      'rubro', coalesce(
        (select c.rubro from public.configuracion_pos c
          where c.negocio_id = p_negocio limit 1),
        'indumentaria'
      ),
      'marca', coalesce((
        select coalesce(btrim(c."posLogo"), '') <> ''
           and coalesce(btrim(c.whatsapp), '') <> ''
        from public.configuracion_pos c where c.negocio_id = p_negocio limit 1
      ), false),
      'metodos_pago', exists (
        select 1 from public.metodos_pago m
        where m.negocio_id = p_negocio and m.activo
      ),
      'productos', exists (
        select 1 from public.productos p where p.negocio_id = p_negocio
      ),
      'stock_y_precios', exists (
        select 1
        from public.producto_variantes v
        join public.productos p on p.id = v.producto_id
        where v.negocio_id = p_negocio
          and v.activa
          and v.stock > 0
          and coalesce(nullif(v.precio, 0), p.precio, 0) > 0
      ),
      'empleados', (
        select count(*) > 1 from public.usuarios_negocios u
        where u.negocio_id = p_negocio
      ),
      'catalogo_publicado', coalesce((
        select c.catalogo_activo from public.configuracion_pos c
        where c.negocio_id = p_negocio limit 1
      ), false) and exists (
        select 1 from public.productos p
        where p.negocio_id = p_negocio and p.publicado
      ),
      'caja', exists (
        select 1 from public.turnos_caja t where t.negocio_id = p_negocio
      ),
      'primera_venta', exists (
        select 1 from public.ventas ven where ven.negocio_id = p_negocio
      )
    )
  end;
$$;


ALTER FUNCTION "public"."estado_activacion_de"("p_negocio" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."estado_activacion_de"("p_negocio" "uuid") IS 'Espejo de estado_activacion() con el negocio explicito, para el panel de Comerz. Solo super admin.';



CREATE OR REPLACE FUNCTION "public"."estado_cuentas_financieras"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$ declare v_negocio uuid:=security.current_negocio_id(); v_out jsonb; begin if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if; if not public.tiene_permiso('caja.ver_gerencial') then raise exception 'SIN_PERMISO' using errcode='42501'; end if; select jsonb_build_object('cuentas',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'codigo',c.codigo,'nombre',c.nombre,'tipo',c.tipo,'es_efectivo',c.es_efectivo,'requiere_arqueo',c.requiere_arqueo,'es_sistema',c.es_sistema,'activa',c.activa) order by c.es_sistema desc,c.nombre) from public.cuentas_financieras c where c.negocio_id=v_negocio and c.activa and c.tipo<>'PUENTE_ACREDITACION'),'[]'::jsonb),'transferencias',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'monto',x.monto,'concepto',x.concepto,'fecha',x.fecha,'origen_nombre',o.nombre,'destino_nombre',d.nombre,'registrado_por_nombre',p.nombre,'revierte_a',x.revierte_a,'revertida_por',(select r.id from public.transferencias_financieras r where r.revierte_a=x.id)) order by x.fecha desc) from(select * from public.transferencias_financieras where negocio_id=v_negocio order by fecha desc limit 20)x join public.cuentas_financieras o on o.id=x.cuenta_origen_id join public.cuentas_financieras d on d.id=x.cuenta_destino_id left join public.perfiles p on p.id=x.registrado_por),'[]'::jsonb)) into v_out; return v_out; end; $$;


ALTER FUNCTION "public"."estado_cuentas_financieras"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flujo_caja_turno"("p_turno_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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
    -- Sin mirar el estado del cobro: esa plata entro al cajon. Si volvio,
    -- volvio por el egreso de la devolucion, que se resta abajo.
    coalesce((select sum(vp.monto_bruto)
      from public.venta_pagos vp
      where vp.negocio_id = t.negocio_id
        and vp.turno_caja_id = t.id
        and vp.metodo_tipo = 'EFECTIVO'), 0)
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
        and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO')), 0)
    into v_flujo
    from public.turnos_caja t
   where t.id = p_turno_id and t.negocio_id = v_negocio;
  return coalesce(v_flujo, 0);
end;
$$;


ALTER FUNCTION "public"."flujo_caja_turno"("p_turno_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."funnel_comerz"() RETURNS TABLE("id" "uuid", "nombre" "text", "estado" "text", "alta" timestamp with time zone, "primera_venta" timestamp with time zone, "ultima_venta" timestamp with time zone, "ventas_total" bigint, "pagos" bigint, "primer_pago" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    n.id,
    n.nombre,
    n.estado,
    n.created_at as alta,
    (select min(v.fecha_venta) from public.ventas v
      where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
    (select max(v.fecha_venta) from public.ventas v
      where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
    (select count(*) from public.ventas v
      where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
    (select count(*) from public.pagos_suscripcion p where p.negocio_id = n.id),
    (select min(p.fecha_pago) from public.pagos_suscripcion p where p.negocio_id = n.id)
  from public.negocios n
  -- SECURITY DEFINER: sin este filtro cualquiera que llame la funcion ve TODOS
  -- los negocios. El corte es explicito y es lo unico que la protege, porque
  -- definer se saltea RLS.
  where security.is_super_admin()
  order by n.created_at;
$$;


ALTER FUNCTION "public"."funnel_comerz"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."funnel_comerz"() IS 'Hechos crudos por negocio para el funnel registro -> activacion -> pago. Devuelve fechas y conteos, NO metricas derivadas: los dias hasta activacion y quien cuenta como migrado se calculan en funnel.ts, que tiene tests.';



CREATE OR REPLACE FUNCTION "public"."fusionar_productos"("p_origen" "uuid", "p_destino" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_negocio_origen  uuid;
  v_negocio_destino uuid;
  v_movidas int := 0;
  v_sumadas int := 0;
  v_ventas  int := 0;
  v_borrado int;
  v_unidades_antes numeric;
  v_unidades_despues numeric;
  r record;
  v_gemela uuid;
begin
  if p_origen = p_destino then
    raise exception 'MISMO_PRODUCTO';
  end if;

  perform 1 from public.productos
   where id in (p_origen, p_destino)
   order by id
     for update;

  select negocio_id into v_negocio_origen  from public.productos where id = p_origen;
  select negocio_id into v_negocio_destino from public.productos where id = p_destino;

  if v_negocio_origen is null or v_negocio_destino is null then
    raise exception 'PRODUCTO_NO_ENCONTRADO';
  end if;

  if v_negocio_origen <> v_negocio_destino then
    raise exception 'NEGOCIOS_DISTINTOS';
  end if;

  select coalesce(sum(stock), 0) into v_unidades_antes
  from public.producto_variantes where producto_id in (p_origen, p_destino);

  perform set_config('comerz.origen_movimiento', 'EDICION_VARIANTES', true);

  for r in
    select pv.id, pv.stock, pv.nombre_display,
           public.atributos_comparables(pv.atributos) as identidad
    from public.producto_variantes pv
    where pv.producto_id = p_origen
  loop
    select d.id into v_gemela
    from public.producto_variantes d
    where d.producto_id = p_destino
      and public.atributos_comparables(d.atributos) = r.identidad
    limit 1;

    if v_gemela is null then
      update public.producto_variantes set producto_id = p_destino where id = r.id;
      v_movidas := v_movidas + 1;
    else
      update public.ventas_items
         set variante_id = v_gemela
       where variante_id = r.id;

      insert into public.variantes_fusionadas (
        negocio_id, producto_id, clave,
        variante_id_eliminada, variante_id_sobrevive,
        fila_eliminada, stock_antes_sobrevive, stock_despues
      )
      select v_negocio_origen, p_destino, r.identidad,
             r.id, v_gemela,
             to_jsonb(pv), pv.stock, pv.stock + coalesce(r.stock, 0)
      from public.producto_variantes pv where pv.id = v_gemela;

      update public.producto_variantes
         set stock = stock + coalesce(r.stock, 0)
       where id = v_gemela;

      delete from public.producto_variantes where id = r.id;
      v_sumadas := v_sumadas + 1;
    end if;
  end loop;

  update public.ventas_items set producto_id = p_destino where producto_id = p_origen;
  get diagnostics v_ventas = row_count;

  update public.ordenes_items set producto_id = p_destino where producto_id = p_origen;
  update public.actualizaciones_precio_items set producto_id = p_destino where producto_id = p_origen;
  update public.producto_variantes_auditoria set producto_id = p_destino where producto_id = p_origen;
  update public.reservas set producto_id = p_destino where producto_id = p_origen;
  update public.bajas set producto_id = p_destino where producto_id = p_origen;
  update public.producto_precios set producto_id = p_destino where producto_id = p_origen;

  insert into public.diccionario_alias (proveedor, raw_nombre, producto_id, negocio_id)
  select da.proveedor, da.raw_nombre, p_destino, da.negocio_id
  from public.diccionario_alias da
  where da.producto_id = p_origen
  on conflict (negocio_id, proveedor, raw_nombre) do nothing;

  delete from public.diccionario_alias where producto_id = p_origen;

  update public.promociones_productos pp
     set producto_id = p_destino
   where pp.producto_id = p_origen
     and not exists (
       select 1 from public.promociones_productos otra
       where otra.promocion_id = pp.promocion_id and otra.producto_id = p_destino
     );
  delete from public.promociones_productos where producto_id = p_origen;

  delete from public.productos_stock where producto_id = p_origen;

  update public.productos_stock ps
     set cantidad = pv.stock
    from public.producto_variantes pv
   where pv.producto_id = p_destino
     and ps.producto_id = p_destino
     and ps.variante = pv.nombre_display;

  insert into public.productos_stock (producto_id, variante, cantidad, negocio_id)
  select p_destino, pv.nombre_display, pv.stock, v_negocio_destino
  from public.producto_variantes pv
  where pv.producto_id = p_destino
    and not exists (
      select 1 from public.productos_stock ps
      where ps.producto_id = p_destino and ps.variante = pv.nombre_display
    );

  delete from public.productos where id = p_origen;
  get diagnostics v_borrado = row_count;

  if v_borrado = 0 then
    raise exception 'SIN_PERMISO_PARA_BORRAR';
  end if;

  select coalesce(sum(stock), 0) into v_unidades_despues
  from public.producto_variantes where producto_id = p_destino;

  if v_unidades_despues <> v_unidades_antes then
    raise exception 'UNIDADES_NO_CIERRAN: antes % despues %',
      v_unidades_antes, v_unidades_despues;
  end if;

  return jsonb_build_object(
    'ok', true,
    'variantes_movidas', v_movidas,
    'variantes_sumadas', v_sumadas,
    'ventas_reapuntadas', v_ventas,
    'unidades', v_unidades_despues,
    'variantes_finales',
      (select count(*) from public.producto_variantes where producto_id = p_destino)
  );
end;
$$;


ALTER FUNCTION "public"."fusionar_productos"("p_origen" "uuid", "p_destino" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fusionar_productos"("p_origen" "uuid", "p_destino" "uuid") IS 'Funde el producto origen dentro del destino y lo borra: mueve variantes, SUMA las que coinciden por atributos_comparables, y reapunta ventas, remitos, alias, promos, reservas y auditoria antes del borrado. SECURITY INVOKER: el permiso lo decide la RLS. Irreversible. Ver 20260910180000.';



CREATE OR REPLACE FUNCTION "public"."guardar_variantes_producto"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_antes     jsonb;
  v_despues   jsonb;
  v_resultado jsonb;
begin
  select coalesce(jsonb_object_agg(
           public.atributos_comparables(pv.atributos),
           jsonb_build_object('id', pv.id, 'stock', coalesce(pv.stock, 0))
         ), '{}'::jsonb)
    into v_antes
    from public.producto_variantes pv
   where pv.producto_id = p_producto_id
     and pv.negocio_id  = p_negocio_id;

  perform set_config('comerz.omitir_movimiento', 'on', true);

  v_resultado := public.guardar_variantes_producto_impl(
    p_producto_id, p_negocio_id, p_variantes, p_editado_por, p_confirmadas_eliminar
  );

  perform set_config('comerz.omitir_movimiento', '', true);

  if coalesce((v_resultado->>'blocked')::boolean, false) then
    return v_resultado;
  end if;

  select coalesce(jsonb_object_agg(
           public.atributos_comparables(pv.atributos),
           jsonb_build_object('id', pv.id, 'stock', coalesce(pv.stock, 0))
         ), '{}'::jsonb)
    into v_despues
    from public.producto_variantes pv
   where pv.producto_id = p_producto_id
     and pv.negocio_id  = p_negocio_id;

  insert into public.movimientos_stock (
    negocio_id, variante_id, producto_id,
    delta, stock_anterior, stock_nuevo,
    origen, referencia_id, usuario_id
  )
  select
    p_negocio_id,
    coalesce((v_despues->clave->>'id')::uuid, (v_antes->clave->>'id')::uuid),
    p_producto_id,
    despues - antes,
    antes,
    despues,
    'EDICION_VARIANTES',
    p_producto_id,
    p_editado_por
  from (
    select
      clave,
      coalesce((v_antes  ->clave->>'stock')::numeric, 0) as antes,
      coalesce((v_despues->clave->>'stock')::numeric, 0) as despues
    from (
      select jsonb_object_keys(v_antes) as clave
      union
      select jsonb_object_keys(v_despues)
    ) claves
  ) cambios
  where despues <> antes;

  return v_resultado;
end;
$$;


ALTER FUNCTION "public"."guardar_variantes_producto"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guardar_variantes_producto_impl"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb" DEFAULT '[]'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_existentes jsonb;
  v_faltantes_no_confirmados int := 0;
  v_existente jsonb;
  v_nueva jsonb;
  v_new_id uuid;
  v_stock_input text;
  v_stock numeric(12,3);
  v_relacion jsonb;
  v_auditoria jsonb[] := '{}';
  v_confirmada boolean;
  v_claves_entrantes text[] := '{}';
  v_clave text;
BEGIN
  IF p_negocio_id IS NULL THEN
    RAISE EXCEPTION 'guardar_variantes_producto requiere un negocio activo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.productos
    WHERE id = p_producto_id AND negocio_id = p_negocio_id
  ) THEN
    RAISE EXCEPTION 'El producto no pertenece al negocio activo';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', pv.id,
           'atributos', pv.atributos,
           'clave', public.atributos_comparables(pv.atributos),
           'nombre_display', pv.nombre_display,
           'precio', pv.precio,
           'costo', pv.costo,
           'stock', pv.stock
         )), '[]'::jsonb)
    INTO v_existentes
    FROM public.producto_variantes pv
    WHERE pv.producto_id = p_producto_id
      AND pv.negocio_id = p_negocio_id;

  FOR v_existente IN SELECT * FROM jsonb_array_elements(v_existentes)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_variantes) AS nv
      WHERE public.atributos_comparables(nv->'atributos') = (v_existente->>'clave')
    ) THEN
      v_confirmada := EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_confirmadas_eliminar) AS ce
        WHERE public.atributos_comparables(ce) = (v_existente->>'clave')
      );

      IF NOT v_confirmada AND coalesce((v_existente->>'stock')::numeric, 0) > 0 THEN
        v_faltantes_no_confirmados := v_faltantes_no_confirmados + 1;

        INSERT INTO public.producto_variantes_auditoria (
          negocio_id, producto_id, variante_id_anterior, variante_id_nueva,
          atributos, nombre_display, accion, stock_anterior, stock_nuevo,
          precio_anterior, precio_nuevo, costo_anterior, costo_nuevo,
          editado_por
        ) VALUES (
          p_negocio_id,
          p_producto_id,
          (v_existente->>'id')::uuid,
          NULL,
          v_existente->'atributos',
          v_existente->>'nombre_display',
          'BLOQUEADO_FALTANTE',
          (v_existente->>'stock')::numeric,
          NULL,
          (v_existente->>'precio')::numeric,
          NULL,
          (v_existente->>'costo')::numeric,
          NULL,
          p_editado_por
        );
      END IF;
    END IF;
  END LOOP;

  IF v_faltantes_no_confirmados > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'blocked', true,
      'faltantes', v_faltantes_no_confirmados
    );
  END IF;

  DELETE FROM public.productos_stock
   WHERE producto_id = p_producto_id AND negocio_id = p_negocio_id;

  FOR v_nueva IN SELECT * FROM jsonb_array_elements(p_variantes)
  LOOP
    v_clave := public.atributos_comparables(v_nueva->'atributos');

    CONTINUE WHEN v_clave = ANY (v_claves_entrantes);

    SELECT ve INTO v_existente
      FROM jsonb_array_elements(v_existentes) AS ve
      WHERE (ve->>'clave') = v_clave
      LIMIT 1;

    v_claves_entrantes := v_claves_entrantes || v_clave;

    v_stock_input := NULLIF(trim(v_nueva->>'stock_input'), '');
    IF v_stock_input IS NOT NULL THEN
      v_stock := replace(v_stock_input, ',', '.')::numeric;
    ELSE
      v_stock := coalesce((v_existente->>'stock')::numeric, 0);
    END IF;

    IF v_existente IS NULL THEN
      INSERT INTO public.producto_variantes (
        negocio_id, producto_id, nombre_display, atributos, precio, costo, stock, sku
      ) VALUES (
        p_negocio_id,
        p_producto_id,
        v_nueva->>'nombre_display',
        v_nueva->'atributos',
        NULLIF(v_nueva->>'precio', '')::numeric,
        NULLIF(v_nueva->>'costo', '')::numeric,
        v_stock,
        NULLIF(v_nueva->>'sku', '')
      )
      RETURNING id INTO v_new_id;
    ELSE
      UPDATE public.producto_variantes
         SET nombre_display = v_nueva->>'nombre_display',
             atributos      = v_nueva->'atributos',
             precio         = NULLIF(v_nueva->>'precio', '')::numeric,
             costo          = NULLIF(v_nueva->>'costo', '')::numeric,
             stock          = v_stock,
             sku            = NULLIF(v_nueva->>'sku', ''),
             updated_at     = now()
       WHERE id = (v_existente->>'id')::uuid
      RETURNING id INTO v_new_id;

      DELETE FROM public.producto_variante_valores
       WHERE variante_id = v_new_id;
    END IF;

    FOR v_relacion IN SELECT * FROM jsonb_array_elements(coalesce(v_nueva->'relaciones', '[]'::jsonb))
    LOOP
      INSERT INTO public.producto_variante_valores (
        negocio_id, variante_id, atributo_id, atributo_valor_id
      )
      VALUES (
        p_negocio_id,
        v_new_id,
        (v_relacion->>'atributo_id')::uuid,
        (v_relacion->>'atributo_valor_id')::uuid
      );
    END LOOP;

    INSERT INTO public.productos_stock (negocio_id, producto_id, variante, cantidad)
    VALUES (p_negocio_id, p_producto_id, v_nueva->>'nombre_display', v_stock);

    v_auditoria := v_auditoria || jsonb_build_object(
      'producto_id', p_producto_id,
      'variante_id_anterior', v_existente->>'id',
      'variante_id_nueva', v_new_id,
      'atributos', v_nueva->'atributos',
      'nombre_display', v_nueva->>'nombre_display',
      'accion', CASE WHEN v_existente IS NULL THEN 'CREADA' ELSE 'ACTUALIZADA' END,
      'stock_anterior', v_existente->>'stock',
      'stock_nuevo', v_stock,
      'precio_anterior', v_existente->>'precio',
      'precio_nuevo', NULLIF(v_nueva->>'precio', ''),
      'costo_anterior', v_existente->>'costo',
      'costo_nuevo', NULLIF(v_nueva->>'costo', ''),
      'editado_por', p_editado_por
    );

    v_existente := NULL;
  END LOOP;

  FOR v_existente IN SELECT * FROM jsonb_array_elements(v_existentes)
  LOOP
    IF NOT ((v_existente->>'clave') = ANY (v_claves_entrantes)) THEN
      DELETE FROM public.producto_variantes
       WHERE id = (v_existente->>'id')::uuid;

      v_auditoria := v_auditoria || jsonb_build_object(
        'producto_id', p_producto_id,
        'variante_id_anterior', v_existente->>'id',
        'variante_id_nueva', NULL,
        'atributos', v_existente->'atributos',
        'nombre_display', v_existente->>'nombre_display',
        'accion', 'ELIMINADA',
        'stock_anterior', v_existente->>'stock',
        'stock_nuevo', NULL,
        'precio_anterior', v_existente->>'precio',
        'precio_nuevo', NULL,
        'costo_anterior', v_existente->>'costo',
        'costo_nuevo', NULL,
        'editado_por', p_editado_por
      );
    END IF;
  END LOOP;

  INSERT INTO public.producto_variantes_auditoria (
    negocio_id, producto_id, variante_id_anterior, variante_id_nueva, atributos,
    nombre_display, accion, stock_anterior, stock_nuevo,
    precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, editado_por
  )
  SELECT
    p_negocio_id,
    (a->>'producto_id')::uuid,
    (a->>'variante_id_anterior')::uuid,
    (a->>'variante_id_nueva')::uuid,
    a->'atributos',
    a->>'nombre_display',
    a->>'accion',
    (a->>'stock_anterior')::numeric,
    (a->>'stock_nuevo')::numeric,
    (a->>'precio_anterior')::numeric,
    (a->>'precio_nuevo')::numeric,
    (a->>'costo_anterior')::numeric,
    (a->>'costo_nuevo')::numeric,
    (a->>'editado_por')::uuid
  FROM unnest(v_auditoria) AS a;

  RETURN jsonb_build_object('success', true, 'blocked', false);
END;
$$;


ALTER FUNCTION "public"."guardar_variantes_producto_impl"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guardar_variantes_producto_impl"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") IS 'Guarda las variantes de un producto haciendo UPSERT por identidad (atributos_comparables), no borrando y reinsertando: los UUID de variante sobreviven a la edicion. Ver 20260902110000.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.perfiles (id, email, nombre)
  VALUES (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."impedir_mutacion_movimiento_financiero"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$begin raise exception 'BITACORA_FINANCIERA_APPEND_ONLY'; end;$$;


ALTER FUNCTION "public"."impedir_mutacion_movimiento_financiero"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."importar_productos_planilla"("p_negocio_id" "uuid", "p_items" "jsonb", "p_hash" "text", "p_nombre_archivo" "text" DEFAULT NULL::"text", "p_forzar" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_item jsonb;

  v_importacion_id uuid;
  v_previa jsonb;

  v_fila integer;
  v_producto_nombre text;
  v_clave_producto text;
  v_clave_variante text;
  v_producto_id uuid;
  v_variante_id uuid;
  v_nombre_display text;
  v_imei text;
  v_stock integer;
  v_stock_final integer;
  v_sku text;
  v_rows integer;

  v_ok boolean;
  v_detalle text;

  v_producto_por_clave jsonb := '{}'::jsonb;
  v_variante_por_clave jsonb := '{}'::jsonb;

  v_resultados jsonb := '[]'::jsonb;
  v_productos_creados integer := 0;
  v_variantes_creadas integer := 0;
  v_filas_ok integer := 0;
begin
  if p_negocio_id is null then
    raise exception 'importar_productos_planilla requiere un negocio activo';
  end if;
  if coalesce(trim(p_hash), '') = '' then
    raise exception 'importar_productos_planilla requiere el hash del archivo';
  end if;

  insert into public.importaciones_productos (
    negocio_id, hash, nombre_archivo, forzada, filas_totales, importado_por
  )
  values (
    p_negocio_id,
    p_hash,
    nullif(trim(coalesce(p_nombre_archivo, '')), ''),
    coalesce(p_forzar, false),
    jsonb_array_length(p_items),
    auth.uid()
  )
  on conflict do nothing
  returning id into v_importacion_id;

  if v_importacion_id is null then
    select jsonb_build_object(
             'id', i.id,
             'creado_en', i.creado_en,
             'nombre_archivo', i.nombre_archivo,
             'filas_totales', i.filas_totales,
             'filas_ok', i.filas_ok,
             'filas_error', i.filas_error
           )
      into v_previa
      from public.importaciones_productos i
     where i.negocio_id = p_negocio_id
       and i.hash = p_hash
       and not i.forzada
     limit 1;

    return jsonb_build_object(
      'ya_importada', true,
      'importacion_previa', v_previa,
      'resultados', '[]'::jsonb,
      'productos_creados', 0,
      'variantes_creadas', 0
    );
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_fila := coalesce((v_item->>'fila')::integer, 0);
    v_producto_nombre := coalesce(v_item->>'producto', '');
    v_ok := true;
    v_detalle := '';

    begin
      v_clave_producto := coalesce(v_item->>'clave_producto', '');
      v_clave_variante := coalesce(v_item->>'clave_variante', '');
      v_imei := nullif(trim(coalesce(v_item->>'imei', '')), '');
      v_stock := coalesce((v_item->>'stock')::integer, 0);
      v_sku := nullif(trim(coalesce(v_item->>'codigo_barras', '')), '');

      v_producto_id := nullif(v_item->>'producto_id', '')::uuid;

      if v_producto_id is null then
        v_producto_id := nullif(v_producto_por_clave->>v_clave_producto, '')::uuid;
      end if;

      if v_producto_id is null then
        insert into public.productos (
          negocio_id, nombre, tipo, categoria_id, descripcion,
          precio, precio_costo, slug, publicado, atributos_globales
        )
        values (
          p_negocio_id,
          v_producto_nombre,
          coalesce(nullif(v_item->>'categoria_nombre', ''), 'General'),
          nullif(v_item->>'categoria_id', '')::uuid,
          '',
          coalesce((v_item->>'precio_venta')::numeric, 0),
          coalesce((v_item->>'precio_costo')::numeric, 0),
          v_item->>'slug',
          true,
          '{}'::jsonb
        )
        returning id into v_producto_id;

        v_producto_por_clave := v_producto_por_clave
          || jsonb_build_object(v_clave_producto, v_producto_id::text);
        v_productos_creados := v_productos_creados + 1;
      else
        perform 1 from public.productos
         where id = v_producto_id and negocio_id = p_negocio_id;
        if not found then
          raise exception 'El producto no pertenece al negocio activo';
        end if;
      end if;

      v_variante_id := nullif(v_item->>'variante_id', '')::uuid;

      if v_variante_id is null then
        v_variante_id := nullif(
          v_variante_por_clave->>(v_producto_id::text || '::' || v_clave_variante),
          ''
        )::uuid;
      end if;

      if v_variante_id is null then
        insert into public.producto_variantes (
          negocio_id, producto_id, nombre_display, atributos,
          precio, costo, stock, sku
        )
        values (
          p_negocio_id,
          v_producto_id,
          coalesce(nullif(v_item->>'nombre_display', ''), 'Único'),
          coalesce(v_item->'atributos', '{}'::jsonb),
          null,
          null,
          0,
          v_sku
        )
        returning id into v_variante_id;

        insert into public.producto_variante_valores (
          negocio_id, variante_id, atributo_id, atributo_valor_id
        )
        select
          p_negocio_id,
          v_variante_id,
          (rel->>'atributo_id')::uuid,
          (rel->>'atributo_valor_id')::uuid
        from jsonb_array_elements(coalesce(v_item->'relaciones', '[]'::jsonb)) as rel;

        v_variante_por_clave := v_variante_por_clave
          || jsonb_build_object(
               v_producto_id::text || '::' || v_clave_variante,
               v_variante_id::text
             );
        v_variantes_creadas := v_variantes_creadas + 1;
      end if;

      select nombre_display into v_nombre_display
        from public.producto_variantes
       where id = v_variante_id and negocio_id = p_negocio_id;

      if v_nombre_display is null then
        raise exception 'La variante no pertenece al negocio activo';
      end if;

      if v_imei is not null then
        insert into public.unidades_serie (
          negocio_id, producto_variante_id, imei, estado
        )
        values (p_negocio_id, v_variante_id, v_imei, 'disponible')
        on conflict (negocio_id, imei) do nothing;

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
          v_ok := false;
          v_detalle := 'El IMEI ' || v_imei
            || ' ya estaba cargado; no se sumó stock.';
        end if;
      end if;

      if v_ok then
        update public.producto_variantes
           set stock = stock + v_stock,
               updated_at = now()
         where id = v_variante_id
           and negocio_id = p_negocio_id
           and stock + v_stock >= 0
        returning stock into v_stock_final;

        if not found then
          v_ok := false;
          v_detalle := 'No se pudo ajustar el stock (la variante ya no existe o el stock quedaría negativo).';
        else
          insert into public.productos_stock (
            negocio_id, producto_id, variante, cantidad
          )
          values (p_negocio_id, v_producto_id, v_nombre_display, v_stock_final)
          on conflict (producto_id, variante)
          do update set cantidad = excluded.cantidad;

          if v_imei is not null then
            v_detalle := 'IMEI ' || v_imei || ' cargado (+1, stock '
              || v_stock_final || ').';
          else
            v_detalle := '+' || v_stock || ' unidades (stock '
              || v_stock_final || ').';
          end if;
        end if;
      end if;

    exception when others then
      v_ok := false;
      v_detalle := coalesce(sqlerrm, 'Error inesperado al procesar la fila.');
    end;

    if v_ok then
      v_filas_ok := v_filas_ok + 1;
    end if;

    v_resultados := v_resultados || jsonb_build_object(
      'fila', v_fila,
      'producto', v_producto_nombre,
      'ok', v_ok,
      'detalle', v_detalle
    );
  end loop;

  update public.importaciones_productos
     set filas_ok = v_filas_ok,
         filas_error = jsonb_array_length(p_items) - v_filas_ok
   where id = v_importacion_id;

  return jsonb_build_object(
    'ya_importada', false,
    'importacion_id', v_importacion_id,
    'resultados', v_resultados,
    'productos_creados', v_productos_creados,
    'variantes_creadas', v_variantes_creadas
  );
end;
$$;


ALTER FUNCTION "public"."importar_productos_planilla"("p_negocio_id" "uuid", "p_items" "jsonb", "p_hash" "text", "p_nombre_archivo" "text", "p_forzar" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."importar_productos_planilla"("p_negocio_id" "uuid", "p_items" "jsonb", "p_hash" "text", "p_nombre_archivo" "text", "p_forzar" boolean) IS 'Importa una planilla completa en una sola transacción, con cada fila atómica y con guard de idempotencia por (negocio_id, hash) ANTES de escribir stock. Devuelve {ya_importada: true} cuando el archivo ya se importó y no vino p_forzar. Recibe atributos YA canonicalizados desde Node.';



CREATE OR REPLACE FUNCTION "public"."importe_financiero_venta_pago"("p_metodo_tipo" "text", "p_monto_bruto" numeric, "p_monto_neto" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$select case when p_metodo_tipo='EFECTIVO' then p_monto_bruto else p_monto_neto end;$$;


ALTER FUNCTION "public"."importe_financiero_venta_pago"("p_metodo_tipo" "text", "p_monto_bruto" numeric, "p_monto_neto" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case when p_tipo = 'INGRESO_EXTRAORDINARIO' then p_monto else 0 end;
$$;


ALTER FUNCTION "public"."ingreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ingreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) IS 'Espejo SQL de features/caja/lib/tipo-ingreso.ts: solo INGRESO_EXTRAORDINARIO es resultado; APORTE_SOCIO y PRESTAMO solo mueven plata.';



CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT security.is_super_admin() OR EXISTS (
    SELECT 1
    FROM public.usuarios_negocios un
    JOIN public.roles r ON r.id = un.rol_id
    WHERE un.usuario_id = auth.uid()
      AND un.negocio_id = security.current_negocio_id()
      AND r.nombre = 'ADMIN'
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT security.is_super_admin();
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."limite_plan"("clave" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT nullif(public.reglas_plan() ->> clave, 'null')::int;
$$;


ALTER FUNCTION "public"."limite_plan"("clave" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_alerta_caja_revisada"("p_clave" "text", "p_nota" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."marcar_alerta_caja_revisada"("p_clave" "text", "p_nota" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_aprobacion_orden"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.estado = 'APROBADA' and coalesce(old.estado, '') <> 'APROBADA' then
    new.aprobado_en := now();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."marcar_aprobacion_orden"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_cambio_de_estado"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    NEW.estado_cambiado_en := now();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."marcar_cambio_de_estado"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_origen_movimiento"("p_origen" "text", "p_referencia" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  perform set_config('comerz.origen_movimiento', coalesce(p_origen, ''), true);
  perform set_config('comerz.referencia_movimiento', coalesce(p_referencia::text, ''), true);
end;
$$;


ALTER FUNCTION "public"."marcar_origen_movimiento"("p_origen" "text", "p_referencia" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."marcar_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."marcar_updated_at"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."marcar_updated_at"() IS 'BEFORE UPDATE: mantiene updated_at sin depender de que cada camino de escritura se acuerde. Ver 20260902170000 para por que es trigger y no una linea en cada RPC.';



CREATE OR REPLACE FUNCTION "public"."margen_realizado"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT NULL::"text", "p_limite" integer DEFAULT 15, "p_min_unidades" numeric DEFAULT 3) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_desde   date;
  v_hasta   date;
  v_limite  int := greatest(1, least(coalesce(p_limite, 15), 100));
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenes permiso para ver el margen'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;

  if p_periodo is not null then
    v_hasta := v_hoy;
    v_desde := case p_periodo
      when 'hoy'    then v_hoy
      when 'semana' then (date_trunc('week',  v_hoy)::date)
      when 'mes'    then (date_trunc('month', v_hoy)::date)
      when 'anio'   then (date_trunc('year',  v_hoy)::date)
      else v_hoy
    end;
  else
    v_hasta := coalesce(p_hasta, v_hoy);
    v_desde := coalesce(p_desde, v_hasta - 29);
  end if;

  with renglones as (
    select
      i.producto_id,
      i.cantidad,
      i.precio_unitario,
      i.precio_costo,
      i.precio_final    * i.cantidad as ingreso,
      i.precio_costo    * i.cantidad as costo,
      i.descuento_monto * i.cantidad as descuento,
      i.precio_unitario * i.cantidad as ingreso_sin_descuento,
      v.id                           as venta_id
    from public.ventas_items i
    join public.ventas v on v.id = i.venta_id
    where i.negocio_id = v_negocio
      and v.estado_operacion is distinct from 'ANULADA'
      and (v.fecha_venta at time zone v_tz)::date between v_desde and v_hasta
  ),
  por_producto as (
    select
      r.producto_id,
      coalesce(p.nombre, 'Producto eliminado') as producto,
      coalesce(c.nombre, 'Sin categoria')      as categoria,
      sum(r.cantidad)               as unidades,
      count(*)                      as renglones,
      sum(r.ingreso)                as ingreso,
      sum(r.costo)                  as costo,
      sum(r.ingreso) - sum(r.costo) as margen,
      sum(r.descuento)              as descuento
    from renglones r
    left join public.productos  p on p.id = r.producto_id
    left join public.categorias c on c.id = p.categoria_id
    group by r.producto_id, p.nombre, c.nombre
  ),
  rankeables as (
    select * from por_producto
     where costo > 0 and unidades >= p_min_unidades
  ),
  totales as (
    select
      coalesce(sum(ingreso), 0)              as ingreso,
      coalesce(sum(costo), 0)                as costo,
      coalesce(sum(ingreso) - sum(costo), 0) as margen,
      coalesce(sum(descuento), 0)            as descuento,
      coalesce(sum(unidades), 0)             as unidades,
      coalesce(sum(renglones), 0)            as renglones,
      count(*)                               as productos
    from por_producto
  ),
  markup as (
    select
      count(*)                                                            as renglones_con_costo,
      count(*) filter (where abs(precio_costo * 2 - precio_unitario) <= 1) as renglones_al_doble,
      count(distinct round(precio_unitario / nullif(precio_costo, 0), 2))  as markups_distintos
    from renglones
    where coalesce(precio_costo, 0) > 0
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', p_periodo,
    'generado_en', now(),
    'min_unidades', p_min_unidades,
    'totales', (
      select jsonb_build_object(
        'ingreso', round(t.ingreso, 2),
        'costo', round(t.costo, 2),
        'margen', round(t.margen, 2),
        'margen_pct', case when t.ingreso > 0 then round(t.margen * 100.0 / t.ingreso, 2) end,
        'descuento', round(t.descuento, 2),
        'unidades', t.unidades,
        'renglones', t.renglones,
        'productos', t.productos,
        'tickets', (select count(distinct venta_id) from renglones)
      )
      from totales t
    ),
    'descuentos', (
      select jsonb_build_object(
        'monto', round(t.descuento, 2),
        'pct_sobre_ingreso', case when t.ingreso > 0 then round(t.descuento * 100.0 / t.ingreso, 2) end,
        'tickets_con_descuento', (select count(distinct venta_id) from renglones where descuento > 0),
        'margen_pct_sin_descuento', case when (t.ingreso + t.descuento) > 0
          then round((t.margen + t.descuento) * 100.0 / (t.ingreso + t.descuento), 2) end
      )
      from totales t
    ),
    'dispersion_markup', (
      select jsonb_build_object(
        'renglones_con_costo', m.renglones_con_costo,
        'renglones_al_doble', m.renglones_al_doble,
        'pct_al_doble', case when m.renglones_con_costo > 0
          then round(m.renglones_al_doble * 100.0 / m.renglones_con_costo, 1) end,
        'markups_distintos', m.markups_distintos,
        'uniforme', (m.renglones_con_costo > 0
                     and m.renglones_al_doble * 100.0 / m.renglones_con_costo >= 80)
      )
      from markup m
    ),
    'por_categoria', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'categoria', categoria,
        'unidades', unidades,
        'productos', productos,
        'ingreso', round(ingreso, 2),
        'costo', round(costo, 2),
        'margen', round(margen, 2),
        'margen_pct', case when ingreso > 0 then round(margen * 100.0 / ingreso, 2) end
      ) order by margen desc), '[]'::jsonb)
      from (
        select categoria, sum(unidades) as unidades, count(*) as productos,
               sum(ingreso) as ingreso, sum(costo) as costo, sum(margen) as margen
          from por_producto group by categoria
      ) cat
    ),
    'mas_vendidos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'producto', producto, 'categoria', categoria, 'unidades', unidades,
        'ingreso', round(ingreso, 2), 'margen', round(margen, 2),
        'margen_pct', case when ingreso > 0 then round(margen * 100.0 / ingreso, 2) end
      ) order by unidades desc, ingreso desc), '[]'::jsonb)
      from (select * from por_producto order by unidades desc, ingreso desc limit v_limite) x
    ),
    'mayor_margen', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'producto', producto, 'categoria', categoria, 'unidades', unidades,
        'ingreso', round(ingreso, 2), 'margen', round(margen, 2),
        'margen_pct', case when ingreso > 0 then round(margen * 100.0 / ingreso, 2) end
      ) order by margen desc), '[]'::jsonb)
      from (select * from por_producto order by margen desc limit v_limite) x
    ),
    'menor_margen_pct', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'producto', producto, 'categoria', categoria, 'unidades', unidades,
        'ingreso', round(ingreso, 2), 'margen', round(margen, 2),
        'margen_pct', round(margen * 100.0 / ingreso, 2),
        'descuento', round(descuento, 2)
      ) order by margen / nullif(ingreso, 0)), '[]'::jsonb)
      from (
        select * from rankeables where ingreso > 0
         order by margen / nullif(ingreso, 0) limit v_limite
      ) x
    ),
    'base_insuficiente', jsonb_build_object(
      'por_pocas_unidades', (select count(*) from por_producto where costo > 0 and unidades < p_min_unidades),
      'por_costo_en_cero', (select count(*) from por_producto where coalesce(costo, 0) = 0)
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."margen_realizado"("p_desde" "date", "p_hasta" "date", "p_periodo" "text", "p_limite" integer, "p_min_unidades" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."margen_realizado"("p_desde" "date", "p_hasta" "date", "p_periodo" "text", "p_limite" integer, "p_min_unidades" numeric) IS 'Comerz Insights: margen de lo vendido, por producto y por categoria. Las columnas de ventas_items son UNITARIAS y aca van todas x cantidad. Devuelve dispersion_markup porque con precios al doble del costo el ranking por margen porcentual ordena por descuento, no por rentabilidad. Gate: caja.ver_gerencial.';



CREATE OR REPLACE FUNCTION "public"."metricas_globales_comerz"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_resultado jsonb;
begin
  if not security.is_super_admin() then
    raise exception 'SOLO_SUPER_ADMIN';
  end if;

  select jsonb_build_object(
    'negocios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id,
        'nombre', n.nombre,
        'estado', n.estado,
        'created_at', n.created_at,
        'plan_id', n.plan_id,
        'plan_nombre', pl.nombre,
        'plan_precio', coalesce(pl.precio_mensual, 0),
        'rubro', n.rubro_comercial,
        'usuarios', (select count(*) from public.usuarios_negocios u where u.negocio_id = n.id),
        'productos', (select count(*) from public.productos p where p.negocio_id = n.id),
        'ventas', (select count(*) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
        'facturado', (select coalesce(sum(v.total), 0) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA'),
        'ventas_30d', (select count(*) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA' and v.fecha_venta >= now() - interval '30 days'),
        'facturado_30d', (select coalesce(sum(v.total), 0) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA' and v.fecha_venta >= now() - interval '30 days'),
        'ultima_venta', (select max(v.fecha_venta) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA')
      ) order by n.created_at), '[]'::jsonb)
      from public.negocios n
      left join public.planes pl on pl.id = n.plan_id
    ),
    'planes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'precio_mensual', p.precio_mensual
      ) order by p.precio_mensual), '[]'::jsonb)
      from public.planes p
    ),
    'usuarios', (
      with personas as (
        select distinct un.usuario_id
        from public.usuarios_negocios un
        join public.negocios n on n.id = un.negocio_id
        where n.estado in ('activo', 'prueba')
      ),
      actividad as (
        select p.usuario_id,
               greatest(
                 (select u.last_sign_in_at from auth.users u where u.id = p.usuario_id),
                 (select max(s.updated_at) from auth.sessions s where s.user_id = p.usuario_id)
               ) as ultima
        from personas p
      )
      select jsonb_build_object(
        'total', (select count(*) from personas),
        'activos_7d', (select count(*) from actividad where ultima >= now() - interval '7 days'),
        'activos_30d', (select count(*) from actividad where ultima >= now() - interval '30 days'),
        'por_rol', (
          select coalesce(jsonb_object_agg(rol, n), '{}'::jsonb)
          from (
            select un.rol, count(distinct un.usuario_id) n
            from public.usuarios_negocios un
            join public.negocios ng on ng.id = un.negocio_id
            where ng.estado in ('activo', 'prueba')
            group by un.rol
          ) r
        )
      )
    ),
    'catalogo', (
      select jsonb_build_object(
        'productos', (select count(*) from public.productos p join public.negocios n on n.id = p.negocio_id where n.estado in ('activo', 'prueba')),
        'variantes', (select count(*) from public.producto_variantes v join public.negocios n on n.id = v.negocio_id where n.estado in ('activo', 'prueba')),
        'clientes', (select count(*) from public.clientes c join public.negocios n on n.id = c.negocio_id where n.estado in ('activo', 'prueba')),
        'deuda_cc_viva', (select coalesce(sum(c.saldo_pendiente), 0) from public.clientes c join public.negocios n on n.id = c.negocio_id where n.estado in ('activo', 'prueba') and c.saldo_pendiente > 0)
      )
    ),
    'ventas_por_mes', (
      select coalesce(jsonb_agg(jsonb_build_object('mes', mes, 'ventas', ventas, 'facturado', facturado) order by mes), '[]'::jsonb)
      from (
        select to_char(date_trunc('month', v.fecha_venta), 'YYYY-MM') mes,
               count(*) ventas,
               coalesce(sum(v.total), 0) facturado
        from public.ventas v
        join public.negocios n on n.id = v.negocio_id
        where v.estado_operacion <> 'ANULADA'
          and n.estado in ('activo', 'prueba')
          and v.fecha_venta >= date_trunc('month', now()) - interval '11 months'
        group by 1
      ) m
    ),
    'generado_en', now()
  ) into v_resultado;

  return v_resultado;
end;
$$;


ALTER FUNCTION "public"."metricas_globales_comerz"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."metricas_globales_comerz"() IS 'Métricas globales del SaaS para el panel de Comerz. Solo super admin: cruza tenants y lee auth.users.';



CREATE OR REPLACE FUNCTION "public"."modulo_presupuestos_habilitado"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
  select coalesce(
    (select n.modulo_presupuestos
       from public.negocios n
      where n.id = security.current_negocio_id()),
    false
  );
$$;


ALTER FUNCTION "public"."modulo_presupuestos_habilitado"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."modulo_presupuestos_habilitado"() IS 'true si el negocio activo tiene prendido el módulo de presupuestos. Fail-closed: sin negocio activo, false.';



CREATE OR REPLACE FUNCTION "public"."movimientos_de_cuenta"("p_cuenta_id" "uuid", "p_limite" integer DEFAULT 50) RETURNS TABLE("id" bigint, "fecha" timestamp with time zone, "evento" "text", "origen_tipo" "text", "importe" numeric, "descripcion" "text", "autor" "text", "en_turno" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

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


ALTER FUNCTION "public"."movimientos_de_cuenta"("p_cuenta_id" "uuid", "p_limite" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."movimientos_de_cuenta"("p_cuenta_id" "uuid", "p_limite" integer) IS 'Ultimos movimientos de una cuenta, con el nombre de quien los registro. Tope de 200 recortado en la base: el parametro viene del navegador.';



CREATE OR REPLACE FUNCTION "public"."movimientos_digitales_turno"("p_turno_id" "uuid") RETURNS TABLE("movimiento_id" bigint, "origen_tipo" "text", "evento" "text", "importe" numeric, "descripcion" "text", "cuenta_nombre" "text", "fecha_movimiento" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.operar')
     and not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  return query
  select m.id, m.origen_tipo, m.evento, m.importe, m.descripcion,
         c.nombre, m.fecha_movimiento
    from public.turnos_caja t
    join public.movimientos_financieros m
      on m.negocio_id = t.negocio_id
     and m.fecha_movimiento >= t.fecha_apertura
     and m.fecha_movimiento < coalesce(t.fecha_cierre, now())
    join public.cuentas_financieras c
      on c.id = m.cuenta_financiera_id
     and c.negocio_id = t.negocio_id
     and not c.es_efectivo
     and c.tipo <> 'PUENTE_ACREDITACION'
   where t.negocio_id = v_negocio
     and t.id = p_turno_id
     and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO', 'EGRESO', 'AJUSTE')
     and (t.modo = 'UNICA' or t.vendedor_id = auth.uid()
          or public.tiene_permiso('caja.cerrar_ajena'))
   order by m.fecha_movimiento desc, m.id desc;
end;
$$;


ALTER FUNCTION "public"."movimientos_digitales_turno"("p_turno_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."movimientos_digitales_turno"("p_turno_id" "uuid") IS 'Lo registrado en cuentas NO efectivo mientras el turno estuvo abierto, sin los cobros de venta (que son el total de la tarjeta) ni las patas de apertura/cierre. Ventana de TIEMPO, no turno_caja_id: un movimiento digital nunca lleva turno. No entra en el arqueo.';



CREATE OR REPLACE FUNCTION "public"."movimientos_financieros_negocio"("p_desde" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_hasta" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_cuenta_id" "uuid" DEFAULT NULL::"uuid", "p_origen_tipos" "text"[] DEFAULT NULL::"text"[], "p_categoria_id" "uuid" DEFAULT NULL::"uuid", "p_sin_categoria" boolean DEFAULT false, "p_metodo_pago_id" "uuid" DEFAULT NULL::"uuid", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_busqueda" "text" DEFAULT NULL::"text", "p_limite" integer DEFAULT 100, "p_offset" integer DEFAULT 0, "p_vista" "text" DEFAULT 'COMPLETA'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_limite integer := greatest(1, least(coalesce(p_limite, 100), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_busqueda text := nullif(btrim(p_busqueda), '');
  v_vista text := upper(coalesce(nullif(btrim(p_vista), ''), 'COMPLETA'));
  v_cuentas boolean;
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_out jsonb;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.ver_movimientos') then raise exception 'SIN_PERMISO' using errcode = '42501'; end if;
  if v_vista not in ('COMPLETA', 'CUENTAS') then raise exception 'VISTA_DESCONOCIDA'; end if;
  v_cuentas := v_vista = 'CUENTAS';
  if p_cuenta_id is not null and not exists (select 1 from public.cuentas_financieras c where c.id = p_cuenta_id and c.negocio_id = v_negocio) then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;
  with ledger as (
    select m.*, sum(m.importe) over (partition by m.cuenta_financiera_id order by m.fecha_movimiento, m.id rows between unbounded preceding and current row) as saldo_posterior
      from public.movimientos_financieros m
     where m.negocio_id = v_negocio and (p_cuenta_id is null or m.cuenta_financiera_id = p_cuenta_id)
  ),
  filtrado as (
    select l.* from ledger l
     where (p_desde is null or l.fecha_movimiento >= p_desde) and (p_hasta is null or l.fecha_movimiento < p_hasta)
       and (p_origen_tipos is null or l.origen_tipo = any (p_origen_tipos))
       and (p_usuario_id is null or l.registrado_por = p_usuario_id)
       and (p_metodo_pago_id is null or nullif(l.datos->>'metodo_pago_id', '')::uuid = p_metodo_pago_id)
       and (p_categoria_id is null or (l.origen_tipo = 'EGRESO' and exists (select 1 from public.egresos e where e.id = l.origen_id and e.negocio_id = v_negocio and e.categoria_id = p_categoria_id)))
       and (not coalesce(p_sin_categoria, false) or (l.origen_tipo = 'EGRESO' and exists (select 1 from public.egresos e where e.id = l.origen_id and e.negocio_id = v_negocio and e.tipo = 'OPERATIVO' and e.categoria_id is null)))
       and (v_busqueda is null or l.descripcion ilike '%' || v_busqueda || '%'
            or exists (select 1 from public.clientes cl where cl.negocio_id = v_negocio and cl.id = nullif(l.datos->>'cliente_id', '')::uuid and cl.nombre ilike '%' || v_busqueda || '%')
            or exists (select 1 from public.ordenes_compra oc where oc.id = l.orden_compra_id and oc.negocio_id = v_negocio and oc.proveedor ilike '%' || v_busqueda || '%'))
       and (not v_cuentas or l.origen_tipo not in ('EGRESO', 'INGRESO')
            or not exists (select 1 from public.cuentas_financieras c
                            where c.id = l.cuenta_financiera_id and c.negocio_id = v_negocio
                              and c.tipo = 'CAJA_DIARIA'))
       -- Mover plata entre dos cuentas propias es UN movimiento, no dos. Se
       -- muestra la pata negativa (de dónde salió) y la otra se esconde. Con
       -- `p_cuenta_id` no se colapsa: ahí la pregunta es qué movió esa cuenta.
       and (not v_cuentas or p_cuenta_id is not null
            or l.origen_tipo not in ('TRANSFERENCIA', 'TURNO_CAJA')
            or l.importe < 0
            or not exists (select 1 from ledger o
                            where o.operacion_id = l.operacion_id
                              and o.id <> l.id
                              and o.cuenta_financiera_id <> l.cuenta_financiera_id
                              and o.importe < 0))
  ),
  agrupado as (
    -- Los uuid van por array_agg y no por min(): Postgres no define min/max
    -- para uuid ni para jsonb. En un grupo de uno devuelve el único valor.
    select
      (array_agg(f.id order by f.fecha_movimiento desc, f.id desc))[1] as id,
      max(f.fecha_movimiento) as fecha_movimiento,
      max(f.registrado_en) as registrado_en,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' and count(*) > 1
           then 'CONSOLIDADO_DIA' else min(f.evento) end as evento,
      f.origen_tipo,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.origen_id order by f.id))[1] end as origen_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.operacion_id order by f.id))[1] end as operacion_id,
      sum(f.importe) as importe,
      sum(f.impacto_resultado) as impacto_resultado,
      (array_agg(f.saldo_posterior order by f.fecha_movimiento desc, f.id desc))[1] as saldo_posterior,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' and count(*) > 1
           then null else min(f.descripcion) end as descripcion,
      f.cuenta_financiera_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.turno_caja_id order by f.id))[1] end as turno_caja_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.orden_compra_id order by f.id))[1] end as orden_compra_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.datos order by f.id))[1] end as datos,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.registrado_por order by f.id))[1] end as registrado_por,
      count(*)::integer as cantidad
    from filtrado f
    group by
      f.cuenta_financiera_id,
      f.origen_tipo,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else f.id end,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then (f.fecha_movimiento at time zone v_tz)::date else null end
  ),
  contado as (select a.*, count(*) over () as total from agrupado a),
  pagina as (select * from contado order by fecha_movimiento desc, id desc limit v_limite offset v_offset),
  enriquecido as (
    select l.*, c.nombre as cuenta_nombre, c.tipo as cuenta_tipo, coalesce(cc.nombre, par.nombre) as cuenta_contraparte_nombre, p.nombre as usuario_nombre,
           e.categoria_id, ce.nombre as categoria_nombre, coalesce(e.tipo, l.datos->>'tipo', l.datos->'anterior'->>'tipo') as egreso_tipo,
           nullif(l.datos->>'metodo_pago_id', '')::uuid as metodo_pago_id, l.datos->>'metodo_nombre' as metodo_nombre, l.datos->>'metodo_tipo' as metodo_tipo,
           nullif(l.datos->>'venta_id', '')::uuid as venta_id, cl.nombre as cliente_nombre,
           co.tipo as comprobante_tipo, co.punto_venta as comprobante_punto_venta, co.numero as comprobante_numero,
           oc.proveedor, nullif(l.datos->>'revierte_a', '')::uuid as revierte_a
      from pagina l
      join public.cuentas_financieras c on c.id = l.cuenta_financiera_id and c.negocio_id = v_negocio
      left join public.cuentas_financieras cc on cc.negocio_id = v_negocio
       and cc.id = coalesce(nullif(l.datos->>'cuenta_contraparte_id', '')::uuid, case when l.importe < 0 then nullif(l.datos->>'cuenta_destino_id', '')::uuid else nullif(l.datos->>'cuenta_origen_id', '')::uuid end)
       and cc.id <> l.cuenta_financiera_id
      -- `datos` no alcanza: en el ciclo del turno solo la pata de la caja
      -- general guarda `cuenta_contraparte_id`, así que la otra se quedaba
      -- sin flecha. La verdad es la OTRA pata de la misma operación.
      left join lateral (
        select c2.nombre
          from public.movimientos_financieros o
          join public.cuentas_financieras c2
            on c2.id = o.cuenta_financiera_id and c2.negocio_id = v_negocio
         where o.negocio_id = v_negocio
           and o.operacion_id = l.operacion_id
           and o.origen_tipo in ('TRANSFERENCIA', 'TURNO_CAJA')
           and o.cuenta_financiera_id <> l.cuenta_financiera_id
         limit 1
      ) par on true
      left join public.perfiles p on p.id = l.registrado_por
      left join public.egresos e on l.origen_tipo = 'EGRESO' and e.id = l.origen_id and e.negocio_id = v_negocio
      left join public.categorias_egreso ce on ce.id = e.categoria_id and ce.negocio_id = v_negocio
      left join public.clientes cl on cl.negocio_id = v_negocio and cl.id = nullif(l.datos->>'cliente_id', '')::uuid
      left join lateral (select x.tipo, x.punto_venta, x.numero from public.comprobantes x where x.negocio_id = v_negocio and x.venta_id = nullif(l.datos->>'venta_id', '')::uuid order by x.emitido_en desc limit 1) co on true
      left join public.ordenes_compra oc on oc.id = l.orden_compra_id and oc.negocio_id = v_negocio
  )
  select jsonb_build_object('total', coalesce(max(f.total), 0), 'filas', coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'fecha', f.fecha_movimiento, 'registrado_en', f.registrado_en, 'evento', f.evento, 'origen_tipo', f.origen_tipo, 'origen_id', f.origen_id, 'operacion_id', f.operacion_id,
      'importe', f.importe, 'impacto_resultado', f.impacto_resultado, 'saldo_posterior', f.saldo_posterior, 'descripcion', f.descripcion,
      'cuenta_id', f.cuenta_financiera_id, 'cuenta_nombre', f.cuenta_nombre, 'cuenta_tipo', f.cuenta_tipo, 'cuenta_contraparte_nombre', f.cuenta_contraparte_nombre,
      'categoria_id', f.categoria_id, 'categoria_nombre', f.categoria_nombre, 'egreso_tipo', f.egreso_tipo,
      'metodo_pago_id', f.metodo_pago_id, 'metodo_nombre', f.metodo_nombre, 'metodo_tipo', f.metodo_tipo,
      'usuario_id', f.registrado_por, 'usuario_nombre', f.usuario_nombre, 'turno_caja_id', f.turno_caja_id,
      'venta_id', f.venta_id, 'cliente_nombre', f.cliente_nombre, 'comprobante_tipo', f.comprobante_tipo, 'comprobante_punto_venta', f.comprobante_punto_venta, 'comprobante_numero', f.comprobante_numero,
      'orden_compra_id', f.orden_compra_id, 'proveedor', f.proveedor, 'revierte_a', f.revierte_a,
      'cantidad', f.cantidad
    ) order by f.fecha_movimiento desc, f.id desc), '[]'::jsonb))
  into v_out from enriquecido f;
  return v_out;
end; $$;


ALTER FUNCTION "public"."movimientos_financieros_negocio"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_cuenta_id" "uuid", "p_origen_tipos" "text"[], "p_categoria_id" "uuid", "p_sin_categoria" boolean, "p_metodo_pago_id" "uuid", "p_usuario_id" "uuid", "p_busqueda" "text", "p_limite" integer, "p_offset" integer, "p_vista" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."movimientos_financieros_negocio"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_cuenta_id" "uuid", "p_origen_tipos" "text"[], "p_categoria_id" "uuid", "p_sin_categoria" boolean, "p_metodo_pago_id" "uuid", "p_usuario_id" "uuid", "p_busqueda" "text", "p_limite" integer, "p_offset" integer, "p_vista" "text") IS 'Movimientos del ledger. p_vista COMPLETA = una fila por movimiento (la tabla general). p_vista CUENTAS = la vista de Dinero: los cobros de venta se consolidan por cuenta y por dia, y el detalle del cajon (gastos e ingresos contra una CAJA_DIARIA) queda afuera porque ya se ve en el turno. El saldo posterior sale del ledger completo en las dos.';



CREATE OR REPLACE FUNCTION "public"."negocio_actual"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT security.current_negocio_id();
$$;


ALTER FUNCTION "public"."negocio_actual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."omitir_egreso_programado"("p_id" "uuid") RETURNS "date"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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
$$;


ALTER FUNCTION "public"."omitir_egreso_programado"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pedidos_broadcast_cambio"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_negocio uuid := coalesce(new.negocio_id, old.negocio_id);
begin
  if v_negocio is null then
    return null;
  end if;

  -- FAIL-OPEN A PROPÓSITO. Esto es una señal: si Realtime no puede escribir
  -- el mensaje, el pedido se guarda igual y la caja lo ve por el fallback de
  -- polling. Lo contrario —que un problema del canal rebote `cobrar_pedido`,
  -- que corre DESPUÉS de una venta ya cobrada— sería dejar la venta hecha y el
  -- pedido colgado como POR_COBRAR para siempre.
  begin
    perform realtime.broadcast_changes(
      'pedidos:' || v_negocio::text, -- topic
      tg_op,                         -- event: INSERT | UPDATE | DELETE
      tg_op,                         -- operation
      tg_table_name,
      tg_table_schema,
      new,
      old
    );
  exception when others then
    raise warning '[PEDIDOS BROADCAST] no se pudo publicar %: %', tg_op, sqlerrm;
  end;
  return null;
end;
$$;


ALTER FUNCTION "public"."pedidos_broadcast_cambio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pesos_ar"("p_monto" numeric) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  select case when p_monto is null then null
              else (case when p_monto < 0 then '−$' else '$' end)
                   || replace(to_char(abs(round(p_monto)), 'FM999,999,999,990'), ',', '.')
         end;
$_$;


ALTER FUNCTION "public"."pesos_ar"("p_monto" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."posicion_dinero"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid := security.current_negocio_id();
  v_hoy date := (now() at time zone v_tz)::date;
  v_hasta date;
  v_desde date;
  v_out jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver la posición de dinero' using errcode='42501';
  end if;
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode='42501';
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

  with turnos_abiertos as (
    select t.id, t.monto_inicial, t.fecha_apertura, t.vendedor_id,
           t.cuenta_financiera_id, coalesce(p.nombre, 'Sin nombre') vendedor
      from public.turnos_caja t
      left join public.perfiles p on p.id = t.vendedor_id
     where t.negocio_id = v_negocio and t.estado <> 'CERRADO'
  ), efectivo_turno as (
    select vp.turno_caja_id, sum(vp.monto_bruto) ingresos
      from public.venta_pagos vp
      join turnos_abiertos t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio and vp.metodo_tipo = 'EFECTIVO'
     group by vp.turno_caja_id
  ), egresos_turno as (
    select e.turno_caja_id, sum(e.monto) salidas
      from public.egresos e
      join turnos_abiertos t on t.id = e.turno_caja_id
       and e.cuenta_origen_id = t.cuenta_financiera_id
     where e.negocio_id = v_negocio
     group by e.turno_caja_id
  ), transferencias_turno as (
    select m.turno_caja_id, sum(m.importe) neto
      from public.movimientos_financieros m
      join turnos_abiertos t on t.id = m.turno_caja_id
       and t.cuenta_financiera_id = m.cuenta_financiera_id
     where m.negocio_id = v_negocio and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO')
     group by m.turno_caja_id
  ), cajas as (
    select t.id, t.vendedor, t.fecha_apertura, t.monto_inicial,
           coalesce(e.ingresos, 0) ingresos,
           coalesce(g.salidas, 0) salidas,
           coalesce(x.neto, 0) transferencias_netas,
           t.monto_inicial + coalesce(e.ingresos, 0) - coalesce(g.salidas, 0)
             + coalesce(x.neto, 0) esperado
      from turnos_abiertos t
      left join efectivo_turno e on e.turno_caja_id = t.id
      left join egresos_turno g on g.turno_caja_id = t.id
      left join transferencias_turno x on x.turno_caja_id = t.id
  ), digitales as (
    -- El cobro digital cuenta SALVO que se haya revertido por su propio medio:
    -- a diferencia del cajon, aca no hay egreso que registre la salida.
    -- Si la venta se anulo pero se devolvio por OTRO medio, el banco no
    -- reverso nada y ese cobro sigue viniendo.
    select vp.metodo_nombre, vp.metodo_tipo, vp.monto_bruto, vp.comision_monto,
           vp.monto_neto,
           vp.creado_en + (vp.acreditacion_dias || ' days')::interval fecha_acreditacion
      from public.venta_pagos vp
      left join public.ventas v on v.id = vp.venta_id and v.negocio_id = vp.negocio_id
     where vp.negocio_id = v_negocio
       and vp.metodo_tipo <> 'EFECTIVO'
       and (
         vp.estado_pago_operacion <> 'ANULADO'
         or ((v.reintegro_metodo_tipo = 'SALDO_A_FAVOR' or (v.reintegro_metodo_id is not null and v.reintegro_metodo_id is distinct from vp.metodo_pago_id)))
       )
  ), pendientes as (
    select metodo_nombre, metodo_tipo, count(*) cantidad, sum(monto_bruto) bruto,
           sum(comision_monto) comision, sum(monto_neto) neto,
           min(fecha_acreditacion) proxima, max(fecha_acreditacion) ultima
      from digitales where fecha_acreditacion > now()
     group by metodo_nombre, metodo_tipo
  ), acreditados as (
    select metodo_nombre, metodo_tipo, count(*) cantidad, sum(monto_bruto) bruto,
           sum(comision_monto) comision, sum(monto_neto) neto
      from digitales
     where fecha_acreditacion <= now()
       and (fecha_acreditacion at time zone v_tz)::date between v_desde and v_hasta
     group by metodo_nombre, metodo_tipo
  ), reintegros_digitales as (
    -- Solo los de devolucion parcial: los de anulacion ya estan representados
    -- arriba, porque su cobro no entra a `digitales`.
    select r.metodo_nombre, r.metodo_tipo, count(*) cantidad, sum(r.monto) monto
      from public.reintegros_al_cliente r
     where r.negocio_id = v_negocio
       and r.origen = 'DEVOLUCION'
       and r.metodo_tipo <> 'EFECTIVO'
       and (r.fecha at time zone v_tz)::date between v_desde and v_hasta
     group by r.metodo_nombre, r.metodo_tipo
  ), acreditado_neto as (
    select coalesce(a.metodo_nombre, d.metodo_nombre) metodo_nombre,
           coalesce(a.metodo_tipo, d.metodo_tipo) metodo_tipo,
           coalesce(a.cantidad, 0) cantidad,
           coalesce(a.bruto, 0) - coalesce(d.monto, 0) bruto,
           coalesce(a.comision, 0) comision,
           coalesce(a.neto, 0) - coalesce(d.monto, 0) neto
      from acreditados a
      full join reintegros_digitales d
        on d.metodo_nombre is not distinct from a.metodo_nombre
       and d.metodo_tipo = a.metodo_tipo
  ), efectivo_cerrado as (
    select coalesce(sum(monto_declarado), 0) declarado
      from public.turnos_caja
     where negocio_id = v_negocio and estado = 'CERRADO'
       and (fecha_cierre at time zone v_tz)::date = v_hoy
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', p_periodo,
    'generado_en', now(),
    'efectivo', jsonb_build_object(
      'total', (select coalesce(sum(esperado), 0) from cajas),
      'turnos_abiertos', (select count(*) from cajas),
      'cerrado_hoy', (select declarado from efectivo_cerrado),
      'cajas', (select coalesce(jsonb_agg(jsonb_build_object(
          'turno_id', id, 'vendedor', vendedor, 'desde', fecha_apertura,
          'inicial', monto_inicial, 'ingresos', ingresos, 'salidas', salidas,
          'transferencias_netas', transferencias_netas, 'esperado', esperado
        ) order by esperado desc), '[]'::jsonb) from cajas)
    ),
    'por_acreditar', (select coalesce(jsonb_agg(jsonb_build_object(
        'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo,
        'cantidad', cantidad, 'bruto', bruto, 'comision', comision,
        'neto', neto, 'proxima', proxima, 'ultima', ultima
      ) order by neto desc), '[]'::jsonb) from pendientes),
    'acreditado', (select coalesce(jsonb_agg(jsonb_build_object(
        'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo,
        'cantidad', cantidad, 'bruto', bruto, 'comision', comision, 'neto', neto
      ) order by neto desc), '[]'::jsonb) from acreditado_neto),
    'reintegros', (select coalesce(jsonb_agg(jsonb_build_object(
        'metodo_nombre', metodo_nombre, 'metodo_tipo', metodo_tipo,
        'cantidad', cantidad, 'monto', monto
      ) order by monto desc), '[]'::jsonb) from reintegros_digitales)
  ) into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."posicion_dinero"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."posicion_dinero"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") IS 'Posicion de dinero DERIVADA de turnos/venta_pagos/egresos. p_periodo (hoy|semana|mes|anio) lo resuelve la base en el huso del local; p_desde/p_hasta quedan para un rango a medida. No es el saldo bancario real.';



CREATE OR REPLACE FUNCTION "public"."posicion_dinero_ledger"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT 'mes'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_desde date := coalesce(p_desde, date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires')::date);
  v_hasta date := coalesce(p_hasta, v_hoy);
  v_legacy jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then raise exception using errcode = '42501', message = 'SIN_PERMISO'; end if;
  if p_periodo = 'hoy' then v_desde := v_hoy; v_hasta := v_hoy; end if;
  if p_periodo = 'semana' then v_desde := v_hoy - 6; v_hasta := v_hoy; end if;
  if p_periodo = 'mes' then v_desde := date_trunc('month', v_hoy)::date; v_hasta := v_hoy; end if;
  v_legacy := public.posicion_dinero(v_desde, v_hasta, p_periodo);
  return v_legacy || jsonb_build_object(
    'modelo', 'LEDGER',
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
      'cuenta_id', x.id, 'nombre', x.nombre, 'tipo', x.tipo,
      'es_efectivo', x.es_efectivo, 'saldo', x.saldo
    ) order by x.es_efectivo desc, x.nombre) from (
      select c.id, c.nombre, c.tipo, c.es_efectivo, coalesce(sum(m.importe), 0) as saldo
      from public.cuentas_financieras c left join public.movimientos_financieros m
        on m.cuenta_financiera_id = c.id and m.negocio_id = c.negocio_id
      where c.negocio_id = v_negocio and c.activa and c.codigo <> 'POR_ACREDITAR'
      group by c.id, c.nombre, c.tipo, c.es_efectivo
    ) x), '[]'::jsonb),
    'por_acreditar_real', coalesce((select jsonb_build_object(
      'nombre', c.nombre, 'saldo', coalesce(sum(m.importe), 0),
      'cantidad_movimientos', count(m.id)
    ) from public.cuentas_financieras c left join public.movimientos_financieros m
      on m.cuenta_financiera_id = c.id and m.negocio_id = c.negocio_id
    where c.negocio_id = v_negocio and c.codigo = 'POR_ACREDITAR'
    group by c.id, c.nombre), jsonb_build_object('nombre','Dinero por acreditar','saldo',0,'cantidad_movimientos',0)),
    'acreditado', coalesce((select jsonb_agg(jsonb_build_object(
      'metodo_nombre', x.nombre, 'metodo_tipo', x.tipo, 'cantidad', x.cantidad,
      'bruto', x.neto, 'comision', 0, 'neto', x.neto
    ) order by x.neto desc) from (
      select c.id, c.nombre, c.tipo, count(m.id) as cantidad, sum(m.importe) as neto
      from public.movimientos_financieros m join public.cuentas_financieras c on c.id = m.cuenta_financiera_id
      where m.negocio_id = v_negocio and m.origen_tipo = 'ACREDITACION'
        and m.evento = 'ACREDITACION_ENTRADA'
        and (m.fecha_movimiento at time zone 'America/Argentina/Buenos_Aires')::date between v_desde and v_hasta
      group by c.id, c.nombre, c.tipo
    ) x), '[]'::jsonb),
    'conciliacion', jsonb_build_object(
      'por_acreditar_ledger', coalesce((select sum(m.importe) from public.movimientos_financieros m join public.cuentas_financieras c on c.id=m.cuenta_financiera_id where c.negocio_id=v_negocio and c.codigo='POR_ACREDITAR'),0),
      'por_acreditar_anterior', coalesce((select sum((x->>'neto')::numeric) from jsonb_array_elements(v_legacy->'por_acreditar') x),0)
    )
  );
end;
$$;


ALTER FUNCTION "public"."posicion_dinero_ledger"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."previsualizar_fusion_productos"("p_origen" "uuid", "p_destino" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_origen  public.productos;
  v_destino public.productos;
  v_mover int;
  v_sumar int;
begin
  select * into v_origen  from public.productos where id = p_origen;
  select * into v_destino from public.productos where id = p_destino;

  if v_origen.id is null or v_destino.id is null then
    return jsonb_build_object('ok', false, 'error', 'PRODUCTO_NO_ENCONTRADO');
  end if;

  if p_origen = p_destino then
    return jsonb_build_object('ok', false, 'error', 'MISMO_PRODUCTO');
  end if;

  select
    count(*) filter (where g.id is null),
    count(*) filter (where g.id is not null)
  into v_mover, v_sumar
  from public.producto_variantes o
  left join lateral (
    select d.id from public.producto_variantes d
    where d.producto_id = p_destino
      and public.atributos_comparables(d.atributos)
        = public.atributos_comparables(o.atributos)
    limit 1
  ) g on true
  where o.producto_id = p_origen;

  return jsonb_build_object(
    'ok', true,
    'origen_nombre', v_origen.nombre,
    'destino_nombre', v_destino.nombre,
    'variantes_a_mover', coalesce(v_mover, 0),
    'variantes_a_sumar', coalesce(v_sumar, 0),
    'variantes_finales',
      (select count(*) from public.producto_variantes where producto_id = p_destino)
      + coalesce(v_mover, 0),
    'unidades_finales',
      coalesce((select sum(stock) from public.producto_variantes
                where producto_id in (p_origen, p_destino)), 0),
    'ventas_a_reapuntar',
      (select count(*) from public.ventas_items where producto_id = p_origen),
    'lineas_remito_a_reapuntar',
      (select count(*) from public.ordenes_items where producto_id = p_origen),
    'alias_a_reapuntar',
      (select count(*) from public.diccionario_alias where producto_id = p_origen),
    'origen_tiene_foto', v_origen.imagen_url is not null,
    'destino_tiene_foto', v_destino.imagen_url is not null,
    'origen_precio', v_origen.precio,
    'destino_precio', v_destino.precio,
    'misma_categoria', v_origen.categoria_id is not distinct from v_destino.categoria_id,
    'misma_marca',
      upper(trim(coalesce(v_origen.marca, ''))) = upper(trim(coalesce(v_destino.marca, '')))
  );
end;
$$;


ALTER FUNCTION "public"."previsualizar_fusion_productos"("p_origen" "uuid", "p_destino" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."previsualizar_fusion_productos"("p_origen" "uuid", "p_destino" "uuid") IS 'Que pasaria al fusionar dos productos, sin escribir nada. Usa la misma identidad de variante que la fusion real. Ver 20260910180000.';



CREATE OR REPLACE FUNCTION "public"."producto_presentaciones_tocar_producto"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.productos
     set updated_at = now()
   where id = coalesce(new.producto_id, old.producto_id);
  return null;
end;
$$;


ALTER FUNCTION "public"."producto_presentaciones_tocar_producto"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."producto_presentaciones_tocar_producto"() IS 'AFTER INSERT/UPDATE/DELETE en producto_presentaciones: bumpea productos.updated_at para que catalogo-delta.ts traiga el producto. DEFINER porque el que edita presentaciones ya pudo con el producto (mismo permiso), y el UPDATE solo toca updated_at de la fila padre.';



CREATE OR REPLACE FUNCTION "public"."producto_presentaciones_validar"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_unidad text;
begin
  select p.unidad_medida into v_unidad
    from public.productos p
   where p.id = new.producto_id;

  if v_unidad is null then
    raise exception 'PRESENTACION_PRODUCTO_INEXISTENTE';
  end if;

  if new.variante_id is not null and not exists (
    select 1 from public.producto_variantes v
     where v.id = new.variante_id and v.producto_id = new.producto_id
  ) then
    raise exception 'PRESENTACION_VARIANTE_DE_OTRO_PRODUCTO';
  end if;

  if v_unidad not in ('KG', 'GRAMO', 'LITRO', 'METRO')
     and new.factor <> trunc(new.factor) then
    raise exception 'PRESENTACION_FACTOR_ENTERO'
      using detail = format('unidad %s, factor %s', v_unidad, new.factor);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."producto_presentaciones_validar"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."puede_fiar"("p_cliente" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN public.limite_plan('max_clientes_cuenta_corriente') IS NULL THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = p_cliente AND c.saldo_pendiente > 0
    ) THEN true
    ELSE (
      SELECT count(*) FROM public.clientes c
      WHERE c.negocio_id = security.current_negocio_id()
        AND c.saldo_pendiente > 0
    ) < public.limite_plan('max_clientes_cuenta_corriente')
  END;
$$;


ALTER FUNCTION "public"."puede_fiar"("p_cliente" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."puede_fiar"("p_cliente" "uuid") IS 'AVISO, no bloqueo: dice si queda cupo de cuentas corrientes. Desde 20260814170000 una venta fiada NUNCA se rechaza por el tope (ver validar_limite_cc_manual). Sirve para advertir antes de cobrar.';



CREATE OR REPLACE FUNCTION "public"."quitar_empleado"("p_usuario_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_negocio   uuid := security.current_negocio_id();
  v_rol_admin uuid;
  v_rol_actual uuid;
  v_admins    integer;
  v_otras     integer;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception 'NO_A_SI_MISMO';
  end if;

  select rol_id into v_rol_actual
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id = v_negocio;
  if v_rol_actual is null then
    raise exception 'NO_ES_MIEMBRO';
  end if;

  select id into v_rol_admin from public.roles where negocio_id = v_negocio and nombre = 'ADMIN';
  if v_rol_actual = v_rol_admin then
    select count(*) into v_admins
      from public.usuarios_negocios
     where negocio_id = v_negocio and rol_id = v_rol_admin;
    if v_admins <= 1 then
      raise exception 'ULTIMO_ADMIN';
    end if;
  end if;

  select count(*) into v_otras
    from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id <> v_negocio;

  if v_otras = 0 then
    perform public.cerrar_sesiones_usuario(p_usuario_id);
  end if;

  delete from public.usuarios_negocios
   where usuario_id = p_usuario_id and negocio_id = v_negocio;

  return jsonb_build_object('otras_membresias', v_otras);
end;
$$;


ALTER FUNCTION "public"."quitar_empleado"("p_usuario_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."quitar_empleado"("p_usuario_id" "uuid") IS 'Saca la membresia del negocio activo y cierra sesiones si era su unico negocio. NO borra la cuenta: perfiles cae en cascada con auth.users y ventas.vendedor_id quedaria en null.';



CREATE OR REPLACE FUNCTION "public"."recalcular_vencimiento_cc"("p_cliente_id" "uuid") RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
  with plazo as (
    select coalesce(cp.cc_plazo_mora, 30) as dias
    from public.clientes c
    left join public.configuracion_pos cp on cp.negocio_id = c.negocio_id
    where c.id = p_cliente_id
  ),
  mora_por_ticket as (
    select m.debito_origen_id as ticket_id, sum(m.monto) as mora
    from public.cuenta_corriente_movimientos m
    where m.cliente_id = p_cliente_id
      and m.tipo = 'DEBITO'
      and m.anulado = false
      and m.pago_id is not null
      and m.debito_origen_id is not null
    group by m.debito_origen_id
  ),
  unidades as (
    select
      coalesce(d.fecha_origen, (d.creado_en at time zone 'UTC')::date) as fecha,
      d.creado_en,
      d.monto + coalesce(mt.mora, 0) as total,
      false as es_mora_huerfana
    from public.cuenta_corriente_movimientos d
    left join mora_por_ticket mt on mt.ticket_id = d.id
    where d.cliente_id = p_cliente_id
      and d.tipo = 'DEBITO'
      and d.anulado = false
      and d.pago_id is null

    union all

    select
      coalesce(m.fecha_origen, (m.creado_en at time zone 'UTC')::date),
      m.creado_en,
      m.monto,
      true
    from public.cuenta_corriente_movimientos m
    where m.cliente_id = p_cliente_id
      and m.tipo = 'DEBITO'
      and m.anulado = false
      and m.pago_id is not null
      and m.debito_origen_id is null
  ),
  ordenadas as (
    select
      u.*,
      sum(u.total) over (
        order by u.fecha, u.creado_en
        rows unbounded preceding
      ) as acumulado
    from unidades u
  ),
  pagado as (
    select coalesce(sum(m.monto), 0) as total
    from public.cuenta_corriente_movimientos m
    where m.cliente_id = p_cliente_id
      and m.tipo = 'CREDITO'
      and m.anulado = false
  ),
  vivas as (
    select
      o.fecha,
      o.es_mora_huerfana,
      greatest(0, least(o.total, o.acumulado - pg.total)) as vivo
    from ordenadas o, pagado pg
  ),
  anclas as (
    select
      min(v.fecha) filter (where v.vivo > 0 and not v.es_mora_huerfana) as ticket,
      min(v.fecha) filter (where v.vivo > 0 and v.es_mora_huerfana)     as huerfana
    from vivas v
  )
  select
    case
      when a.ticket is null and a.huerfana is null then null
      when a.huerfana is null then a.ticket + pl.dias
      when a.ticket is null then a.huerfana
      else least(a.ticket + pl.dias, a.huerfana)
    end
  from anclas a, plazo pl;
$$;


ALTER FUNCTION "public"."recalcular_vencimiento_cc"("p_cliente_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."recalcular_vencimiento_cc"("p_cliente_id" "uuid") IS 'Vencimiento de cuenta corriente: plazo contado desde la deuda viva mas antigua, imputando los pagos FIFO y tratando cada ticket junto con el recargo por mora que genero (debito_origen_id) como una sola deuda. Un ticket con recargo impago sigue vivo y viejo aunque su capital este pagado. Un recargo huerfano devuelve su propia fecha, que ya esta vencida. Espejo de features/clients/lib/imputar-pagos-fifo.ts.';



CREATE OR REPLACE FUNCTION "public"."registrar_acreditacion_financiera"("p_cuenta_destino_id" "uuid", "p_venta_pago_ids" "uuid"[], "p_fecha_acreditacion" timestamp with time zone DEFAULT "now"(), "p_referencia" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio_id uuid := security.current_negocio_id();
  v_usuario_id uuid := auth.uid();
  v_acreditacion_id uuid;
  v_puente_id uuid;
  v_neto numeric;
  v_cantidad integer;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(array_length(p_venta_pago_ids, 1), 0) = 0 then raise exception 'SIN_COBROS'; end if;
  if p_fecha_acreditacion is null then raise exception 'FECHA_INVALIDA'; end if;
  if not exists (select 1 from public.cuentas_financieras c where c.id = p_cuenta_destino_id and c.negocio_id = v_negocio_id and c.activa and c.codigo <> 'POR_ACREDITAR') then
    raise exception 'CUENTA_DESTINO_INVALIDA';
  end if;
  v_puente_id := public.cuenta_financiera_sistema(v_negocio_id, 'POR_ACREDITAR');

  select count(*), coalesce(sum(p.monto_neto), 0) into v_cantidad, v_neto
    from public.venta_pagos p
   where p.negocio_id = v_negocio_id
     and p.id = any(p_venta_pago_ids)
     and p.metodo_tipo <> 'EFECTIVO'
     and p.estado_pago_operacion <> 'ANULADO'
     and p.acreditacion_dias > 0
     and not exists (select 1 from public.acreditaciones_financieras_pagos ap where ap.negocio_id = v_negocio_id and ap.venta_pago_id = p.id);
  if v_cantidad <> cardinality(p_venta_pago_ids) then raise exception 'COBROS_NO_LIQUIDABLES'; end if;

  insert into public.acreditaciones_financieras(negocio_id, cuenta_destino_id, fecha_acreditacion, referencia, importe_neto, creado_por)
  values (v_negocio_id, p_cuenta_destino_id, p_fecha_acreditacion, nullif(btrim(p_referencia), ''), v_neto, v_usuario_id)
  returning id into v_acreditacion_id;
  insert into public.acreditaciones_financieras_pagos(acreditacion_id, venta_pago_id, negocio_id, monto_neto)
  select v_acreditacion_id, p.id, v_negocio_id, p.monto_neto from public.venta_pagos p
   where p.id = any(p_venta_pago_ids) and p.negocio_id = v_negocio_id;

  -- El puente ya recibio el neto al cobrar (Etapa 2). La liquidacion solo lo
  -- reubica: no vuelve a reconocer comision ni resultado economico.
  insert into public.movimientos_financieros(operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento, importe, impacto_resultado, descripcion, datos, fecha_movimiento, registrado_por)
  values
    (v_acreditacion_id, v_negocio_id, v_puente_id, 'ACREDITACION', v_acreditacion_id, 'ACREDITACION_SALIDA', -v_neto, 0, 'Liquidación a cuenta destino', jsonb_build_object('cuenta_destino_id', p_cuenta_destino_id), p_fecha_acreditacion, v_usuario_id),
    (v_acreditacion_id, v_negocio_id, p_cuenta_destino_id, 'ACREDITACION', v_acreditacion_id, 'ACREDITACION_ENTRADA', v_neto, 0, 'Liquidación de cobros digitales', jsonb_build_object('cuenta_puente_id', v_puente_id), p_fecha_acreditacion, v_usuario_id);
  return v_acreditacion_id;
end;
$$;


ALTER FUNCTION "public"."registrar_acreditacion_financiera"("p_cuenta_destino_id" "uuid", "p_venta_pago_ids" "uuid"[], "p_fecha_acreditacion" timestamp with time zone, "p_referencia" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_bitacora_egreso"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare op uuid := gen_random_uuid(); cambio boolean; v_motivo text;
begin
  if tg_op = 'INSERT' then
    insert into public.movimientos_financieros (operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento, importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos, fecha_movimiento, registrado_por)
    values (op, new.negocio_id, new.cuenta_origen_id, 'EGRESO', new.id, 'REGISTRO', -new.monto, public.egreso_impacto_resultado(new.tipo, new.monto), new.turno_caja_id, new.orden_compra_id, new.concepto, public.snapshot_financiero_egreso(new), new.fecha, coalesce(auth.uid(), new.creado_por));
    return new;
  elsif tg_op = 'DELETE' then
    -- Motivo por setting transaction-local (mismo mecanismo que comerz.origen_movimiento).
    -- Fechada en el EGRESO, no en now(): un gasto anulado nunca fue gasto de su mes.
    v_motivo := nullif(btrim(current_setting('comerz.motivo_anulacion', true)), '');
    insert into public.movimientos_financieros (operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento, importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos, fecha_movimiento, registrado_por)
    values (op, old.negocio_id, old.cuenta_origen_id, 'EGRESO', old.id, 'ELIMINACION_REVERSA', old.monto, -public.egreso_impacto_resultado(old.tipo, old.monto), old.turno_caja_id, old.orden_compra_id,
      case when v_motivo is null then old.concepto else format('%s — anulado: %s', old.concepto, v_motivo) end,
      jsonb_build_object('anterior', public.snapshot_financiero_egreso(old), 'motivo', v_motivo, 'anulado_en', now()), old.fecha, auth.uid());
    return old;
  end if;
  cambio := row(old.negocio_id, old.cuenta_origen_id, old.monto, old.tipo, old.concepto, old.turno_caja_id, old.orden_compra_id)
            is distinct from row(new.negocio_id, new.cuenta_origen_id, new.monto, new.tipo, new.concepto, new.turno_caja_id, new.orden_compra_id);
  if not cambio then return new; end if;
  insert into public.movimientos_financieros (operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento, importe, impacto_resultado, turno_caja_id, orden_compra_id, descripcion, datos, fecha_movimiento, registrado_por) values
  (op, old.negocio_id, old.cuenta_origen_id, 'EGRESO', old.id, 'CORRECCION_REVERSA', old.monto, -public.egreso_impacto_resultado(old.tipo, old.monto), old.turno_caja_id, old.orden_compra_id, old.concepto, jsonb_build_object('anterior', public.snapshot_financiero_egreso(old), 'nuevo', public.snapshot_financiero_egreso(new)), new.fecha, auth.uid()),
  (op, new.negocio_id, new.cuenta_origen_id, 'EGRESO', new.id, 'CORRECCION_APLICADA', -new.monto, public.egreso_impacto_resultado(new.tipo, new.monto), new.turno_caja_id, new.orden_compra_id, new.concepto, jsonb_build_object('anterior', public.snapshot_financiero_egreso(old), 'nuevo', public.snapshot_financiero_egreso(new)), new.fecha, auth.uid());
  return new;
end; $$;


ALTER FUNCTION "public"."registrar_bitacora_egreso"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_bitacora_turno_caja"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."registrar_bitacora_turno_caja"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_bitacora_venta_pago"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_operacion     uuid := gen_random_uuid();
  v_cuenta_old    uuid;
  v_cuenta_new    uuid;
  v_importe_old   numeric;
  v_importe_new   numeric;
  v_cambio        boolean;
  v_reversa       numeric;
begin
  if tg_op = 'INSERT' then
    v_cuenta_new := public.cuenta_actual_venta_pago(
      new.negocio_id,
      new.metodo_tipo,
      new.acreditacion_dias,
      new.cuenta_destino_id
    );
    v_importe_new := public.importe_financiero_venta_pago(
      new.metodo_tipo, new.monto_bruto, new.monto_neto
    );

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then 'REGISTRO' else 'REGISTRO_ANULADO' end,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then v_importe_new else 0 end,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then -new.comision_monto else 0 end,
      new.turno_caja_id,
      format('Cobro por %s', new.metodo_nombre),
      public.snapshot_financiero_venta_pago(new),
      new.creado_en,
      auth.uid()
    );

    return new;
  end if;

  if tg_op = 'DELETE' then
    v_cuenta_old := public.cuenta_actual_venta_pago(
      old.negocio_id,
      old.metodo_tipo,
      old.acreditacion_dias,
      old.cuenta_destino_id
    );
    v_importe_old := public.importe_financiero_venta_pago(
      old.metodo_tipo, old.monto_bruto, old.monto_neto
    );

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, old.negocio_id, v_cuenta_old,
      'VENTA_PAGO', old.id, 'ELIMINACION_REVERSA',
      case when old.estado_pago_operacion = 'CONFIRMADO'
        then -v_importe_old else 0 end,
      case when old.estado_pago_operacion = 'CONFIRMADO'
        then old.comision_monto else 0 end,
      old.turno_caja_id,
      format('Eliminacion de cobro por %s', old.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old)
      ),
      now(),
      auth.uid()
    );

    return old;
  end if;

  v_cambio := row(
    old.estado_pago_operacion,
    old.metodo_pago_id,
    old.metodo_nombre,
    old.metodo_tipo,
    old.monto_base,
    old.recargo_monto,
    old.monto_bruto,
    old.comision_monto,
    old.monto_neto,
    old.acreditacion_dias,
    old.cuenta_destino_id,
    old.turno_caja_id
  ) is distinct from row(
    new.estado_pago_operacion,
    new.metodo_pago_id,
    new.metodo_nombre,
    new.metodo_tipo,
    new.monto_base,
    new.recargo_monto,
    new.monto_bruto,
    new.comision_monto,
    new.monto_neto,
    new.acreditacion_dias,
    new.cuenta_destino_id,
    new.turno_caja_id
  );

  if not v_cambio then
    return new;
  end if;

  v_cuenta_old := public.cuenta_actual_venta_pago(
    old.negocio_id,
    old.metodo_tipo,
    old.acreditacion_dias,
    old.cuenta_destino_id
  );
  v_cuenta_new := public.cuenta_actual_venta_pago(
    new.negocio_id,
    new.metodo_tipo,
    new.acreditacion_dias,
    new.cuenta_destino_id
  );
  v_importe_old := public.importe_financiero_venta_pago(
    old.metodo_tipo, old.monto_bruto, old.monto_neto
  );
  v_importe_new := public.importe_financiero_venta_pago(
    new.metodo_tipo, new.monto_bruto, new.monto_neto
  );

  -- LA REVERSA DE UNA ANULACION NO ES CIEGA AL MEDIO (20260920180000).
  -- Misma regla que posicion_dinero: el flujo no mira si la venta se anulo,
  -- mira los movimientos.
  --   EFECTIVO: la plata entro al cajon y sale por el EGRESO de la
  --             devolucion. Revertir ademas el cobro la descuenta dos veces.
  --   DIGITAL:  no hay egreso, asi que la reversa ES la unica forma de
  --             representar que el banco dio marcha atras. Salvo que el
  --             reintegro haya salido por OTRO medio: ahi el banco no
  --             reverso nada y ese cobro sigue viniendo.
  -- Una CORRECCION (cambio de medio o de monto) siempre revierte: ahi el
  -- cobro viejo deja de existir tal como estaba.
  if new.estado_pago_operacion = 'ANULADO'
     and old.estado_pago_operacion = 'CONFIRMADO' then
    if old.metodo_tipo = 'EFECTIVO' then
      v_reversa := 0;
    elsif exists (
      select 1 from public.ventas v
       where v.id = old.venta_id
         and v.negocio_id = old.negocio_id
         and (v.reintegro_metodo_tipo = 'SALDO_A_FAVOR' or (v.reintegro_metodo_id is not null and v.reintegro_metodo_id is distinct from old.metodo_pago_id))
    ) then
      v_reversa := 0;
    else
      v_reversa := -v_importe_old;
    end if;
  else
    v_reversa := -v_importe_old;
  end if;

  if old.estado_pago_operacion = 'CONFIRMADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, old.negocio_id, v_cuenta_old,
      'VENTA_PAGO', old.id,
      case when new.estado_pago_operacion = 'ANULADO'
        then 'ANULACION' else 'CORRECCION_REVERSA' end,
      v_reversa,
      -- Si no se revierte la plata tampoco se recupera la comision: el banco
      -- se la quedo igual.
      case when v_reversa = 0 then 0 else old.comision_monto end,
      old.turno_caja_id,
      format('Reversa de cobro por %s', old.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  end if;

  if new.estado_pago_operacion = 'CONFIRMADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id,
      case when old.estado_pago_operacion = 'ANULADO'
        then 'REACTIVACION' else 'CORRECCION_APLICADA' end,
      v_importe_new,
      -new.comision_monto,
      new.turno_caja_id,
      format('Cobro corregido por %s', new.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  elsif old.estado_pago_operacion = 'ANULADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id, 'CORRECCION_SIN_IMPACTO', 0, 0,
      new.turno_caja_id,
      'Correccion sobre cobro anulado',
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."registrar_bitacora_venta_pago"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_borrado_catalogo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.catalogo_borrados (negocio_id, tabla, fila_id, borrado_por)
  values (old.negocio_id, tg_table_name, old.id, auth.uid());

  return null;
end;
$$;


ALTER FUNCTION "public"."registrar_borrado_catalogo"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_borrado_catalogo"() IS 'AFTER DELETE sobre las tablas del catalogo: deja el aviso de baja en catalogo_borrados. SECURITY DEFINER para que el registro no dependa de los permisos del que borra.';



CREATE OR REPLACE FUNCTION "public"."registrar_cobro_cc"("p_pago" "jsonb", "p_mora" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio      uuid := security.current_negocio_id();
  v_usuario      uuid := auth.uid();
  v_pago_id      uuid := nullif(p_pago->>'id', '')::uuid;
  v_cliente      uuid := nullif(p_pago->>'cliente_id', '')::uuid;
  v_monto        numeric := (p_pago->>'monto_base')::numeric;
  v_mora         numeric := coalesce((p_mora->>'monto')::numeric, 0);
  v_saldo        numeric;
  v_deuda        numeric;
  v_existente    public.venta_pagos%rowtype;
  v_saldo_nuevo  numeric;
  v_vencimiento  date;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if v_pago_id is null or v_cliente is null then
    raise exception 'COBRO_CC_DATOS_INVALIDOS';
  end if;

  if v_monto is null or v_monto <= 0 or v_mora < 0 then
    raise exception 'COBRO_CC_DATOS_INVALIDOS';
  end if;

  -- 1. Lock del cliente. Serializa dos cobros simultáneos del mismo cliente y
  -- deja el saldo quieto para el tope.
  select coalesce(c.saldo_pendiente, 0)
    into v_saldo
    from public.clientes c
   where c.id = v_cliente
     and c.negocio_id = v_negocio
     for update;

  if not found then
    raise exception 'CLIENTE_NO_ENCONTRADO';
  end if;

  -- 2. Idempotencia. Va DESPUÉS del lock: un reintento concurrente espera al
  -- primero y, cuando entra, ya ve su fila.
  select *
    into v_existente
    from public.venta_pagos vp
   where vp.id = v_pago_id;

  if found then
    return jsonb_build_object(
      'ya_registrado', true,
      'pago_id', v_existente.id,
      'monto_base', v_existente.monto_base,
      'saldo_actual', v_saldo
    );
  end if;

  -- 3. Tope. Lo que entra no puede ser más de lo que se debe, mora de este
  -- cobro incluida. El redondeo al centavo es para que "pagar todo" con la
  -- mora calculada en Node no falle por un decimal de más.
  v_deuda := round(v_saldo + v_mora, 2);
  -- Desde 20260928250000 el excedente puede quedar como saldo a favor, pero
  -- solo si quien cobra lo confirmó: sin eso sigue siendo el freno contra el
  -- cobro duplicado y el monto mal tipeado.
  if round(v_monto, 2) > v_deuda
     and not coalesce((p_pago->>'permitir_saldo_a_favor')::boolean, false) then
    raise exception 'COBRO_SUPERA_DEUDA'
      using detail = jsonb_build_object('deuda', v_deuda, 'monto', v_monto)::text;
  end if;

  -- 4. El cobro en caja. Mismos campos que escribía la action.
  insert into public.venta_pagos (
    id, negocio_id, cliente_id, turno_caja_id,
    metodo_pago_id, metodo_nombre, metodo_tipo,
    monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
    comision_porcentaje, comision_monto, monto_neto,
    acreditacion_dias, tipo_movimiento
  ) values (
    v_pago_id, v_negocio, v_cliente,
    nullif(p_pago->>'turno_caja_id', '')::uuid,
    nullif(p_pago->>'metodo_pago_id', '')::uuid,
    p_pago->>'metodo_nombre',
    p_pago->>'metodo_tipo',
    v_monto,
    coalesce((p_pago->>'recargo_porcentaje')::numeric, 0),
    coalesce((p_pago->>'recargo_monto')::numeric, 0),
    (p_pago->>'monto_bruto')::numeric,
    coalesce((p_pago->>'comision_porcentaje')::numeric, 0),
    coalesce((p_pago->>'comision_monto')::numeric, 0),
    (p_pago->>'monto_neto')::numeric,
    coalesce((p_pago->>'acreditacion_dias')::int, 0),
    'PAGO_CUENTA_CORRIENTE'
  );

  -- 5. La mora materializada como DEBITO propio, atada al cobro y al ticket
  -- que la generó. Va ANTES del crédito: primero se suma, después se paga.
  if v_mora > 0 then
    insert into public.cuenta_corriente_movimientos (
      negocio_id, cliente_id, pago_id, tipo, monto, descripcion, creado_por,
      debito_origen_id, origen_reconstruido
    ) values (
      v_negocio, v_cliente, v_pago_id, 'DEBITO', v_mora,
      p_mora->>'descripcion', v_usuario,
      nullif(p_mora->>'debito_origen_id', '')::uuid, false
    );
  end if;

  -- 6. El crédito, por la BASE (el recargo por método no amortiza deuda).
  insert into public.cuenta_corriente_movimientos (
    negocio_id, cliente_id, pago_id, tipo, monto, descripcion, creado_por
  ) values (
    v_negocio, v_cliente, v_pago_id, 'CREDITO', v_monto,
    p_pago->>'descripcion_cc', v_usuario
  );

  -- 7. El caché, con delta y en el mismo statement. El vencimiento lo resuelve
  -- la regla única, que ya ve la mora y el crédito recién escritos.
  update public.clientes c
     set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + v_mora - v_monto,
         fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente)
   where c.id = v_cliente
     and c.negocio_id = v_negocio
  returning c.saldo_pendiente, c.fecha_vencimiento_deuda
    into v_saldo_nuevo, v_vencimiento;

  return jsonb_build_object(
    'ya_registrado', false,
    'pago_id', v_pago_id,
    'monto_base', v_monto,
    'saldo_anterior', v_saldo,
    'saldo_nuevo', v_saldo_nuevo,
    'fecha_vencimiento', v_vencimiento
  );
end;
$$;


ALTER FUNCTION "public"."registrar_cobro_cc"("p_pago" "jsonb", "p_mora" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_cobro_cc"("p_pago" "jsonb", "p_mora" "jsonb") IS 'Cobro de cuenta corriente en una transacción: venta_pagos + mora + crédito + saldo. Idempotente por p_pago.id (ya_registrado). Rechaza con COBRO_SUPERA_DEUDA un monto mayor al saldo + mora. SECURITY INVOKER: el aislamiento es la RLS de quien cobra.';



CREATE OR REPLACE FUNCTION "public"."registrar_devolucion"("p_venta_id" "uuid", "p_lineas" "jsonb", "p_motivo_codigo" "text" DEFAULT NULL::"text", "p_motivo_detalle" "text" DEFAULT NULL::"text", "p_turno_id" "uuid" DEFAULT NULL::"uuid", "p_reintegro_metodo_id" "uuid" DEFAULT NULL::"uuid", "p_reintegro_a_cuenta" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio        uuid := security.current_negocio_id();
  v_usuario        uuid := auth.uid();
  v_venta          public.ventas%rowtype;
  v_pago           public.venta_pagos%rowtype;
  v_cobros         int;
  v_linea          jsonb;
  v_item           public.ventas_items%rowtype;
  v_cantidad       numeric;
  v_destino        text;
  v_base           numeric := 0;
  v_base_total     numeric;
  v_base_previa    numeric;
  v_es_cc          boolean;
  v_recargo_cc     numeric := 0;
  v_reduccion      numeric := 0;
  v_saldo          numeric;
  v_credito        numeric := 0;
  v_excedente      numeric := 0;
  v_metodo_tipo    text;
  v_metodo_nombre  text;
  v_devolucion_id  uuid;
  v_items          jsonb := '[]'::jsonb;
  v_ticket         text := upper(split_part(p_venta_id::text, '-', 1));
  v_rein_id        uuid;
  v_rein_tipo      text;
  v_rein_nombre    text;
  v_sale_de_caja   boolean;
  v_a_cuenta       boolean := false;
  v_monto_a_cuenta numeric := 0;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.tiene_permiso('ventas.devolver') then
    raise exception 'SIN_PERMISO';
  end if;

  if p_lineas is null or jsonb_array_length(p_lineas) = 0 then
    raise exception 'SIN_RENGLONES';
  end if;

  select r.metodo_id, r.metodo_tipo, r.metodo_nombre
    into v_rein_id, v_rein_tipo, v_rein_nombre
    from public.resolver_medio_reintegro(p_reintegro_metodo_id) r;

  -- Reintegro A CUENTA (20260928240000). Lo elige quien puede devolver: no
  -- saca plata del cajón.
  if p_reintegro_a_cuenta then
    if p_reintegro_metodo_id is not null then
      raise exception 'REINTEGRO_AMBIGUO';
    end if;
    v_rein_id := null;
    v_rein_tipo := 'SALDO_A_FAVOR';
    v_rein_nombre := 'A cuenta del cliente';
  end if;

  select * into v_venta from public.ventas where id = p_venta_id for update;
  if not found or v_venta.negocio_id is distinct from v_negocio then
    raise exception 'VENTA_INEXISTENTE';
  end if;

  if v_venta.vendedor_id is distinct from v_usuario
     and not public.tiene_permiso('ventas.ver_todas') then
    raise exception 'VENTA_AJENA';
  end if;

  if v_venta.estado_operacion <> 'CONFIRMADA' then
    raise exception 'VENTA_NO_DEVOLVIBLE';
  end if;

  -- Una venta pagada con saldo a favor, sin medio elegido, vuelve a la
  -- cuenta: es de donde salió. Sin esto no tenía camino (sin cobros cae en
  -- VENTA_CON_PAGO_MIXTO).
  if v_rein_tipo is null
     and coalesce(v_venta.saldo_a_favor_aplicado, 0) > 0
     and coalesce(v_venta.monto_pendiente, 0) = 0 then
    v_rein_tipo := 'SALDO_A_FAVOR';
    v_rein_nombre := 'A cuenta del cliente';
  end if;

  v_a_cuenta := coalesce(v_rein_tipo = 'SALDO_A_FAVOR', false);
  if v_a_cuenta and v_venta.cliente_id is null then
    raise exception 'A_CUENTA_SIN_CLIENTE';
  end if;

  v_es_cc := coalesce(v_venta.monto_pendiente, 0) > 0;

  if v_es_cc then
    if v_venta.cliente_id is null then
      raise exception 'VENTA_CC_SIN_CLIENTE';
    end if;

    v_metodo_tipo := 'CUENTA_CORRIENTE';
    v_metodo_nombre := 'Cuenta corriente';
  else
    -- SECURITY DEFINER: sin negocio_id aca, un cobro insertado desde otro
    -- comercio contra esta venta cuenta como si fuera propio.
    select count(*) into v_cobros
      from public.venta_pagos
     where venta_id = p_venta_id
       and negocio_id = v_negocio
       and tipo_movimiento = 'PAGO_VENTA';

    if v_cobros = 1 then
      select * into v_pago
        from public.venta_pagos
       where venta_id = p_venta_id
         and negocio_id = v_negocio
         and tipo_movimiento = 'PAGO_VENTA';

      v_metodo_tipo := v_pago.metodo_tipo;
      v_metodo_nombre := v_pago.metodo_nombre;
    else
      -- Mas de un cobro (o ninguno): no hay UN medio del que hablar.
      v_metodo_tipo := 'MIXTO';
      v_metodo_nombre := null;
    end if;

    if v_rein_id is null and not v_a_cuenta then
      if v_cobros <> 1 then
        raise exception 'VENTA_CON_PAGO_MIXTO';
      end if;

      if v_metodo_tipo not in ('EFECTIVO', 'TRANSFERENCIA') then
        raise exception 'METODO_NO_DEVOLVIBLE';
      end if;
    end if;
  end if;

  for v_linea in select * from jsonb_array_elements(p_lineas)
  loop
    v_cantidad := (v_linea->>'cantidad')::numeric;
    v_destino  := coalesce(v_linea->>'destino', 'STOCK');

    if v_cantidad is null or v_cantidad <= 0 then
      raise exception 'CANTIDAD_INVALIDA';
    end if;

    if v_destino not in ('STOCK', 'BAJA') then
      raise exception 'DESTINO_INVALIDO';
    end if;

    update public.ventas_items
       set cantidad_devuelta = cantidad_devuelta + v_cantidad
     where id = (v_linea->>'venta_item_id')::uuid
       and venta_id = p_venta_id
       and negocio_id = v_negocio
       and cantidad_devuelta + v_cantidad <= cantidad
    returning * into v_item;

    if not found then
      raise exception 'DEVOLUCION_EXCEDE_LO_VENDIDO';
    end if;

    v_base := v_base + (v_item.precio_final * v_cantidad);

    v_items := v_items || jsonb_build_object(
      'venta_item_id', v_item.id,
      'variante_id',   v_item.variante_id,
      'cantidad',      v_cantidad,
      'precio_final',  v_item.precio_final,
      'destino',       v_destino
    );
  end loop;

  select coalesce(sum(precio_final * cantidad), 0),
         coalesce(sum(precio_final * cantidad_devuelta), 0)
    into v_base_total, v_base_previa
    from public.ventas_items
   where venta_id = p_venta_id
     and negocio_id = v_negocio;

  if v_es_cc then
    if coalesce(v_venta.recargo_cc_monto, 0) > 0 and v_base_total > 0 then
      v_recargo_cc := round(v_venta.recargo_cc_monto * v_base / v_base_total);
    end if;

    v_reduccion := v_base + v_recargo_cc;

    select coalesce(saldo_pendiente, 0) into v_saldo
      from public.clientes
     where id = v_venta.cliente_id
       and negocio_id = v_negocio
       for update;

    if not found then
      raise exception 'CLIENTE_INEXISTENTE';
    end if;

    -- Entero: si el cliente ya había pagado esa parte, queda a favor.
    -- `v_excedente` (devoluciones.excedente_a_devolver) dice cuánto.
    v_credito := v_reduccion;
    v_excedente := greatest(0, v_reduccion - greatest(coalesce(v_saldo, 0), 0));

    if v_credito > 0 then
      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por
      ) values (
        v_negocio, v_venta.cliente_id, p_venta_id, 'CREDITO', v_credito,
        'Devolucion parcial - Venta #' || v_ticket, v_usuario
      );

      update public.clientes
         set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_credito,
             fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_venta.cliente_id)
       where id = v_venta.cliente_id
         and negocio_id = v_negocio;
    end if;
  end if;

  -- A cuenta (venta que no es fiado): la base devuelta queda a favor. En un
  -- fiado ya se acreditó arriba. SECURITY DEFINER: negocio a mano.
  if v_a_cuenta and not v_es_cc and v_base > 0 then
    v_monto_a_cuenta := v_base;
    v_credito := v_base;

    insert into public.cuenta_corriente_movimientos (
      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
      es_saldo_a_favor
    ) values (
      v_negocio, v_venta.cliente_id, p_venta_id, 'CREDITO', v_base,
      'Devolucion parcial - Venta #' || v_ticket || ': a cuenta', v_usuario, true
    );

    update public.clientes
       set saldo_pendiente = coalesce(saldo_pendiente, 0) - v_base,
           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_venta.cliente_id)
     where id = v_venta.cliente_id
       and negocio_id = v_negocio;
  end if;

  -- La plata sale del cajon si el medio ELEGIDO es efectivo; sin eleccion, si
  -- el medio del cobro lo era. La cuenta corriente nunca sale de la caja.
  v_sale_de_caja := (not v_es_cc)
    and coalesce(v_rein_tipo, v_metodo_tipo) = 'EFECTIVO';

  insert into public.devoluciones (
    negocio_id, venta_id, base_devuelta, recargo_devuelto, monto_devuelto,
    recargo_cc_perdonado, credito_cc, excedente_a_devolver,
    metodo_tipo, metodo_nombre, turno_caja_id, motivo_codigo, motivo_detalle,
    reintegro_metodo_id, reintegro_metodo_tipo, reintegro_metodo_nombre,
    creado_por
  ) values (
    v_negocio, p_venta_id, v_base, 0, v_base + v_recargo_cc,
    v_recargo_cc, v_credito, v_excedente,
    v_metodo_tipo, v_metodo_nombre,
    case when v_sale_de_caja then p_turno_id end,
    p_motivo_codigo,
    nullif(btrim(coalesce(p_motivo_detalle, '')), ''),
    v_rein_id, v_rein_tipo, v_rein_nombre,
    v_usuario
  )
  returning id into v_devolucion_id;

  insert into public.devoluciones_items (
    negocio_id, devolucion_id, venta_item_id, variante_id,
    cantidad, precio_final, destino
  )
  select v_negocio, v_devolucion_id, r.venta_item_id, r.variante_id,
         r.cantidad, r.precio_final, r.destino
    from jsonb_to_recordset(v_items) as r(
      venta_item_id uuid, variante_id uuid, cantidad numeric,
      precio_final numeric, destino text
    );

  update public.ventas
     set monto_devuelto      = coalesce(monto_devuelto, 0) + v_base + v_recargo_cc,
         base_devuelta       = coalesce(base_devuelta, 0) + v_base,
         recargo_cc_devuelto = coalesce(recargo_cc_devuelto, 0) + v_recargo_cc
   where id = p_venta_id
     and negocio_id = v_negocio;

  if v_sale_de_caja and v_base > 0 then
    insert into public.egresos (negocio_id, concepto, monto, creado_por, turno_caja_id, tipo)
    values (
      v_negocio,
      'Devolucion parcial - Venta #' || v_ticket,
      round(v_base)::int,
      v_usuario,
      p_turno_id,
      'DEVOLUCION'
    );
  end if;

  return jsonb_build_object(
    'devolucion_id', v_devolucion_id,
    'es_cuenta_corriente', v_es_cc,
    'base_devuelta', v_base,
    'recargo_devuelto', 0,
    'recargo_cc_perdonado', v_recargo_cc,
    'monto_devuelto', v_base + v_recargo_cc,
    'credito_cc', v_credito,
    'excedente_a_devolver', v_excedente,
    'recargo_no_devuelto', case
      when coalesce(v_venta.recargo_metodo_total, 0) > 0 and v_base_total > 0
      then round(v_venta.recargo_metodo_total * v_base / v_base_total)
      else 0 end,
    'metodo_tipo', v_metodo_tipo,
    'metodo_nombre', v_metodo_nombre,
    'reintegro_metodo_tipo', v_rein_tipo,
    'reintegro_metodo_nombre', v_rein_nombre,
    'sale_de_caja', v_sale_de_caja,
    'venta_totalmente_devuelta', v_base_previa >= v_base_total,
    'a_cuenta', v_monto_a_cuenta
  );
end;
$$;


ALTER FUNCTION "public"."registrar_devolucion"("p_venta_id" "uuid", "p_lineas" "jsonb", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_turno_id" "uuid", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_evento_negocio"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.eventos_comerz (negocio_id, tipo, detalle)
    VALUES (NEW.id, 'NEGOCIO_CREADO', jsonb_build_object('nombre', NEW.nombre));
    RETURN NEW;
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    INSERT INTO public.eventos_comerz (negocio_id, tipo, detalle)
    VALUES (NEW.id, 'PLAN_CAMBIADO', jsonb_build_object(
      'desde', (select nombre from public.planes where id = OLD.plan_id),
      'hasta', (select nombre from public.planes where id = NEW.plan_id)
    ));
  END IF;

  IF NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO public.eventos_comerz (negocio_id, tipo, detalle)
    VALUES (NEW.id, 'ESTADO_CAMBIADO', jsonb_build_object(
      'desde', OLD.estado, 'hasta', NEW.estado
    ));
  END IF;

  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    -- El slug viejo se guarda para poder redirigirlo. ON CONFLICT porque un
    -- negocio puede volver a un slug que ya tuvo.
    INSERT INTO public.slugs_historicos (slug, negocio_id)
    VALUES (OLD.slug, NEW.id)
    ON CONFLICT (slug) DO UPDATE SET negocio_id = excluded.negocio_id;

    -- Y si el slug NUEVO estaba en el historial, deja de ser historico: ahora
    -- es el vigente y no puede redirigir a si mismo.
    DELETE FROM public.slugs_historicos WHERE slug = NEW.slug;

    INSERT INTO public.eventos_comerz (negocio_id, tipo, detalle)
    VALUES (NEW.id, 'SLUG_CAMBIADO', jsonb_build_object(
      'desde', OLD.slug, 'hasta', NEW.slug
    ));
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_evento_negocio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_evento_pago"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.eventos_comerz (negocio_id, tipo, detalle)
  VALUES (NEW.negocio_id, 'PAGO_REGISTRADO', jsonb_build_object(
    'monto', NEW.monto, 'periodo_hasta', NEW.periodo_hasta, 'medio', NEW.medio
  ));
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_evento_pago"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_evento_solicitud_plan"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.eventos_comerz (negocio_id, tipo, detalle)
  VALUES (NEW.negocio_id, 'SOLICITUD_PLAN', jsonb_build_object(
    'desde', NEW.plan_actual, 'hasta', NEW.plan_solicitado_nombre
  ));
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_evento_solicitud_plan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_factura_de_venta"("p_venta_id" "uuid", "p_comprobante" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_estado text;
  v_id     uuid;
begin
  if p_comprobante is null
     or p_comprobante->>'tipo' not like 'FACTURA%'
     or nullif(p_comprobante->>'cae', '') is null then
    raise exception 'FACTURA_REQUERIDA';
  end if;

  select estado_operacion into v_estado
    from public.ventas
   where id = p_venta_id
   for update;

  if v_estado is null then
    raise exception 'VENTA_NO_ENCONTRADA';
  end if;
  if v_estado <> 'CONFIRMADA' then
    raise exception 'VENTA_NO_FACTURABLE';
  end if;
  if exists (
    select 1 from public.comprobantes c
     where c.venta_id = p_venta_id
       and c.tipo like 'FACTURA%'
       and c.cae is not null
  ) then
    raise exception 'VENTA_YA_FACTURADA';
  end if;

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    receptor_doc_tipo, receptor_doc_nro,
    neto, iva_monto, exento, no_gravado, total,
    cae, cae_vencimiento, fecha_comprobante,
    arca_ambiente, arca_resultado, arca_observaciones,
    emitido_por
  ) values (
    p_venta_id,
    p_comprobante->>'tipo',
    (p_comprobante->>'punto_venta')::integer,
    (p_comprobante->>'numero')::bigint,
    nullif(p_comprobante->>'cliente_id', '')::uuid,
    nullif(p_comprobante->>'receptor_razon_social', ''),
    nullif(p_comprobante->>'receptor_cuit', ''),
    nullif(p_comprobante->>'receptor_condicion_iva', ''),
    (p_comprobante->>'receptor_doc_tipo')::integer,
    p_comprobante->>'receptor_doc_nro',
    (p_comprobante->>'neto')::numeric,
    (p_comprobante->>'iva_monto')::numeric,
    coalesce((p_comprobante->>'exento')::numeric, 0),
    coalesce((p_comprobante->>'no_gravado')::numeric, 0),
    (p_comprobante->>'total')::numeric,
    p_comprobante->>'cae',
    (p_comprobante->>'cae_vencimiento')::date,
    (p_comprobante->>'fecha_comprobante')::date,
    p_comprobante->>'arca_ambiente',
    p_comprobante->>'arca_resultado',
    p_comprobante->'arca_observaciones',
    (p_comprobante->>'emitido_por')::uuid
  )
  returning id into v_id;

  insert into public.comprobantes_iva (comprobante_id, alicuota_id, base_imponible, importe)
  select v_id,
         (x->>'id')::integer,
         (x->>'base_imponible')::numeric,
         (x->>'importe')::numeric
    from jsonb_array_elements(coalesce(p_comprobante->'iva', '[]'::jsonb)) as x;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."registrar_factura_de_venta"("p_venta_id" "uuid", "p_comprobante" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_factura_de_venta"("p_venta_id" "uuid", "p_comprobante" "jsonb") IS 'Registra la factura (CAE ya pedido a ARCA) de una venta CONFIRMADA que salio con ticket. Una por venta: row lock sobre la venta + VENTA_YA_FACTURADA. SECURITY INVOKER.';



CREATE OR REPLACE FUNCTION "public"."registrar_ingreso_financiero"("p_monto" numeric, "p_tipo" "text", "p_concepto" "text", "p_cuenta_id" "uuid" DEFAULT NULL::"uuid", "p_turno_caja_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."registrar_ingreso_financiero"("p_monto" numeric, "p_tipo" "text", "p_concepto" "text", "p_cuenta_id" "uuid", "p_turno_caja_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_ingreso_financiero"("p_monto" numeric, "p_tipo" "text", "p_concepto" "text", "p_cuenta_id" "uuid", "p_turno_caja_id" "uuid") IS 'Ingreso que no viene de una venta. Cuenta opcional (con turno → cajón, sin turno → caja general); cuenta arqueada exige turno ABIERTO de esa cuenta. impacto_resultado según tipo. Permiso caja.registrar_ingreso.';



CREATE OR REPLACE FUNCTION "public"."registrar_movimiento_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_anterior numeric;
  v_nuevo    numeric;
  v_variante uuid;
  v_producto uuid;
  v_negocio  uuid;
  v_origen   text;
begin
  if coalesce(current_setting('comerz.omitir_movimiento', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_anterior := 0;
    v_nuevo    := coalesce(new.stock, 0);
    v_variante := new.id;
    v_producto := new.producto_id;
    v_negocio  := new.negocio_id;
  elsif tg_op = 'UPDATE' then
    if new.stock is not distinct from old.stock then
      return null;
    end if;
    v_anterior := coalesce(old.stock, 0);
    v_nuevo    := coalesce(new.stock, 0);
    v_variante := new.id;
    v_producto := new.producto_id;
    v_negocio  := new.negocio_id;
  else
    v_anterior := coalesce(old.stock, 0);
    v_nuevo    := 0;
    v_variante := old.id;
    v_producto := old.producto_id;
    v_negocio  := old.negocio_id;
  end if;

  if v_nuevo = v_anterior then
    return null;
  end if;

  v_origen := coalesce(nullif(current_setting('comerz.origen_movimiento', true), ''), 'DESCONOCIDO');
  if v_origen not in (
    'VENTA', 'ANULACION_VENTA', 'DEVOLUCION_PARCIAL', 'REVERSO_VENTA',
    'REMITO', 'CARGA_RAPIDA', 'IMPORTACION', 'EDICION_VARIANTES',
    'BAJA', 'BAJA_PRODUCTO', 'DESCONOCIDO'
  ) then
    v_origen := 'DESCONOCIDO';
  end if;

  insert into public.movimientos_stock (
    negocio_id, variante_id, producto_id,
    delta, stock_anterior, stock_nuevo,
    origen, referencia_id, usuario_id
  ) values (
    v_negocio, v_variante, v_producto,
    v_nuevo - v_anterior, v_anterior, v_nuevo,
    v_origen,
    nullif(current_setting('comerz.referencia_movimiento', true), '')::uuid,
    auth.uid()
  );

  return null;
end;
$$;


ALTER FUNCTION "public"."registrar_movimiento_stock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_paso_onboarding"("p_paso" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    return;
  end if;

  if p_paso not in ('PASO_2_NEGOCIO') then
    raise exception 'PASO_DESCONOCIDO: %', p_paso using errcode = 'P0001';
  end if;

  insert into public.onboarding_pasos_vistos (usuario_id, paso)
  values (auth.uid(), p_paso)
  on conflict (usuario_id, paso) do nothing;
end;
$$;


ALTER FUNCTION "public"."registrar_paso_onboarding"("p_paso" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_paso_onboarding"("p_paso" "text") IS 'Anota que el usuario de la sesión vio un paso del alta. El usuario sale de auth.uid(), nunca del parámetro. Idempotente. Ver 20260909140000.';



CREATE OR REPLACE FUNCTION "public"."registrar_saldo_inicial_cuenta"("p_cuenta_id" "uuid", "p_monto" numeric, "p_detalle" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_cuenta  record;
  v_id      uuid := gen_random_uuid();
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  if not public.is_admin() then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;

  select c.id, c.nombre, c.requiere_arqueo, c.codigo, c.activa
    into v_cuenta
    from public.cuentas_financieras c
   where c.negocio_id = v_negocio
     and c.id = p_cuenta_id;

  if not found or not v_cuenta.activa then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;

  if v_cuenta.codigo = 'POR_ACREDITAR' then
    raise exception 'CUENTA_PUENTE_RESERVADA';
  end if;

  if v_cuenta.requiere_arqueo then
    raise exception 'CAJA_ARQUEADA_USA_FONDO_DE_TURNO';
  end if;

  if exists (
    select 1 from public.movimientos_financieros m
     where m.negocio_id = v_negocio
       and m.cuenta_financiera_id = p_cuenta_id
       and m.evento = 'AJUSTE_SALDO_INICIAL'
  ) then
    raise exception 'SALDO_INICIAL_YA_REGISTRADO';
  end if;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id,
    evento, importe, impacto_resultado, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values (
    v_id, v_negocio, p_cuenta_id, 'AJUSTE', p_cuenta_id,
    'AJUSTE_SALDO_INICIAL', p_monto, 0,
    coalesce(nullif(btrim(p_detalle), ''),
             'Saldo que la cuenta ya tenia al empezar a usarse'),
    jsonb_build_object('cuenta_nombre', v_cuenta.nombre),
    now(), auth.uid()
  );

  return v_id;
end;
$$;


ALTER FUNCTION "public"."registrar_saldo_inicial_cuenta"("p_cuenta_id" "uuid", "p_monto" numeric, "p_detalle" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_saldo_inicial_cuenta"("p_cuenta_id" "uuid", "p_monto" numeric, "p_detalle" "text") IS 'Declara la plata que una cuenta ya tenia. impacto_resultado 0: no es un ingreso. Una sola vez por cuenta, nunca para una cuenta con arqueo, solo ADMIN. Ver 20260921140000.';



CREATE OR REPLACE FUNCTION "public"."registrar_transferencia_financiera"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
begin
  if security.current_negocio_id() is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.transferir') then raise exception 'SIN_PERMISO' using errcode = '42501'; end if;
  return public.registrar_transferencia_financiera_impl(p_cuenta_origen_id, p_cuenta_destino_id, p_monto, p_concepto, p_turno_caja_id, null);
end; $$;


ALTER FUNCTION "public"."registrar_transferencia_financiera"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_transferencia_financiera_impl"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid", "p_revierte_a" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_transferencia uuid; v_operacion uuid := gen_random_uuid();
  v_origen public.cuentas_financieras; v_destino public.cuentas_financieras; v_turno public.turnos_caja;
  v_turno_origen uuid; v_turno_destino uuid; v_datos jsonb;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if p_monto is null or p_monto <= 0 or nullif(btrim(p_concepto), '') is null
     or p_cuenta_origen_id is null or p_cuenta_destino_id is null or p_cuenta_origen_id = p_cuenta_destino_id then
    raise exception 'TRANSFERENCIA_INVALIDA';
  end if;
  select * into v_origen from public.cuentas_financieras where negocio_id = v_negocio and id = p_cuenta_origen_id and activa for update;
  select * into v_destino from public.cuentas_financieras where negocio_id = v_negocio and id = p_cuenta_destino_id and activa for update;
  if v_origen.id is null or v_destino.id is null then raise exception 'CUENTA_NO_DISPONIBLE'; end if;
  if v_origen.tipo = 'PUENTE_ACREDITACION' or v_destino.tipo = 'PUENTE_ACREDITACION' then raise exception 'CUENTA_PUENTE_RESERVADA'; end if;
  if v_origen.requiere_arqueo or v_destino.requiere_arqueo then
    if p_turno_caja_id is null then raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO'; end if;
    select * into v_turno from public.turnos_caja where negocio_id = v_negocio and id = p_turno_caja_id and estado = 'ABIERTO' for update;
    if v_turno.id is null or (v_turno.cuenta_financiera_id <> p_cuenta_origen_id and v_turno.cuenta_financiera_id <> p_cuenta_destino_id) then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
    if v_turno.cuenta_financiera_id = p_cuenta_origen_id then v_turno_origen := v_turno.id; end if;
    if v_turno.cuenta_financiera_id = p_cuenta_destino_id then v_turno_destino := v_turno.id; end if;
  end if;
  insert into public.transferencias_financieras (negocio_id, cuenta_origen_id, cuenta_destino_id, monto, concepto, registrado_por, revierte_a)
  values (v_negocio, p_cuenta_origen_id, p_cuenta_destino_id, p_monto, btrim(p_concepto), auth.uid(), p_revierte_a)
  returning id into v_transferencia;
  v_datos := jsonb_build_object('cuenta_origen_id', p_cuenta_origen_id, 'cuenta_destino_id', p_cuenta_destino_id)
    || case when p_revierte_a is null then '{}'::jsonb else jsonb_build_object('revierte_a', p_revierte_a) end;
  insert into public.movimientos_financieros (operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento, importe, impacto_resultado, turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por) values
  (v_operacion, v_negocio, p_cuenta_origen_id, 'TRANSFERENCIA', v_transferencia, 'REGISTRO', -p_monto, 0, v_turno_origen, format('Transferencia a %s: %s', v_destino.nombre, btrim(p_concepto)), v_datos, now(), auth.uid()),
  (v_operacion, v_negocio, p_cuenta_destino_id, 'TRANSFERENCIA', v_transferencia, 'REGISTRO', p_monto, 0, v_turno_destino, format('Transferencia desde %s: %s', v_origen.nombre, btrim(p_concepto)), v_datos, now(), auth.uid());
  return v_transferencia;
end; $$;


ALTER FUNCTION "public"."registrar_transferencia_financiera_impl"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid", "p_revierte_a" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_venta"("p_venta" "jsonb", "p_pagos" "jsonb" DEFAULT '[]'::"jsonb", "p_items" "jsonb" DEFAULT '[]'::"jsonb", "p_stock_legacy" "jsonb" DEFAULT '[]'::"jsonb", "p_descuento" "jsonb" DEFAULT NULL::"jsonb", "p_cc" "jsonb" DEFAULT NULL::"jsonb", "p_reserva_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_venta_id uuid;
  v_fecha_venta timestamptz;
  v_vencimiento date;
  v_turno uuid := nullif(p_venta->>'turno_caja_id', '')::uuid;
  v_vendedor uuid := (p_venta->>'vendedor_id')::uuid;
  v_cliente uuid;
  v_pendiente numeric;
  v_promocion uuid;
  v_recargo_cc numeric;
  v_favor numeric;
  v_cliente_favor uuid;
  v_saldo_favor numeric;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  insert into public.ventas (
    id, negocio_id, vendedor_id, cliente_id, turno_caja_id, estado_operacion,
    metodo_pago, total, precio_costo, cantidad, total_bruto,
    recargo_metodo_total, comision_total, total_neto, es_pago_mixto,
    monto_cobrado, monto_pendiente, estado_pago,
    recargo_cc_porcentaje, recargo_cc_monto,
    fecha_venta, registrada_offline, desfasaje_precio,
    lista_precio_id, lista_precio_nombre
  )
  values (
    (p_venta->>'id')::uuid,
    v_negocio,
    v_vendedor,
    nullif(p_venta->>'cliente_id', '')::uuid,
    v_turno,
    p_venta->>'estado_operacion',
    p_venta->>'metodo_pago',
    (p_venta->>'total')::numeric,
    (p_venta->>'precio_costo')::numeric,
    (p_venta->>'cantidad')::numeric,
    (p_venta->>'total_bruto')::numeric,
    (p_venta->>'recargo_metodo_total')::numeric,
    (p_venta->>'comision_total')::numeric,
    (p_venta->>'total_neto')::numeric,
    (p_venta->>'es_pago_mixto')::boolean,
    (p_venta->>'monto_cobrado')::numeric,
    (p_venta->>'monto_pendiente')::numeric,
    p_venta->>'estado_pago',
    (p_venta->>'recargo_cc_porcentaje')::numeric,
    (p_venta->>'recargo_cc_monto')::numeric,
    coalesce((p_venta->>'fecha_venta')::timestamptz, now()),
    coalesce((p_venta->>'registrada_offline')::boolean, false),
    (p_venta->>'desfasaje_precio')::numeric,
    nullif(p_venta->>'lista_precio_id', '')::uuid,
    nullif(p_venta->>'lista_precio_nombre', '')
  )
  on conflict (id) do nothing
  returning id, fecha_venta into v_venta_id, v_fecha_venta;

  if v_venta_id is null then
    return jsonb_build_object(
      'ya_registrada', true,
      'venta_id', (p_venta->>'id')::uuid
    );
  end if;

  insert into public.venta_pagos (
    negocio_id, venta_id, metodo_pago_id, metodo_nombre, metodo_tipo,
    monto_base, recargo_porcentaje, recargo_monto, monto_bruto,
    comision_porcentaje, comision_monto, monto_neto, acreditacion_dias,
    turno_caja_id
  )
  select
    v_negocio, v_venta_id, p.metodo_pago_id, p.metodo_nombre, p.metodo_tipo,
    p.monto_base, p.recargo_porcentaje, p.recargo_monto, p.monto_bruto,
    p.comision_porcentaje, p.comision_monto, p.monto_neto,
    p.acreditacion_dias, v_turno
  from jsonb_to_recordset(p_pagos) as p(
    metodo_pago_id uuid, metodo_nombre text, metodo_tipo text,
    monto_base numeric, recargo_porcentaje numeric, recargo_monto numeric,
    monto_bruto numeric, comision_porcentaje numeric, comision_monto numeric,
    monto_neto numeric, acreditacion_dias int
  );

  insert into public.ventas_items (
    negocio_id, venta_id, producto_id, variante, variante_id, unidad_serie_id, cantidad,
    precio_unitario, precio_costo, descuento_monto, precio_final,
    promocion_id, promocion_nombre, es_venta_libre
  )
  select
    v_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.unidad_serie_id,
    i.cantidad, i.precio_unitario, i.precio_costo, i.descuento_monto,
    i.precio_final, i.promocion_id, i.promocion_nombre,
    coalesce(i.es_venta_libre, false)
  from jsonb_to_recordset(p_items) as i(
    producto_id uuid, variante text, variante_id uuid, unidad_serie_id uuid, cantidad numeric,
    precio_unitario numeric, precio_costo numeric, descuento_monto numeric,
    precio_final numeric, promocion_id uuid, promocion_nombre text,
    es_venta_libre boolean
  );

  if not exists (select 1 from public.ventas_items where venta_id = v_venta_id) then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;

  if p_descuento is not null then
    v_promocion := (p_descuento->>'promocion_id')::uuid;

    insert into public.ventas_descuentos (
      negocio_id, venta_id, promocion_id, promocion_nombre, tipo_descuento,
      monto_descontado
    )
    values (
      v_negocio, v_venta_id, v_promocion,
      p_descuento->>'promocion_nombre',
      p_descuento->>'tipo_descuento',
      (p_descuento->>'monto_descontado')::numeric
    );

    update public.promociones
       set usos_actuales = coalesce(usos_actuales, 0) + 1
     where id = v_promocion;
  end if;

  -- SALDO A FAVOR (20260928240000). Va ANTES del fiado: primero se usa lo
  -- que la clienta ya tenía, después se fía el resto. No es una fila de
  -- venta_pagos: esa plata entró antes. El tope es contra el saldo releído
  -- con el cliente bloqueado.
  v_favor := coalesce((p_venta->>'saldo_a_favor_aplicado')::numeric, 0);
  if v_favor < 0 then
    raise exception 'SALDO_A_FAVOR_INVALIDO';
  end if;
  if v_favor > 0 then
    v_cliente_favor := nullif(p_venta->>'cliente_id', '')::uuid;
    if v_cliente_favor is null then
      raise exception 'SALDO_A_FAVOR_SIN_CLIENTE';
    end if;

    select coalesce(c.saldo_pendiente, 0) into v_saldo_favor
      from public.clientes c
     where c.id = v_cliente_favor
       and c.negocio_id = v_negocio
       for update;
    if not found then
      raise exception 'CLIENTE_NO_ENCONTRADO';
    end if;

    if round(v_favor, 2) > round(-v_saldo_favor, 2) then
      raise exception 'SALDO_A_FAVOR_INSUFICIENTE'
        using detail = jsonb_build_object(
          'disponible', greatest(-v_saldo_favor, 0), 'monto', v_favor)::text;
    end if;

    insert into public.cuenta_corriente_movimientos (
      negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
      monto_recargo, recargo_porcentaje, es_saldo_a_favor
    ) values (
      v_negocio, v_cliente_favor, v_venta_id, 'DEBITO', v_favor,
      coalesce(nullif(p_venta->>'saldo_a_favor_descripcion', ''), 'Pago con saldo a favor'),
      v_vendedor, 0, 0, true
    );

    update public.clientes c
       set saldo_pendiente = coalesce(c.saldo_pendiente, 0) + v_favor,
           fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(v_cliente_favor)
     where c.id = v_cliente_favor
       and c.negocio_id = v_negocio;

    update public.ventas
       set saldo_a_favor_aplicado = v_favor
     where id = v_venta_id;
  end if;

  if p_cc is not null then
    v_cliente := nullif(p_cc->>'cliente_id', '')::uuid;
    v_pendiente := coalesce((p_cc->>'monto_pendiente')::numeric, 0);

    if v_cliente is not null and v_pendiente > 0.05 then
      v_vencimiento := (v_fecha_venta at time zone 'UTC')::date
                       + coalesce((p_cc->>'plazo_mora')::int, 30);

      v_recargo_cc := least(
        coalesce((p_venta->>'recargo_cc_monto')::numeric, 0),
        v_pendiente
      );

      insert into public.cuenta_corriente_movimientos (
        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,
        monto_recargo, recargo_porcentaje
      )
      values (
        v_negocio, v_cliente, v_venta_id, 'DEBITO', v_pendiente,
        p_cc->>'descripcion', v_vendedor,
        v_recargo_cc,
        (p_venta->>'recargo_cc_porcentaje')::numeric
      );

      update public.clientes
         set saldo_pendiente = coalesce(saldo_pendiente, 0) + v_pendiente,
             fecha_vencimiento_deuda = coalesce(
               public.recalcular_vencimiento_cc(v_cliente),
               v_vencimiento
             )
       where id = v_cliente;

      if not found then
        raise exception 'CLIENTE_NO_ENCONTRADO';
      end if;

      update public.ventas
         set fecha_vencimiento = v_vencimiento
       where id = v_venta_id;
    end if;
  end if;

  update public.productos_stock ps
     set cantidad = ps.cantidad - s.cantidad
    from jsonb_to_recordset(p_stock_legacy) as s(stock_id uuid, cantidad numeric)
   where ps.id = s.stock_id;

  if array_length(p_reserva_ids, 1) > 0 then
    update public.reservas
       set estado = 'CONFIRMADA',
           venta_id = v_venta_id,
           resuelto_en = now()
     where id = any(p_reserva_ids)
       and estado = 'ACTIVA';
  end if;

  return jsonb_build_object(
    'venta_id', v_venta_id,
    'fecha_venta', v_fecha_venta,
    'fecha_vencimiento', v_vencimiento
  );
end;
$$;


ALTER FUNCTION "public"."registrar_venta"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_venta"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[]) IS 'Escribe una venta completa (cabecera + pagos + renglones + descuento + deuda de cuenta corriente + espejo legacy de stock + reservas) en UNA transaccion. El descuento de stock y las unidades serializadas quedan AFUERA a proposito: ya son atomicos y tienen su reversion en create-sale.ts.';



CREATE OR REPLACE FUNCTION "public"."registrar_venta_facturada"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[], "p_comprobante" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_resultado jsonb;
  v_venta_id  uuid;
  v_id        uuid;
begin
  v_resultado := public.registrar_venta(
    p_venta, p_pagos, p_items, p_stock_legacy, p_descuento, p_cc, p_reserva_ids
  );

  if coalesce((v_resultado->>'ya_registrada')::boolean, false) then
    return v_resultado;
  end if;

  if p_comprobante is null then
    raise exception 'COMPROBANTE_REQUERIDO';
  end if;
  if p_comprobante->>'tipo' = 'TICKET' or nullif(p_comprobante->>'cae', '') is null then
    raise exception 'COMPROBANTE_SIN_CAE';
  end if;

  v_venta_id := (v_resultado->>'venta_id')::uuid;

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    receptor_doc_tipo, receptor_doc_nro,
    neto, iva_monto, exento, no_gravado, total,
    cae, cae_vencimiento, fecha_comprobante,
    arca_ambiente, arca_resultado, arca_observaciones,
    emitido_por
  ) values (
    v_venta_id,
    p_comprobante->>'tipo',
    (p_comprobante->>'punto_venta')::integer,
    (p_comprobante->>'numero')::bigint,
    nullif(p_comprobante->>'cliente_id', '')::uuid,
    nullif(p_comprobante->>'receptor_razon_social', ''),
    nullif(p_comprobante->>'receptor_cuit', ''),
    nullif(p_comprobante->>'receptor_condicion_iva', ''),
    (p_comprobante->>'receptor_doc_tipo')::integer,
    p_comprobante->>'receptor_doc_nro',
    (p_comprobante->>'neto')::numeric,
    (p_comprobante->>'iva_monto')::numeric,
    coalesce((p_comprobante->>'exento')::numeric, 0),
    coalesce((p_comprobante->>'no_gravado')::numeric, 0),
    (p_comprobante->>'total')::numeric,
    p_comprobante->>'cae',
    (p_comprobante->>'cae_vencimiento')::date,
    (p_comprobante->>'fecha_comprobante')::date,
    p_comprobante->>'arca_ambiente',
    p_comprobante->>'arca_resultado',
    p_comprobante->'arca_observaciones',
    (p_comprobante->>'emitido_por')::uuid
  )
  returning id into v_id;

  insert into public.comprobantes_iva (comprobante_id, alicuota_id, base_imponible, importe)
  select v_id,
         (x->>'id')::integer,
         (x->>'base_imponible')::numeric,
         (x->>'importe')::numeric
    from jsonb_array_elements(coalesce(p_comprobante->'iva', '[]'::jsonb)) as x;

  return v_resultado || jsonb_build_object('comprobante_id', v_id);
end;
$$;


ALTER FUNCTION "public"."registrar_venta_facturada"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[], "p_comprobante" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."registrar_venta_facturada"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[], "p_comprobante" "jsonb") IS 'registrar_venta + la fila de comprobantes (con CAE ya pedido a ARCA) + comprobantes_iva, en UNA transaccion. SECURITY INVOKER a proposito. Wrapper: no reescribe registrar_venta.';



CREATE OR REPLACE FUNCTION "public"."reglas_negocio"("p_negocio" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(p.reglas, '{}'::jsonb) || coalesce(n.reglas_override, '{}'::jsonb)
  from public.negocios n
  left join public.planes p on p.id = n.plan_id
  where n.id = p_negocio;
$$;


ALTER FUNCTION "public"."reglas_negocio"("p_negocio" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reglas_negocio"("p_negocio" "uuid") IS 'Reglas efectivas del negocio: las del plan con negocios.reglas_override aplicado encima. Unica fuente para limites y features.';



CREATE OR REPLACE FUNCTION "public"."reglas_plan"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.reglas_negocio(security.current_negocio_id()), '{}'::jsonb);
$$;


ALTER FUNCTION "public"."reglas_plan"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rentabilidad_por_metodo"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_desde   date;
  v_hasta   date;
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenes permiso para ver la rentabilidad por metodo'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;

  if p_periodo is not null then
    v_hasta := v_hoy;
    v_desde := case p_periodo
      when 'hoy'    then v_hoy
      when 'semana' then (date_trunc('week',  v_hoy)::date)
      when 'mes'    then (date_trunc('month', v_hoy)::date)
      when 'anio'   then (date_trunc('year',  v_hoy)::date)
      else v_hoy
    end;
  else
    v_hasta := coalesce(p_hasta, v_hoy);
    v_desde := coalesce(p_desde, v_hasta - 29);
  end if;

  with
  pagos as (
    select vp.*
      from public.venta_pagos vp
     where vp.negocio_id = v_negocio
       and vp.estado_pago_operacion <> 'ANULADO'
       and (vp.creado_en at time zone v_tz)::date between v_desde and v_hasta
  ),
  directos as (
    select
      vp.metodo_nombre,
      vp.metodo_tipo,
      count(*)                            as operaciones,
      sum(vp.monto_base)                  as base,
      sum(coalesce(vp.recargo_monto, 0))  as recargo,
      sum(coalesce(vp.comision_monto, 0)) as comision,
      sum(vp.monto_neto)                  as neto,
      case when sum(vp.monto_bruto) > 0
           then sum(coalesce(vp.acreditacion_dias, 0) * vp.monto_bruto) / sum(vp.monto_bruto)
      end                                 as dias_acreditacion
    from pagos vp
    where vp.tipo_movimiento = 'PAGO_VENTA'
    group by vp.metodo_nombre, vp.metodo_tipo
  ),
  costo_cobranza_cc as (
    select
      coalesce(sum(coalesce(vp.comision_monto, 0)), 0) as comision,
      coalesce(sum(vp.monto_bruto), 0)                 as cobrado,
      count(*)                                         as operaciones
    from pagos vp
    where vp.tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'
  ),
  fiado as (
    select
      count(*)                                                 as operaciones,
      coalesce(sum(m.monto - coalesce(m.monto_recargo, 0)), 0) as base,
      coalesce(sum(coalesce(m.monto_recargo, 0)), 0)           as recargo,
      count(*) filter (where m.recargo_porcentaje is null)     as sin_dato_recargo
    from public.cuenta_corriente_movimientos m
    where m.negocio_id = v_negocio
      and m.tipo = 'DEBITO'
      and coalesce(m.anulado, false) = false
      and not m.es_saldo_a_favor
      and (m.creado_en at time zone v_tz)::date between v_desde and v_hasta
  ),
  deuda_foto as (
    select
      coalesce(sum(c.saldo_pendiente), 0)                        as pendiente,
      coalesce(sum(c.saldo_pendiente) filter (
        where c.fecha_vencimiento_deuda < v_hoy), 0)             as vencido,
      count(*) filter (where coalesce(c.saldo_pendiente, 0) > 0) as clientes,
      count(*) filter (where coalesce(c.saldo_pendiente, 0) > 0
                         and c.fecha_vencimiento_deuda < v_hoy)  as clientes_vencidos
    from public.clientes c
    where c.negocio_id = v_negocio
      and coalesce(c.saldo_pendiente, 0) > 0
  ),
  plazo as (
    select coalesce(cc_plazo_mora, 30) as dias
      from public.configuracion_pos
     where negocio_id = v_negocio
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', p_periodo,
    'generado_en', now(),
    'medios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'medio', metodo_nombre,
        'tipo', metodo_tipo,
        'operaciones', operaciones,
        'base', round(base, 2),
        'recargo', round(recargo, 2),
        'comision', round(comision, 2),
        'neto', round(neto, 2),
        'rendimiento_pct', case when base > 0
          then round((recargo - comision) * 100.0 / base, 2) end,
        'dias_acreditacion', round(coalesce(dias_acreditacion, 0), 1),
        'es_credito', false
      ) order by base desc), '[]'::jsonb)
      from directos
    ),
    'cuenta_corriente', (
      select jsonb_build_object(
        'operaciones', f.operaciones,
        'base', round(f.base, 2),
        'recargo', round(f.recargo, 2),
        'comision_de_cobranza', round(c.comision, 2),
        'neto_devengado', round(f.base + f.recargo - c.comision, 2),
        'rendimiento_pct', case when f.base > 0
          then round((f.recargo - c.comision) * 100.0 / f.base, 2) end,
        'cobrado_en_periodo', round(c.cobrado, 2),
        'cobranzas', c.operaciones,
        'dias_plazo_pactado', (select dias from plazo),
        'pendiente_foto', round(d.pendiente, 2),
        'vencido_foto', round(d.vencido, 2),
        'clientes_foto', d.clientes,
        'clientes_vencidos_foto', d.clientes_vencidos,
        'sin_dato_recargo', f.sin_dato_recargo,
        'es_credito', true
      )
      from fiado f, costo_cobranza_cc c, deuda_foto d
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."rentabilidad_por_metodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."rentabilidad_por_metodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") IS 'Comerz Insights: rendimiento de cada forma de cobrar (recargo cobrado menos comision pagada, sobre la base). Cuenta corriente va aparte porque es credito, no cobro, y su neto es devengado. Gate: caja.ver_gerencial.';



CREATE OR REPLACE FUNCTION "public"."resolver_medio_reintegro"("p_metodo_id" "uuid") RETURNS TABLE("metodo_id" "uuid", "metodo_tipo" "text", "metodo_nombre" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if p_metodo_id is null then
    return;
  end if;

  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  -- El permiso se chequea ACA y no en la pantalla: el boton escondido no es
  -- control de acceso, y las dos RPC son alcanzables desde un endpoint.
  if not public.tiene_permiso('ventas.elegir_medio_devolucion') then
    raise exception 'SIN_PERMISO_MEDIO_REINTEGRO';
  end if;

  -- SECURITY DEFINER: el filtro por negocio va a mano en cada consulta.
  return query
    select m.id, m.tipo, m.nombre
      from public.metodos_pago m
     where m.id = p_metodo_id
       and m.negocio_id = v_negocio
       and m.activo;

  if not found then
    raise exception 'METODO_REINTEGRO_INEXISTENTE';
  end if;
end;
$$;


ALTER FUNCTION "public"."resolver_medio_reintegro"("p_metodo_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resolver_medio_reintegro"("p_metodo_id" "uuid") IS 'Valida el permiso y devuelve el metodo de pago elegido para el reintegro. null entra y null sale: no elegir no es un error, es el comportamiento de siempre.';



CREATE OR REPLACE FUNCTION "public"."resumen_cuenta_por_token"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_tz       constant text := 'America/Argentina/Buenos_Aires';
  v_dias     constant int := 365;
  v_cliente  record;
  v_config   record;
  v_negocio  record;
  v_hoy      date;
  v_desde    date;
  v_out      jsonb;
begin
  if p_token is null or length(p_token) < 24 then
    return null;
  end if;

  select c.* into v_cliente
  from public.clientes c
  where c.resumen_token = p_token;

  if not found then
    return null;
  end if;

  v_hoy := (now() at time zone v_tz)::date;
  v_desde := v_hoy - v_dias;

  select n.nombre into v_negocio
  from public.negocios n
  where n.id = v_cliente.negocio_id;

  select cp."posName" as pos_name, cp.direccion, cp.whatsapp into v_config
  from public.configuracion_pos cp
  where cp.negocio_id = v_cliente.negocio_id
  limit 1;

  with base as (
    select
      coalesce(m.fecha_origen, (m.creado_en at time zone v_tz)::date) as fecha,
      m.creado_en,
      m.tipo,
      m.monto,
      m.descripcion
    from public.cuenta_corriente_movimientos m
    where m.cliente_id = v_cliente.id
      and m.anulado = false
  ),
  anterior as (
    select coalesce(
      sum(case when tipo = 'DEBITO' then monto else -monto end), 0
    ) as saldo
    from base
    where fecha < v_desde
  ),
  periodo as (
    select
      b.fecha,
      b.creado_en,
      b.tipo,
      b.monto,
      b.descripcion,
      (select saldo from anterior)
        + sum(case when b.tipo = 'DEBITO' then b.monto else -b.monto end)
          over (order by b.fecha, b.creado_en
                rows between unbounded preceding and current row) as saldo_corriente
    from base b
    where b.fecha >= v_desde
  )
  select jsonb_build_object(
    'comercio', jsonb_build_object(
      'nombre', coalesce(v_config.pos_name, v_negocio.nombre),
      'direccion', v_config.direccion,
      'whatsapp', v_config.whatsapp
    ),
    'cliente', jsonb_build_object(
      'nombre', v_cliente.nombre,
      'telefono', nullif(btrim(coalesce(v_cliente.telefono, '')), ''),
      'dni', nullif(btrim(coalesce(v_cliente.dni, '')), '')
    ),
    'desde', v_desde,
    'hasta', v_hoy,
    'emitido_en', now(),
    'saldo_anterior', round((select saldo from anterior), 2),
    'saldo_actual', round(coalesce(v_cliente.saldo_pendiente, 0), 2),
    'vence_el', v_cliente.fecha_vencimiento_deuda,
    'movimientos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'fecha', fecha,
        'concepto', coalesce(nullif(btrim(descripcion), ''),
                             case when tipo = 'DEBITO' then 'Compra' else 'Pago' end),
        'tipo', tipo,
        'monto', round(monto, 2),
        'saldo', round(saldo_corriente, 2)
      ) order by fecha, creado_en), '[]'::jsonb)
      from periodo
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."resumen_cuenta_por_token"("p_token" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resumen_cuenta_por_token"("p_token" "text") IS 'Resumen de cuenta corriente por token, para la pagina publica /r/[token]. SECURITY DEFINER: el token es la credencial y anon no tiene policies sobre clientes. No es un comprobante fiscal.';



CREATE OR REPLACE FUNCTION "public"."resumen_financiero_periodo"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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

  v_ini := (v_desde::timestamp) at time zone v_tz;
  v_fin := ((v_hasta + 1)::timestamp) at time zone v_tz;

  with cobros as (
    select vp.metodo_tipo, vp.tipo_movimiento, vp.monto_bruto
      from public.venta_pagos vp
     where vp.negocio_id = v_negocio
       and vp.creado_en >= v_ini and vp.creado_en < v_fin
       and (coalesce(vp.estado_pago_operacion, 'CONFIRMADO') <> 'ANULADO'
            -- Anulada con reintegro a cuenta: la plata se quedó en el negocio.
            or exists (select 1 from public.ventas v
                        where v.id = vp.venta_id
                          and v.negocio_id = v_negocio
                          and v.reintegro_metodo_tipo = 'SALDO_A_FAVOR'))
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
      from (select mm.origen_id, sum(mm.importe) as importe
              from public.movimientos_financieros mm
             where mm.negocio_id = v_negocio
               and mm.origen_tipo = 'TURNO_CAJA'
               and (mm.evento = 'AJUSTE_ARQUEO'
                    or (mm.evento = 'CORRECCION_REVERSA'
                        and mm.datos->>'evento_corregido' = 'AJUSTE_ARQUEO'))
               and mm.fecha_movimiento >= v_ini and mm.fecha_movimiento < v_fin
             group by mm.origen_id) m
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


ALTER FUNCTION "public"."resumen_financiero_periodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resumen_financiero_periodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") IS 'Flujo del período para la pestaña Dinero: cobros no anulados (por medio; ventas y cobros de deuda aparte), otros ingresos (libres, por tipo), reintegros, egresos por tipo y gastos operativos por categoría, transferencias, faltantes/sobrantes de arqueo y neto_caja. neto_caja NO es ganancia (no tiene costo de mercadería). Gate caja.ver_gerencial.';



CREATE OR REPLACE FUNCTION "public"."resumen_gerencial_caja"("p_fecha" "date" DEFAULT NULL::"date") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_fecha date := coalesce(p_fecha, (now() at time zone v_tz)::date);
  v_negocio uuid := security.current_negocio_id();
  v_out jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver el resumen gerencial de caja' using errcode='42501';
  end if;
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode='42501';
  end if;

  with turnos_dia as (
    select id, estado, monto_inicial, monto_declarado, cuenta_financiera_id
      from public.turnos_caja
     where negocio_id = v_negocio
       and (fecha_apertura at time zone v_tz)::date = v_fecha
  ), pagos as (
    select vp.venta_id, vp.metodo_tipo, vp.monto_bruto, vp.tipo_movimiento
      from public.venta_pagos vp
      join turnos_dia t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio
       and vp.estado_pago_operacion <> 'ANULADO'
  ), pagos_caja as (
    select vp.monto_bruto
      from public.venta_pagos vp
      join turnos_dia t on t.id = vp.turno_caja_id
     where vp.negocio_id = v_negocio
       and vp.metodo_tipo = 'EFECTIVO'
  ), ventas_dia as (
    select v.id, v.monto_pendiente
      from public.ventas v
      join turnos_dia t on t.id = v.turno_caja_id
     where v.negocio_id = v_negocio
       and v.estado_operacion <> 'ANULADA'
  ), tipos as (
    select * from (values ('EFECTIVO'), ('TRANSFERENCIA'), ('TARJETA')) c(tipo)
    union select metodo_tipo from pagos
  ), medios as (
    select metodo_tipo tipo, sum(monto_bruto) monto,
           count(distinct venta_id) filter (where venta_id is not null) cantidad_ventas,
           coalesce(sum(monto_bruto) filter (where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'), 0) monto_cobranzas_cc
      from pagos group by metodo_tipo
  ), breakdown as (
    select t.tipo, coalesce(m.monto, 0) monto,
           coalesce(m.cantidad_ventas, 0) cantidad_ventas,
           coalesce(m.monto_cobranzas_cc, 0) monto_cobranzas_cc
      from tipos t left join medios m on m.tipo = t.tipo
  ), egresos_caja as (
    select coalesce(sum(e.monto), 0) total
      from public.egresos e
      join turnos_dia t on t.id = e.turno_caja_id
       and t.cuenta_financiera_id = e.cuenta_origen_id
     where e.negocio_id = v_negocio
  ), transferencias_caja as (
    select coalesce(sum(m.importe), 0) neto
      from public.movimientos_financieros m
      join turnos_dia t on t.id = m.turno_caja_id
       and t.cuenta_financiera_id = m.cuenta_financiera_id
     where m.negocio_id = v_negocio and m.origen_tipo in ('TRANSFERENCIA', 'INGRESO')
  ), caja as (
    select (select coalesce(sum(monto_inicial), 0) from turnos_dia) fondo_inicial,
           (select coalesce(sum(monto_bruto), 0) from pagos_caja) ingresos_efectivo,
           (select total from egresos_caja) egresos_efectivo,
           (select neto from transferencias_caja) transferencias_netas,
           (select count(*) from turnos_dia) turnos_totales,
           (select count(*) from turnos_dia where estado <> 'CERRADO') turnos_abiertos,
           (select coalesce(sum(monto_declarado), 0) from turnos_dia where estado = 'CERRADO') real_declarado
  )
  select jsonb_build_object(
    'fecha', v_fecha,
    'generado_en', now(),
    'ventas', jsonb_build_object(
      'total_cobrado', (select coalesce(sum(monto_bruto), 0) from pagos where tipo_movimiento = 'PAGO_VENTA'),
      'cantidad_ventas', (select count(distinct venta_id) from pagos where tipo_movimiento = 'PAGO_VENTA' and venta_id is not null)
    ),
    'cuenta_corriente', jsonb_build_object(
      'fiado_otorgado', (select coalesce(sum(monto_pendiente), 0) from ventas_dia),
      'cantidad_ventas_con_fiado', (select count(*) from ventas_dia where monto_pendiente > 0),
      'cobranzas_monto', (select coalesce(sum(monto_bruto), 0) from pagos where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'),
      'cobranzas_cantidad', (select count(*) from pagos where tipo_movimiento = 'PAGO_CUENTA_CORRIENTE')
    ),
    'breakdown_medios', (select coalesce(jsonb_agg(jsonb_build_object(
        'tipo', tipo, 'monto', monto, 'cantidad_ventas', cantidad_ventas,
        'monto_cobranzas_cc', monto_cobranzas_cc
      ) order by monto desc, tipo), '[]'::jsonb) from breakdown),
    'caja', (select jsonb_build_object(
        'fondo_inicial', fondo_inicial,
        'ingresos_efectivo', ingresos_efectivo,
        'egresos_efectivo', egresos_efectivo,
        'transferencias_netas', transferencias_netas,
        'esperado', fondo_inicial + ingresos_efectivo - egresos_efectivo + transferencias_netas,
        'turnos_totales', turnos_totales,
        'turnos_abiertos', turnos_abiertos,
        'cierre_completo', turnos_totales > 0 and turnos_abiertos = 0,
        'real_declarado', case when turnos_totales > 0 and turnos_abiertos = 0 then real_declarado end,
        'diferencia', case when turnos_totales > 0 and turnos_abiertos = 0
                      then real_declarado - (fondo_inicial + ingresos_efectivo - egresos_efectivo + transferencias_netas) end
      ) from caja)
  ) into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."resumen_gerencial_caja"("p_fecha" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."resumen_gerencial_caja"("p_fecha" "date") IS 'Resumen del dia para caja. NO resta ventas.monto_devuelto y no debe hacerlo: la plata sale de venta_pagos menos egresos, y una devolucion en efectivo ya inserto su egreso. Restarla de nuevo la contaria dos veces y el turno cerraria con faltante. Ver 20260903180000.';



CREATE OR REPLACE FUNCTION "public"."resumen_remitos_financiero"() RETURNS TABLE("id" "uuid", "proveedor" "text", "fecha_remito" "date", "estado" "text", "creado_en" timestamp with time zone, "valor_historico" numeric, "total_pagado" numeric, "saldo_pendiente" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select o.id, o.proveedor, o.fecha_remito, o.estado, o.creado_en,
    coalesce(sum(oi.cantidad * oi.precio_costo), 0)::numeric as valor_historico,
    coalesce((select sum(e.monto) from public.egresos e
      where e.orden_compra_id = o.id and e.tipo = 'COMPRA_MERCADERIA'), 0)::numeric as total_pagado,
    greatest(coalesce(sum(oi.cantidad * oi.precio_costo), 0) - coalesce((select sum(e.monto) from public.egresos e
      where e.orden_compra_id = o.id and e.tipo = 'COMPRA_MERCADERIA'), 0), 0)::numeric as saldo_pendiente
  from public.ordenes_compra o left join public.ordenes_items oi on oi.orden_id = o.id
  group by o.id
  order by o.creado_en desc;
$$;


ALTER FUNCTION "public"."resumen_remitos_financiero"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revertir_transferencia_financiera"("p_transferencia_id" "uuid", "p_motivo" "text", "p_turno_caja_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare v_negocio uuid := security.current_negocio_id(); v_original public.transferencias_financieras;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.anular_movimiento') then raise exception 'SIN_PERMISO' using errcode = '42501'; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;
  select * into v_original from public.transferencias_financieras where id = p_transferencia_id and negocio_id = v_negocio for update;
  if v_original.id is null then raise exception 'TRANSFERENCIA_NO_ENCONTRADA'; end if;
  if v_original.revierte_a is not null then
    raise exception 'ES_UNA_REVERSA' using hint = 'Una reversa no se revierte: registrá la transferencia de nuevo.';
  end if;
  if exists (select 1 from public.transferencias_financieras where revierte_a = v_original.id) then raise exception 'TRANSFERENCIA_YA_REVERTIDA'; end if;
  return public.registrar_transferencia_financiera_impl(v_original.cuenta_destino_id, v_original.cuenta_origen_id, v_original.monto,
    format('Reversa de "%s": %s', v_original.concepto, btrim(p_motivo)), p_turno_caja_id, v_original.id);
end; $$;


ALTER FUNCTION "public"."revertir_transferencia_financiera"("p_transferencia_id" "uuid", "p_motivo" "text", "p_turno_caja_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."revertir_transferencia_financiera"("p_transferencia_id" "uuid", "p_motivo" "text", "p_turno_caja_id" "uuid") IS 'Registra la transferencia compensatoria (destino → origen, mismo monto) con revierte_a apuntando a la original. Una vez por original; una reversa no se revierte. Permiso caja.anular_movimiento.';



CREATE OR REPLACE FUNCTION "public"."revertir_unidades_serie"("p_venta_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_afectadas integer;
BEGIN
  UPDATE public.unidades_serie
  SET estado = 'disponible',
      fecha_venta = NULL,
      venta_id = NULL
  WHERE venta_id = p_venta_id
    AND estado = 'vendido';

  GET DIAGNOSTICS v_afectadas = ROW_COUNT;
  RETURN v_afectadas;
END;
$$;


ALTER FUNCTION "public"."revertir_unidades_serie"("p_venta_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rol_actual"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN security.is_super_admin() AND security.current_negocio_id() IS NOT NULL
      THEN 'ADMIN'
    ELSE (
      SELECT un.rol
      FROM public.usuarios_negocios un
      WHERE un.usuario_id = auth.uid()
        AND un.negocio_id = security.current_negocio_id()
    )
  END;
$$;


ALTER FUNCTION "public"."rol_actual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_catalogo_electro"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_cat record;
  v_atributos text[];
  v_atributo text;
  v_cat_id uuid;
  v_atr_id uuid;
  v_orden int;
  v_links int := 0;
BEGIN
  -- 1. Las 4 categorías raíz de electro
  INSERT INTO public.categorias (nombre, slug, orden, activa)
  VALUES
    ('Celulares',            'celulares',            10, true),
    ('Tablets',              'tablets',              20, true),
    ('Televisores',          'televisores',          30, true),
    ('Aires Acondicionados', 'aires-acondicionados', 40, true)
  ON CONFLICT (negocio_id, slug) WHERE parent_id IS NULL DO NOTHING;

  -- 2. Los atributos. `Color` puede existir ya si el proyecto tuvo
  --    indumentaria antes; el ON CONFLICT lo reusa en vez de duplicarlo.
  INSERT INTO public.atributos (nombre, slug, tipo, orden, activo)
  VALUES
    ('Almacenamiento', 'almacenamiento', 'TEXT', 10, true),
    ('RAM',            'ram',            'TEXT', 20, true),
    ('Color',          'color',          'TEXT', 30, true),
    ('Pulgadas',       'pulgadas',       'TEXT', 40, true),
    ('Resolución',     'resolucion',     'TEXT', 50, true),
    ('Frigorías',      'frigorias',      'TEXT', 60, true),
    ('Tipo',           'tipo',           'TEXT', 70, true)
  ON CONFLICT (negocio_id, slug) DO NOTHING;

  -- 3. Qué atributos aplican a cada categoría
  FOR v_cat IN
    SELECT * FROM (VALUES
      ('celulares',            ARRAY['almacenamiento','ram','color']),
      ('tablets',              ARRAY['almacenamiento','ram','color']),
      ('televisores',          ARRAY['pulgadas','resolucion']),
      ('aires-acondicionados', ARRAY['frigorias','tipo'])
    ) AS t(cat_slug, atributos)
  LOOP
    SELECT id INTO v_cat_id
    FROM public.categorias
    WHERE slug = v_cat.cat_slug AND parent_id IS NULL;

    CONTINUE WHEN v_cat_id IS NULL;

    v_atributos := v_cat.atributos;
    v_orden := 0;

    FOREACH v_atributo IN ARRAY v_atributos LOOP
      v_orden := v_orden + 10;

      SELECT id INTO v_atr_id FROM public.atributos WHERE slug = v_atributo;
      CONTINUE WHEN v_atr_id IS NULL;

      INSERT INTO public.categoria_atributos
        (categoria_id, atributo_id, requerido, orden)
      VALUES (v_cat_id, v_atr_id, false, v_orden)
      ON CONFLICT (categoria_id, atributo_id) DO NOTHING;

      v_links := v_links + 1;
    END LOOP;
  END LOOP;

  RETURN format('Seed electro OK: %s vínculos categoría-atributo procesados.', v_links);
END;
$$;


ALTER FUNCTION "public"."seed_catalogo_electro"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."seed_catalogo_electro"() IS 'Siembra las 4 categorías y 7 atributos de electro. Idempotente. NO se ejecuta automáticamente: llamarla solo en proyectos con configuracion_pos.rubro = ''electro''.';



CREATE OR REPLACE FUNCTION "public"."sembrar_categorias_egreso"("p_negocio_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
begin
  if p_negocio_id is null or not exists (select 1 from public.negocios where id = p_negocio_id) then
    raise exception 'NEGOCIO_INEXISTENTE';
  end if;
  insert into public.categorias_egreso (negocio_id, nombre, orden, es_sistema)
  values
    (p_negocio_id, 'Alquiler',              10, true),
    (p_negocio_id, 'Sueldos',               20, true),
    (p_negocio_id, 'Servicios',             30, true),
    (p_negocio_id, 'Impuestos',             40, true),
    (p_negocio_id, 'Insumos y librería',    50, true),
    (p_negocio_id, 'Fletes y envíos',       60, true),
    (p_negocio_id, 'Mantenimiento',         70, true),
    (p_negocio_id, 'Comida y refrigerio',   80, true),
    (p_negocio_id, 'Publicidad',            90, true),
    (p_negocio_id, 'Otros',                100, true)
  on conflict do nothing;
end;
$$;


ALTER FUNCTION "public"."sembrar_categorias_egreso"("p_negocio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sembrar_categorias_egreso_nuevo_negocio"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
begin perform public.sembrar_categorias_egreso(new.id); return new; end;
$$;


ALTER FUNCTION "public"."sembrar_categorias_egreso_nuevo_negocio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sembrar_cuentas_financieras_nuevo_negocio"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$begin perform public.sembrar_cuentas_financieras_sistema(new.id); return new; end;$$;


ALTER FUNCTION "public"."sembrar_cuentas_financieras_nuevo_negocio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sembrar_cuentas_financieras_sistema"("p_negocio_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."sembrar_cuentas_financieras_sistema"("p_negocio_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."siguiente_fecha_programada"("p_fecha" "date", "p_frecuencia" "text", "p_dia_ancla" smallint DEFAULT NULL::smallint) RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  v_base date;
  v_meses integer;
  v_ultimo_dia integer;
begin
  if p_fecha is null then return null; end if;
  if p_frecuencia = 'UNICO' then return null; end if;
  if p_frecuencia = 'SEMANAL' then return p_fecha + 7; end if;
  if p_frecuencia = 'QUINCENAL' then return p_fecha + 14; end if;

  v_meses := case p_frecuencia
    when 'MENSUAL' then 1
    when 'BIMESTRAL' then 2
    when 'TRIMESTRAL' then 3
    when 'ANUAL' then 12
    else null end;

  if v_meses is null then
    raise exception 'FRECUENCIA_DESCONOCIDA: %', p_frecuencia;
  end if;

  v_base := (date_trunc('month', p_fecha) + make_interval(months => v_meses))::date;
  v_ultimo_dia := extract(day from (date_trunc('month', v_base)
                    + interval '1 month - 1 day'))::integer;

  return v_base + (least(coalesce(p_dia_ancla, extract(day from p_fecha)::smallint),
                         v_ultimo_dia) - 1);
end;
$$;


ALTER FUNCTION "public"."siguiente_fecha_programada"("p_fecha" "date", "p_frecuencia" "text", "p_dia_ancla" smallint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."siguiente_fecha_programada"("p_fecha" "date", "p_frecuencia" "text", "p_dia_ancla" smallint) IS 'Proximo vencimiento de un egreso programado. Con dia_ancla, una mensual del 31 vuelve al 31 en los meses que lo tienen en vez de quedar clavada en el 28 despues de febrero. Devuelve null para UNICO, que no se repite.';



CREATE OR REPLACE FUNCTION "public"."siguiente_numero_comprobante"("p_punto_venta" integer, "p_tipo" "text") RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_numero bigint;
begin
  insert into public.comprobante_numeracion as n
    (punto_venta, tipo, ultimo_numero)
  values (p_punto_venta, p_tipo, 1)
  on conflict (negocio_id, punto_venta, tipo) do update
    set ultimo_numero = n.ultimo_numero + 1,
        actualizado_en = now()
  returning n.ultimo_numero into v_numero;

  return v_numero;
end;
$$;


ALTER FUNCTION "public"."siguiente_numero_comprobante"("p_punto_venta" integer, "p_tipo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."siguiente_numero_comprobante"("p_punto_venta" integer, "p_tipo" "text") IS 'Devuelve el siguiente numero correlativo, serializado por row lock. Autoridad SOLO para TICKET: para comprobantes fiscales el ultimo numero autorizado lo dice ARCA.';



CREATE OR REPLACE FUNCTION "security"."current_negocio_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_id uuid;
    v_pedido  uuid;
    v_negocio uuid;
    v_total   int;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF security.is_super_admin() THEN
        BEGIN
            v_pedido := coalesce(
                (current_setting('request.headers', true)::json ->> 'x-impersonate-negocio')::uuid,
                (current_setting('request.cookies', true)::json ->> 'impersonate_negocio_id')::uuid
            );
            IF v_pedido IS NOT NULL THEN
                RETURN v_pedido;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    BEGIN
        v_pedido := coalesce(
            (current_setting('request.headers', true)::json ->> 'x-negocio-activo')::uuid,
            (current_setting('request.cookies', true)::json ->> 'negocio_activo_id')::uuid
        );
    EXCEPTION WHEN OTHERS THEN
        v_pedido := NULL;
    END;

    IF v_pedido IS NOT NULL THEN
        SELECT un.negocio_id INTO v_negocio
        FROM public.usuarios_negocios un
        WHERE un.usuario_id = v_user_id AND un.negocio_id = v_pedido;
        RETURN v_negocio;
    END IF;

    SELECT count(*) INTO v_total
    FROM public.usuarios_negocios WHERE usuario_id = v_user_id;

    IF v_total <> 1 THEN
        RETURN NULL;
    END IF;

    SELECT negocio_id INTO v_negocio
    FROM public.usuarios_negocios WHERE usuario_id = v_user_id;
    RETURN v_negocio;
END;
$$;


ALTER FUNCTION "security"."current_negocio_id"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."egresos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "concepto" "text" NOT NULL,
    "monto" integer NOT NULL,
    "fecha" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "creado_por" "uuid",
    "turno_caja_id" "uuid",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "tipo" "text" DEFAULT 'OPERATIVO'::"text" NOT NULL,
    "orden_compra_id" "uuid",
    "cuenta_origen_id" "uuid" NOT NULL,
    "categoria_id" "uuid",
    CONSTRAINT "egresos_categoria_solo_operativo" CHECK ((("categoria_id" IS NULL) OR ("tipo" = 'OPERATIVO'::"text"))),
    CONSTRAINT "egresos_orden_compra_solo_en_compra" CHECK ((("orden_compra_id" IS NULL) OR ("tipo" = 'COMPRA_MERCADERIA'::"text"))),
    CONSTRAINT "egresos_tipo_check" CHECK (("tipo" = ANY (ARRAY['OPERATIVO'::"text", 'RETIRO_SOCIO'::"text", 'COMPRA_MERCADERIA'::"text", 'DEVOLUCION'::"text"])))
);


ALTER TABLE "public"."egresos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."egresos"."tipo" IS 'OPERATIVO resta de la ganancia. RETIRO_SOCIO, COMPRA_MERCADERIA y DEVOLUCION sacan plata del cajón pero NO son gasto: el retiro es ganancia ya hecha, la compra ya viaja en precio_costo, la devolución ya salió por el lado de la venta anulada. Espejo en features/caja/lib/tipo-egreso.ts.';



COMMENT ON COLUMN "public"."egresos"."cuenta_origen_id" IS 'Cuenta real desde la que salió el dinero. La finalidad económica continúa en tipo; solo si coincide con la cuenta del turno afecta su arqueo.';



COMMENT ON COLUMN "public"."egresos"."categoria_id" IS 'Categoría descriptiva del gasto. Solo para tipo OPERATIVO (CHECK). Null = sin categoría, que es un valor válido y no un pendiente.';



CREATE OR REPLACE FUNCTION "public"."snapshot_financiero_egreso"("e" "public"."egresos") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$select jsonb_build_object('concepto',e.concepto,'monto',e.monto,'tipo',e.tipo,'turno_caja_id',e.turno_caja_id,'orden_compra_id',e.orden_compra_id,'cuenta_origen_id',e.cuenta_origen_id);$$;


ALTER FUNCTION "public"."snapshot_financiero_egreso"("e" "public"."egresos") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."venta_pagos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venta_id" "uuid",
    "metodo_pago_id" "uuid",
    "metodo_nombre" "text" NOT NULL,
    "metodo_tipo" "text" NOT NULL,
    "monto_bruto" numeric(12,2) NOT NULL,
    "comision_porcentaje" numeric(5,2) DEFAULT 0 NOT NULL,
    "comision_monto" numeric(12,2) DEFAULT 0 NOT NULL,
    "monto_neto" numeric(12,2) NOT NULL,
    "acreditacion_dias" integer DEFAULT 0 NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cliente_id" "uuid",
    "tipo_movimiento" "text" DEFAULT 'PAGO_VENTA'::"text" NOT NULL,
    "turno_caja_id" "uuid",
    "estado_pago_operacion" "text" DEFAULT 'CONFIRMADO'::"text" NOT NULL,
    "monto_base" numeric DEFAULT 0 NOT NULL,
    "recargo_porcentaje" numeric DEFAULT 0 NOT NULL,
    "recargo_monto" numeric DEFAULT 0 NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "cuenta_destino_id" "uuid",
    CONSTRAINT "venta_pagos_bruto_es_base_mas_recargo" CHECK (("monto_bruto" = ("monto_base" + "recargo_monto"))),
    CONSTRAINT "venta_pagos_estado_pago_operacion_check" CHECK (("estado_pago_operacion" = ANY (ARRAY['CONFIRMADO'::"text", 'ANULADO'::"text"]))),
    CONSTRAINT "venta_pagos_tipo_movimiento_check" CHECK (("tipo_movimiento" = ANY (ARRAY['PAGO_VENTA'::"text", 'PAGO_CUENTA_CORRIENTE'::"text"])))
);


ALTER TABLE "public"."venta_pagos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."venta_pagos"."monto_base" IS 'Parte del cobro que imputa al ticket o a la deuda. monto_bruto = monto_base + recargo_monto.';



COMMENT ON COLUMN "public"."venta_pagos"."recargo_monto" IS 'Recargo por metodo cobrado en este pago, ya redondeado al peso. Congelado: no se recalcula si despues cambia el % del metodo.';



COMMENT ON CONSTRAINT "venta_pagos_bruto_es_base_mas_recargo" ON "public"."venta_pagos" IS 'monto_bruto = monto_base + recargo_monto. El cálculo vive en shared/lib/recargo-metodo.ts; esto es el espejo en la base para que no dependa de que el caller se acuerde.';



CREATE OR REPLACE FUNCTION "public"."snapshot_financiero_venta_pago"("p" "public"."venta_pagos") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$select jsonb_build_object('venta_id',p.venta_id,'cliente_id',p.cliente_id,'metodo_pago_id',p.metodo_pago_id,'metodo_nombre',p.metodo_nombre,'metodo_tipo',p.metodo_tipo,'tipo_movimiento',p.tipo_movimiento,'estado_pago_operacion',p.estado_pago_operacion,'monto_base',p.monto_base,'recargo_monto',p.recargo_monto,'monto_bruto',p.monto_bruto,'comision_monto',p.comision_monto,'monto_neto',p.monto_neto,'acreditacion_dias',p.acreditacion_dias,'cuenta_destino_id',p.cuenta_destino_id);$$;


ALTER FUNCTION "public"."snapshot_financiero_venta_pago"("p" "public"."venta_pagos") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sugerencias_valores_atributo"("p_nombre" "text") RETURNS TABLE("valor" "text", "productos" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  SELECT atributos->>p_nombre AS valor, count(DISTINCT producto_id) AS productos
  FROM public.producto_variantes
  WHERE atributos ? p_nombre AND atributos->>p_nombre <> ''
  GROUP BY atributos->>p_nombre
  ORDER BY productos DESC;
$$;


ALTER FUNCTION "public"."sugerencias_valores_atributo"("p_nombre" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sugerir_productos_similares"("p_raw_nombres" "text"[], "p_umbral" real DEFAULT 0.60, "p_max_por_nombre" integer DEFAULT 3) RETURNS TABLE("raw_nombre" "text", "producto_id" "uuid", "producto_nombre" "text", "categoria_id" "uuid", "marca" "text", "score" real)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  WITH entrada AS (
    SELECT DISTINCT unnest(p_raw_nombres) AS raw_nombre
  ),
  candidatos AS (
    SELECT
      e.raw_nombre,
      p.id AS producto_id,
      p.nombre AS producto_nombre,
      p.categoria_id,
      p.marca,
      extensions.similarity(
        public.unaccent_immutable(lower(p.nombre)),
        public.unaccent_immutable(lower(e.raw_nombre))
      ) AS score
    FROM entrada e
    JOIN public.productos p
      ON p.publicado = true
     AND public.unaccent_immutable(lower(p.nombre))
         OPERATOR(extensions.%) public.unaccent_immutable(lower(e.raw_nombre))
  ),
  rankeados AS (
    SELECT
      *,
      row_number() OVER (
        PARTITION BY raw_nombre ORDER BY score DESC
      ) AS rn
    FROM candidatos
    WHERE score >= p_umbral
  )
  SELECT raw_nombre, producto_id, producto_nombre, categoria_id, marca, score
  FROM rankeados
  WHERE rn <= p_max_por_nombre
  ORDER BY raw_nombre, score DESC;
$$;


ALTER FUNCTION "public"."sugerir_productos_similares"("p_raw_nombres" "text"[], "p_umbral" real, "p_max_por_nombre" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tiene_feature"("clave" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.negocios n
      WHERE n.id = security.current_negocio_id() AND n.plan_id IS NOT NULL
    ) THEN true
    ELSE coalesce(public.reglas_plan() -> 'features' ? clave, false)
  END;
$$;


ALTER FUNCTION "public"."tiene_feature"("clave" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tiene_permiso"("clave" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.usuarios_negocios un
      JOIN public.rol_permisos rp ON rp.rol_id = un.rol_id
      JOIN public.permisos perm ON perm.id = rp.permiso_id
      WHERE un.usuario_id = auth.uid()
        AND un.negocio_id = security.current_negocio_id()
        AND perm.clave = tiene_permiso.clave
    );
$$;


ALTER FUNCTION "public"."tiene_permiso"("clave" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."totales_ventas_por_turno"("p_turno_ids" "uuid"[]) RETURNS TABLE("turno_id" "uuid", "total_facturado" numeric, "cantidad_ventas" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    t.id,
    COALESCE(SUM(v.total), 0),
    COUNT(v.id)
  FROM public.turnos_caja t
  LEFT JOIN public.ventas v
    ON v.turno_caja_id = t.id
   AND v.estado_operacion <> 'ANULADA'
   AND v.negocio_id = security.current_negocio_id()
  WHERE t.id = ANY(p_turno_ids)
    AND t.negocio_id = security.current_negocio_id()
    AND (
      t.vendedor_id = auth.uid()
      OR public.tiene_permiso('caja.cerrar_ajena')
      OR t.modo = 'UNICA'
    )
  GROUP BY t.id;
$$;


ALTER FUNCTION "public"."totales_ventas_por_turno"("p_turno_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."totales_ventas_por_turno"("p_turno_ids" "uuid"[]) IS 'Vendido por turno. NO resta ventas.monto_devuelto: es lo que se vendio en ese turno, un hecho historico, y una devolucion posterior no puede cambiar el numero de un turno ya cerrado. Ver 20260903180000.';



CREATE OR REPLACE FUNCTION "public"."transferencias_caja_turno"("p_turno_id" "uuid") RETURNS TABLE("movimiento_id" bigint, "origen_tipo" "text", "origen_id" "uuid", "importe" numeric, "descripcion" "text", "fecha_movimiento" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."transferencias_caja_turno"("p_turno_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transferencias_caja_turno"("p_turno_id" "uuid") IS 'Movimientos del cajón del turno que no son venta ni egreso: transferencias e ingresos libres (origen_tipo lo dice). Es el mismo término que suma el arqueo.';



CREATE OR REPLACE FUNCTION "public"."ultimo_movimiento_turno"("p_turno_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."ultimo_movimiento_turno"("p_turno_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unaccent_immutable"("text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $_$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$_$;


ALTER FUNCTION "public"."unaccent_immutable"("text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_cuenta_origen_egreso"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare v_tipo text; v_activa boolean;
begin
 select tipo,activa into v_tipo,v_activa from public.cuentas_financieras where negocio_id=new.negocio_id and id=new.cuenta_origen_id;
 if not found or not v_activa then raise exception 'CUENTA_ORIGEN_NO_DISPONIBLE'; end if;
 if v_tipo='PUENTE_ACREDITACION' then raise exception 'CUENTA_PUENTE_NO_ADMITE_EGRESOS_MANUALES'; end if;
 return new;
end; $$;


ALTER FUNCTION "public"."validar_cuenta_origen_egreso"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_limite_cc_manual"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_max      int;
    v_actuales int;
    v_negocio  uuid;
    v_debia    boolean;
BEGIN
    IF NEW.tipo <> 'DEBITO' OR NEW.venta_id IS NOT NULL OR NEW.pago_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    SELECT c.negocio_id, c.saldo_pendiente > 0
    INTO v_negocio, v_debia
    FROM public.clientes c WHERE c.id = NEW.cliente_id;

    IF v_debia THEN
      RETURN NEW;
    END IF;

    v_max := nullif(
      public.reglas_negocio(v_negocio) ->> 'max_clientes_cuenta_corriente',
      'null'
    )::int;

    IF v_max IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_actuales
    FROM public.clientes c
    WHERE c.negocio_id = v_negocio
      AND c.saldo_pendiente > 0
      AND c.id <> NEW.cliente_id;

    IF v_actuales >= v_max THEN
      RAISE EXCEPTION
        'El plan permite % cliente(s) con cuenta corriente y ya están todos ocupados. Cobrá alguna deuda o pasá a un plan mayor. (Las ventas fiadas no se frenan por esto.)', v_max
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_limite_cc_manual"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_limite_productos"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_max      int;
    v_actuales int;
BEGIN
    v_max := nullif(public.reglas_negocio(NEW.negocio_id) ->> 'max_productos', 'null')::int;

    IF v_max IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_actuales
    FROM public.productos WHERE negocio_id = NEW.negocio_id;

    IF v_actuales >= v_max THEN
      RAISE EXCEPTION
        'El plan permite % productos y ya están cargados. Podés seguir vendiendo y editando los que tenés; para cargar más, pasá a un plan mayor.', v_max
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_limite_productos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_limite_usuarios"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_max        int;
    v_actuales   int;
    v_pendientes int;
BEGIN
    v_max := nullif(public.reglas_negocio(NEW.negocio_id) ->> 'max_usuarios', 'null')::int;

    IF v_max IS NULL THEN
      RETURN NEW;
    END IF;

    SELECT count(*) INTO v_actuales
    FROM public.usuarios_negocios WHERE negocio_id = NEW.negocio_id;

    SELECT count(*) INTO v_pendientes
    FROM public.invitaciones
    WHERE negocio_id = NEW.negocio_id AND estado = 'PENDIENTE';

    IF TG_TABLE_NAME = 'usuarios_negocios' THEN
      IF v_actuales >= v_max THEN
        RAISE EXCEPTION 'El plan del negocio permite % usuario(s) y ya están todos ocupados.', v_max
          USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF v_actuales + v_pendientes >= v_max THEN
        RAISE EXCEPTION 'El plan del negocio permite % usuario(s), contando las invitaciones pendientes.', v_max
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."validar_limite_usuarios"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validar_saldo_caja_arqueada"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_arqueo boolean;
  v_saldo  numeric;
begin
  if new.importe >= 0
     or new.turno_caja_id is null
     or new.origen_tipo in ('TURNO_CAJA', 'VENTA_PAGO') then
    return new;
  end if;

  select c.requiere_arqueo into v_arqueo
    from public.cuentas_financieras c
   where c.negocio_id = new.negocio_id
     and c.id = new.cuenta_financiera_id;

  if not coalesce(v_arqueo, false) then
    return new;
  end if;

  perform 1
     from public.turnos_caja t
    where t.negocio_id = new.negocio_id
      and t.id = new.turno_caja_id
      for update;

  select coalesce(sum(m.importe), 0) into v_saldo
    from public.movimientos_financieros m
   where m.negocio_id = new.negocio_id
     and m.turno_caja_id = new.turno_caja_id
     and m.cuenta_financiera_id = new.cuenta_financiera_id;

  if v_saldo + new.importe < 0 then
    raise exception using
      message = 'SALDO_INSUFICIENTE_CAJA',
      detail  = json_build_object(
                  'disponible', greatest(v_saldo, 0),
                  'monto', -new.importe
                )::text,
      hint    = 'Si se pagó con otra plata, registralo contra esa cuenta.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validar_saldo_caja_arqueada"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."validar_saldo_caja_arqueada"() IS 'Rechaza (SALDO_INSUFICIENTE_CAJA) toda salida de una cuenta arqueada que deje el saldo del turno en negativo. Excluye TURNO_CAJA y VENTA_PAGO. Ver 20260928120000.';



CREATE OR REPLACE FUNCTION "public"."validar_turno_egreso_arqueado"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_arqueo boolean;
  v_turno  record;
begin
  select c.requiere_arqueo into v_arqueo
    from public.cuentas_financieras c
   where c.negocio_id = new.negocio_id
     and c.id = new.cuenta_origen_id;

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

  -- El turno tiene que ser de ESA cuenta: si no, la plata sale de un cajon y
  -- el arqueo la busca en otro.
  if v_turno.cuenta_financiera_id is distinct from new.cuenta_origen_id then
    raise exception 'EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO';
  end if;

  -- Un turno CERRADO ya se conto y se firmo.
  if v_turno.estado <> 'ABIERTO' then
    raise exception 'EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."validar_turno_egreso_arqueado"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vender_unidades_serie"("p_venta_id" "uuid", "p_unidades" "jsonb") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
  v_esperadas integer;
  v_afectadas integer;
BEGIN
  v_esperadas := jsonb_array_length(p_unidades);

  IF v_esperadas IS NULL OR v_esperadas = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.unidades_serie u
  SET estado = 'vendido',
      fecha_venta = now(),
      venta_id = p_venta_id
  FROM jsonb_to_recordset(p_unidades)
       AS pedido(unidad_id uuid, variante_id uuid)
  WHERE u.id = pedido.unidad_id
    AND u.producto_variante_id = pedido.variante_id
    AND u.estado = 'disponible';

  GET DIAGNOSTICS v_afectadas = ROW_COUNT;

  IF v_afectadas <> v_esperadas THEN
    RAISE EXCEPTION
      'UNIDADES_NO_DISPONIBLES: se pidieron % unidades y solo % estaban disponibles para esa variante',
      v_esperadas, v_afectadas
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_afectadas;
END;
$$;


ALTER FUNCTION "public"."vender_unidades_serie"("p_venta_id" "uuid", "p_unidades" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ventas_facturadas"("p_periodo" "text" DEFAULT 'mes'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_desde   date;
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver esta vista'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;
  v_desde := case p_periodo
    when 'hoy'    then v_hoy
    when 'semana' then (date_trunc('week',  v_hoy)::date)
    when 'mes'    then (date_trunc('month', v_hoy)::date)
    when 'anio'   then (date_trunc('year',  v_hoy)::date)
    else v_hoy
  end;

  with ventas_periodo as (
    select v.id, v.total
      from public.ventas v
     where v.negocio_id = v_negocio
       and v.estado_operacion = 'CONFIRMADA'
       and (v.fecha_venta at time zone v_tz)::date between v_desde and v_hoy
  ),
  clasificadas as (
    select vp.id,
           vp.total,
           c.tipo,
           case
             when c.id is null then 'SIN_FACTURAR'
             when c.arca_ambiente = 'PRODUCCION' then 'FACTURADO'
             else 'PRUEBA'
           end as cajon
      from ventas_periodo vp
      left join lateral (
        select c.id, c.tipo, c.arca_ambiente
          from public.comprobantes c
         where c.negocio_id = v_negocio
           and c.venta_id = vp.id
           and c.tipo like 'FACTURA%'
           and c.cae is not null
         order by c.emitido_en
         limit 1
      ) c on true
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hoy,
    'periodo', p_periodo,
    'facturado', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas where cajon = 'FACTURADO'),
      'total',    (select coalesce(sum(total), 0) from clasificadas where cajon = 'FACTURADO'),
      'por_tipo', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'tipo', tipo, 'cantidad', cantidad, 'total', total
        ) order by total desc), '[]'::jsonb)
        from (
          select tipo, count(*) as cantidad, sum(total) as total
            from clasificadas where cajon = 'FACTURADO'
           group by tipo
        ) t
      )
    ),
    'sin_facturar', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas where cajon = 'SIN_FACTURAR'),
      'total',    (select coalesce(sum(total), 0) from clasificadas where cajon = 'SIN_FACTURAR')
    ),
    'prueba', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas where cajon = 'PRUEBA'),
      'total',    (select coalesce(sum(total), 0) from clasificadas where cajon = 'PRUEBA')
    ),
    'total', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas),
      'total',    (select coalesce(sum(total), 0) from clasificadas)
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."ventas_facturadas"("p_periodo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ventas_facturadas"("p_periodo" "text") IS 'Ventas CONFIRMADAS del periodo partidas en FACTURADO (CAE de produccion), SIN_FACTURAR (ticket interno) y PRUEBA (CAE de homologacion). Gateada por caja.ver_gerencial. SECURITY DEFINER con negocio_id filtrado a mano.';



CREATE OR REPLACE FUNCTION "public"."ventas_por_momento"("p_desde" "date" DEFAULT NULL::"date", "p_hasta" "date" DEFAULT NULL::"date", "p_periodo" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'security', 'pg_temp'
    AS $$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_desde   date;
  v_hasta   date;
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenes permiso para ver las ventas por momento'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;

  if p_periodo is not null then
    v_hasta := v_hoy;
    v_desde := case p_periodo
      when 'hoy'    then v_hoy
      when 'semana' then (date_trunc('week',  v_hoy)::date)
      when 'mes'    then (date_trunc('month', v_hoy)::date)
      when 'anio'   then (date_trunc('year',  v_hoy)::date)
      else v_hoy
    end;
  else
    v_hasta := coalesce(p_hasta, v_hoy);
    v_desde := coalesce(p_desde, v_hasta - 59);
  end if;

  with v as (
    select
      v.id,
      v.total,
      extract(dow  from v.fecha_venta at time zone v_tz)::int as dow,
      extract(hour from v.fecha_venta at time zone v_tz)::int as hora
    from public.ventas v
    where v.negocio_id = v_negocio
      and v.estado_operacion is distinct from 'ANULADA'
      and (v.fecha_venta at time zone v_tz)::date between v_desde and v_hasta
  ),
  dias as (
    select extract(dow from d)::int as dow, count(*) as cantidad
    from generate_series(v_desde, v_hasta, interval '1 day') d
    group by 1
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hasta,
    'periodo', p_periodo,
    'generado_en', now(),
    'total_ventas', (select count(*) from v),
    'por_dia_semana', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dow', dow,
        'dia', case dow
          when 0 then 'Domingo' when 1 then 'Lunes'   when 2 then 'Martes'
          when 3 then 'Miércoles' when 4 then 'Jueves' when 5 then 'Viernes'
          else 'Sábado' end,
        'ventas', ventas,
        'dias_en_el_rango', dias_rango,
        'ventas_por_dia', round(ventas::numeric / nullif(dias_rango, 0), 2),
        'ingreso', round(ingreso, 2),
        'ticket_promedio', round(ticket_prom, 2)
      ) order by dow), '[]'::jsonb)
      from (
        select d.dow, coalesce(count(v.id), 0) as ventas, d.cantidad as dias_rango,
               coalesce(sum(v.total), 0) as ingreso, avg(v.total) as ticket_prom
        from dias d left join v on v.dow = d.dow
        group by d.dow, d.cantidad
      ) x
    ),
    'por_franja', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'franja', franja,
        'ventas', ventas,
        'ingreso', round(ingreso, 2),
        'ticket_promedio', round(ticket_prom, 2)
      ) order by orden), '[]'::jsonb)
      from (
        select
          case when hora < 13 then 'MANANA' when hora < 20 then 'TARDE' else 'NOCHE' end as franja,
          case when hora < 13 then 1        when hora < 20 then 2       else 3 end       as orden,
          count(*) as ventas, sum(total) as ingreso, avg(total) as ticket_prom
        from v
        group by 1, 2
      ) f
    ),
    'por_hora', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'hora', hora,
        'ventas', ventas,
        'ingreso', round(ingreso, 2),
        'ticket_promedio', round(ticket_prom, 2)
      ) order by hora), '[]'::jsonb)
      from (
        select hora, count(*) as ventas, sum(total) as ingreso, avg(total) as ticket_prom
        from v group by hora
      ) h
    )
  )
  into v_out;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."ventas_por_momento"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ventas_por_momento"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") IS 'Comerz Insights: cuando se vende. Dia de semana (normalizado por cuantos dias de cada tipo hubo en el rango), franja y hora. Gate: caja.ver_gerencial.';



CREATE OR REPLACE FUNCTION "security"."comparte_negocio"("p_usuario" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios_negocios un
    WHERE un.usuario_id = p_usuario
      AND un.negocio_id = security.current_negocio_id()
  );
$$;


ALTER FUNCTION "security"."comparte_negocio"("p_usuario" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."current_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
  SELECT auth.uid();
$$;


ALTER FUNCTION "security"."current_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."es_super_admin"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
      from auth.users u
     where u.id = p_user_id
       and u.email = 'ignacionweppler@gmail.com'
  );
$$;


ALTER FUNCTION "security"."es_super_admin"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "security"."es_super_admin"("p_user_id" "uuid") IS 'Unico lugar donde vive el criterio de super admin de Comerz. Recibe el usuario en vez de leerlo de la sesion, para que tambien lo pueda usar el custom access token hook, que corre sin contexto de request. Ver 20260903100000.';



CREATE OR REPLACE FUNCTION "security"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
  SELECT public.is_admin();
$$;


ALTER FUNCTION "security"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE PARALLEL SAFE
    AS $$
  select security.es_super_admin(auth.uid());
$$;


ALTER FUNCTION "security"."is_super_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "security"."is_super_admin"() IS 'El super admin de la sesion actual. Delega en security.es_super_admin(auth.uid()) desde 20260903100000: el criterio vive en un solo lugar. NO es security definer a proposito (la interna si lo es): asi el planner la inlinea y no agrega costo por fila a las 11 policies que la llaman en crudo.';



CREATE OR REPLACE FUNCTION "security"."negocio_publico"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_slug text;
    v_id   uuid;
BEGIN
    BEGIN
        v_slug := current_setting('request.headers', true)::json ->> 'x-negocio-slug';
    EXCEPTION WHEN OTHERS THEN
        v_slug := NULL;
    END;

    IF v_slug IS NULL OR v_slug = '' THEN
        RETURN NULL;
    END IF;

    -- 'prueba' entra igual que 'activo': durante la prueba la tienda funciona.
    -- 'demo' también: es el comercio que el vendedor muestra, y una tienda que
    -- da 404 no se puede mostrar.
    SELECT id INTO v_id FROM public.negocios
    WHERE slug = v_slug AND estado IN ('activo', 'prueba', 'demo');

    RETURN v_id;
END;
$$;


ALTER FUNCTION "security"."negocio_publico"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "security"."same_negocio"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER PARALLEL SAFE
    SET "search_path" TO 'public'
    AS $$
  SELECT target = security.current_negocio_id();
$$;


ALTER FUNCTION "security"."same_negocio"("target" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "security"."same_negocio"("target" "uuid") IS 'Compara un negocio_id contra el negocio activo. NO USAR EN POLICIES: como recibe la columna, Postgres la ejecuta por fila y el predicado deja de poder usar el indice (medido: 69,6 ms vs 0,94 ms sobre 1.740 filas). Dentro de una policy va: negocio_id = (select security.current_negocio_id()).';



CREATE TABLE IF NOT EXISTS "archivo"."_backup_broderie_20260731_alias" (
    "id" "uuid",
    "proveedor" "text",
    "raw_nombre" "text",
    "producto_id" "uuid",
    "creado_en" timestamp with time zone
);


ALTER TABLE "archivo"."_backup_broderie_20260731_alias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "archivo"."_backup_broderie_20260731_stock" (
    "id" "uuid",
    "producto_id" "uuid",
    "variante" "text",
    "cantidad" integer
);


ALTER TABLE "archivo"."_backup_broderie_20260731_stock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "archivo"."_backup_broderie_20260731_variantes" (
    "id" "uuid",
    "producto_id" "uuid",
    "sku" "text",
    "nombre_display" "text",
    "precio" numeric,
    "costo" numeric,
    "stock" integer,
    "stock_minimo" integer,
    "activa" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "atributos" "jsonb",
    "producto_nombre" "text"
);


ALTER TABLE "archivo"."_backup_broderie_20260731_variantes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "archivo"."solicitudes_comercio" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre_contacto" "text" NOT NULL,
    "whatsapp" "text" NOT NULL,
    "nombre_comercio" "text" NOT NULL,
    "rubro" "text" NOT NULL,
    "rubro_otro" "text",
    "estado" "text" DEFAULT 'NUEVA'::"text" NOT NULL,
    "notas" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "solicitudes_comercio_estado_check" CHECK (("estado" = ANY (ARRAY['NUEVA'::"text", 'CONTACTADA'::"text", 'CONVERTIDA'::"text", 'DESCARTADA'::"text"]))),
    CONSTRAINT "solicitudes_comercio_otro_check" CHECK ((("rubro" <> 'otro'::"text") OR (("rubro_otro" IS NOT NULL) AND ("btrim"("rubro_otro") <> ''::"text")))),
    CONSTRAINT "solicitudes_comercio_rubro_check" CHECK (("rubro" = ANY (ARRAY['quiosco'::"text", 'minimercado'::"text", 'ferreteria'::"text", 'carniceria'::"text", 'indumentaria'::"text", 'otro'::"text"])))
);


ALTER TABLE "archivo"."solicitudes_comercio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."acreditaciones_financieras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "cuenta_destino_id" "uuid" NOT NULL,
    "fecha_acreditacion" timestamp with time zone DEFAULT "now"() NOT NULL,
    "referencia" "text",
    "importe_neto" numeric NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estimada" boolean DEFAULT false NOT NULL,
    CONSTRAINT "acreditaciones_financieras_importe_neto_check" CHECK (("importe_neto" > (0)::numeric))
);


ALTER TABLE "public"."acreditaciones_financieras" OWNER TO "postgres";


COMMENT ON COLUMN "public"."acreditaciones_financieras"."estimada" IS 'La acreditacion la genero el sistema por la fecha pactada en metodos_pago.acreditacion_dias, no una conciliacion contra el extracto. Ver 20260921120000.';



CREATE TABLE IF NOT EXISTS "public"."acreditaciones_financieras_pagos" (
    "acreditacion_id" "uuid" NOT NULL,
    "venta_pago_id" "uuid" NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "monto_neto" numeric NOT NULL,
    CONSTRAINT "acreditaciones_financieras_pagos_monto_neto_check" CHECK (("monto_neto" > (0)::numeric))
);


ALTER TABLE "public"."acreditaciones_financieras_pagos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."actualizaciones_precio" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text",
    "tipo_alcance" "text" NOT NULL,
    "tipo_operacion" "text" NOT NULL,
    "campo_objetivo" "text" NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "redondeo" "text",
    "cantidad_afectada" integer DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'APLICADO'::"text" NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revertido_en" timestamp with time zone,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."actualizaciones_precio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."actualizaciones_precio_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lote_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "costo_anterior" numeric(12,2),
    "costo_nuevo" numeric(12,2),
    "precio_anterior" numeric(12,2),
    "precio_nuevo" numeric(12,2),
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "variante_id" "uuid",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."actualizaciones_precio_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."actualizaciones_precio_items"."costo_anterior" IS 'Costo antes del ajuste. NULL = la variante no tenía costo propio. Ver precio_anterior.';



COMMENT ON COLUMN "public"."actualizaciones_precio_items"."costo_nuevo" IS 'Costo después del ajuste. NULL = quedó heredando del producto. Ver precio_anterior.';



COMMENT ON COLUMN "public"."actualizaciones_precio_items"."precio_anterior" IS 'Precio antes del ajuste. NULL = la variante no tenía precio propio (heredaba del producto); 0 = valía cero. Las filas anteriores a 20260908210000 guardan 0 en los dos casos y no se pueden desambiguar.';



COMMENT ON COLUMN "public"."actualizaciones_precio_items"."precio_nuevo" IS 'Precio después del ajuste. NULL = quedó heredando del producto. Ver precio_anterior.';



COMMENT ON COLUMN "public"."actualizaciones_precio_items"."variante_id" IS 'Variante a la que corresponde esta fila de historial, o NULL cuando la fila es de nivel PRODUCTO (aplicarPreciosAction escribe una por producto ademas de una por variante). SIN FK a proposito desde 20260902190000: el historial tiene que sobrevivir a que la variante se borre, y el ON DELETE SET NULL anterior no solo perdia el dato sino que hacia que revertir el lote pisara el precio del producto. Un id que ya no existe se puede resolver contra variantes_remapeo.';



CREATE TABLE IF NOT EXISTS "public"."alertas_caja_revisadas" (
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "clave" "text" NOT NULL,
    "revisada_por" "uuid" DEFAULT "auth"."uid"(),
    "revisada_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nota" "text"
);


ALTER TABLE "public"."alertas_caja_revisadas" OWNER TO "postgres";


COMMENT ON TABLE "public"."alertas_caja_revisadas" IS 'Alertas de /caja → Auditoría que alguien ya revisó. Se escribe solo por marcar_alerta_caja_revisada / desmarcar_alerta_caja_revisada.';



CREATE TABLE IF NOT EXISTS "public"."arca_credenciales" (
    "negocio_id" "uuid" NOT NULL,
    "ambiente" "text" NOT NULL,
    "clave_privada_cifrada" "text" NOT NULL,
    "csr_pem" "text" NOT NULL,
    "certificado_pem" "text",
    "certificado_vencimiento" timestamp with time zone,
    "certificado_subject" "text",
    "ta_cifrado" "text",
    "ta_expira_en" timestamp with time zone,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "arca_credenciales_ambiente_check" CHECK (("ambiente" = ANY (ARRAY['HOMOLOGACION'::"text", 'PRODUCCION'::"text"])))
);


ALTER TABLE "public"."arca_credenciales" OWNER TO "postgres";


COMMENT ON TABLE "public"."arca_credenciales" IS 'Clave privada (cifrada), CSR, certificado y cache del TA de WSAA, por negocio y ambiente. SIN policies a proposito: solo la lee el server via service_role tras chequear configuracion.facturacion.';



CREATE TABLE IF NOT EXISTS "public"."atributo_valores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "atributo_id" "uuid" NOT NULL,
    "valor" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "color_hex" "text",
    "orden" integer DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."atributo_valores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."atributos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "tipo" "text" DEFAULT 'TEXT'::"text" NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"()
);


ALTER TABLE "public"."atributos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."backfill_variante_id_20260903" (
    "venta_item_id" "uuid" NOT NULL,
    "variante_id_anterior" "uuid",
    "variante_id_nuevo" "uuid" NOT NULL,
    "nombre_vendido" "text",
    "nombre_matcheado" "text",
    "aplicado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."backfill_variante_id_20260903" OWNER TO "postgres";


COMMENT ON TABLE "public"."backfill_variante_id_20260903" IS 'Que renglones de ventas_items recibieron variante_id en el backfill por conjunto de atributos, y cual tenian antes. Interna: RLS sin ninguna policy, asi que la app no la lee. Ver 20260903150000.';



CREATE TABLE IF NOT EXISTS "public"."bajas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "variante" "text" NOT NULL,
    "cantidad" numeric(12,3) NOT NULL,
    "motivo" "text" NOT NULL,
    "estado" "text" DEFAULT 'PENDIENTE'::"text" NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "origen" "text" DEFAULT 'MANUAL'::"text" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    CONSTRAINT "bajas_origen_check" CHECK (("origen" = ANY (ARRAY['MANUAL'::"text", 'DEVOLUCION_VENTA'::"text"]))),
    CONSTRAINT "mermas_estado_check" CHECK (("estado" = ANY (ARRAY['PENDIENTE'::"text", 'APROBADA'::"text", 'RECHAZADA'::"text"])))
);


ALTER TABLE "public"."bajas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."catalogo_borrados" (
    "id" bigint NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "tabla" "text" NOT NULL,
    "fila_id" "uuid" NOT NULL,
    "borrado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "borrado_por" "uuid",
    CONSTRAINT "catalogo_borrados_tabla_check" CHECK (("tabla" = ANY (ARRAY['productos'::"text", 'producto_variantes'::"text", 'categorias'::"text"])))
);


ALTER TABLE "public"."catalogo_borrados" OWNER TO "postgres";


COMMENT ON TABLE "public"."catalogo_borrados" IS 'Avisos de baja del catalogo: que fila se borro, de que tabla y cuando. Lo escribe un trigger AFTER DELETE, asi que ningun camino lo puede saltear (ni el CASCADE). Existe porque una fila borrada no se puede detectar mirando updated_at. Ver 20260902180000.';



COMMENT ON COLUMN "public"."catalogo_borrados"."borrado_por" IS 'auth.uid() del que borro, o null si vino por CASCADE o desde una migracion.';



ALTER TABLE "public"."catalogo_borrados" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."catalogo_borrados_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."categoria_atributos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "categoria_id" "uuid" NOT NULL,
    "atributo_id" "uuid" NOT NULL,
    "requerido" boolean DEFAULT false NOT NULL,
    "orden" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."categoria_atributos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categorias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "parent_id" "uuid",
    "descripcion" "text",
    "imagen_url" "text",
    "orden" integer DEFAULT 0 NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "temporada" "text" DEFAULT 'TODO_EL_ANIO'::"text" NOT NULL,
    CONSTRAINT "categorias_temporada_check" CHECK (("temporada" = ANY (ARRAY['TODO_EL_ANIO'::"text", 'VERANO'::"text", 'INVIERNO'::"text", 'MEDIA_ESTACION'::"text"])))
);


ALTER TABLE "public"."categorias" OWNER TO "postgres";


COMMENT ON COLUMN "public"."categorias"."temporada" IS 'Ventana de venta de la categoria, cargada a mano. Se usa SOLO para silenciar sugerencias fuera de temporada, NUNCA para sugerir comprar. Default TODO_EL_ANIO: nada se oculta hasta que alguien lo declare.';



CREATE TABLE IF NOT EXISTS "public"."categorias_egreso" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "nombre" "text" NOT NULL,
    "orden" integer DEFAULT 100 NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "es_sistema" boolean DEFAULT false NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "categorias_egreso_nombre_corto" CHECK (("length"("nombre") <= 60)),
    CONSTRAINT "categorias_egreso_nombre_no_vacio" CHECK (("length"("btrim"("nombre")) > 0))
);


ALTER TABLE "public"."categorias_egreso" OWNER TO "postgres";


COMMENT ON TABLE "public"."categorias_egreso" IS 'Categorías de gastos por negocio. Eje DESCRIPTIVO debajo de egresos.tipo = OPERATIVO; no decide nada de plata. Opcional en el egreso, sin default.';



CREATE TABLE IF NOT EXISTS "public"."clientes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "dni" "text",
    "telefono" "text" NOT NULL,
    "email" "text",
    "notas" "text",
    "activo" boolean DEFAULT true NOT NULL,
    "saldo_pendiente" numeric(12,2) DEFAULT 0 NOT NULL,
    "reglas_credito" "jsonb" DEFAULT '{}'::"jsonb",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "exceptuado_entrega_minima" boolean DEFAULT false NOT NULL,
    "fecha_vencimiento_deuda" "date",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "cuit" "text",
    "razon_social" "text",
    "condicion_iva" "text",
    "direccion" "text",
    "localidad" "text",
    "provincia" "text",
    "codigo_postal" "text",
    "direccion_comercial" "text",
    "resumen_token" "text",
    "lista_precio_id" "uuid",
    CONSTRAINT "clientes_condicion_iva_check" CHECK ((("condicion_iva" IS NULL) OR ("condicion_iva" = ANY (ARRAY['Responsable Inscripto'::"text", 'Monotributo'::"text", 'Exento'::"text", 'Consumidor Final'::"text"]))))
);


ALTER TABLE "public"."clientes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."clientes"."saldo_pendiente" IS 'Saldo de cuenta corriente, caché del libro (cuenta_corriente_movimientos: DEBITO suma, CREDITO resta). POSITIVO = el cliente debe. NEGATIVO = saldo a favor del cliente. Se mueve SIEMPRE con delta en el mismo statement (registrar_cobro_cc, ajustar_saldo_cliente, registrar_venta), nunca leyendo y escribiendo después, y nunca recortado a cero: el recorte es lo que escondía los saldos a favor.';



COMMENT ON COLUMN "public"."clientes"."fecha_vencimiento_deuda" IS 'Vencimiento de la deuda VIVA más antigua del cliente, no la del último ticket fiado. Lo calcula SIEMPRE public.recalcular_vencimiento_cc (imputación FIFO de los pagos + piso por mora ya cobrada), que es la única regla: la llaman registrar_venta y las actions de cobro, ajuste de saldo, perdón y edición/anulación de movimientos.';



COMMENT ON COLUMN "public"."clientes"."cuit" IS 'CUIT sin guiones. Solo para clientes fiscales; el DNI (columna dni) es el dato del consumidor final.';



COMMENT ON COLUMN "public"."clientes"."direccion" IS 'Domicilio fiscal, el que va impreso en la factura. Para la direccion de entrega ver `direccion_comercial`.';



COMMENT ON COLUMN "public"."clientes"."direccion_comercial" IS 'Direccion de contacto/entrega. Existe para cualquier cliente. El domicilio fiscal (el que va en la factura) es `direccion`.';



COMMENT ON COLUMN "public"."clientes"."resumen_token" IS 'Token no adivinable para el link publico del resumen de cuenta. Se genera la primera vez que se comparte. Reemplazarlo invalida los links anteriores.';



COMMENT ON COLUMN "public"."clientes"."lista_precio_id" IS 'Lista sugerida para este cliente. NULL = precio base. Es una sugerencia: el POS la propone y la vendedora puede cambiarla; quien manda en la venta es ventas.lista_precio_id.';



CREATE TABLE IF NOT EXISTS "public"."cobros_cc_correcciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "pago_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "valor_anterior" "jsonb" NOT NULL,
    "valor_nuevo" "jsonb" NOT NULL,
    "turno_estado" "text" NOT NULL,
    "motivo" "text",
    "corregido_por" "uuid",
    "corregido_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cobros_cc_correcciones_turno_estado_check" CHECK (("turno_estado" = ANY (ARRAY['ABIERTO'::"text", 'CERRADO'::"text"])))
);


ALTER TABLE "public"."cobros_cc_correcciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comprobante_numeracion" (
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "punto_venta" integer NOT NULL,
    "tipo" "text" NOT NULL,
    "ultimo_numero" bigint DEFAULT 0 NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."comprobante_numeracion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comprobantes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "venta_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "punto_venta" integer NOT NULL,
    "numero" bigint NOT NULL,
    "cliente_id" "uuid",
    "receptor_razon_social" "text",
    "receptor_cuit" "text",
    "receptor_condicion_iva" "text",
    "neto" numeric(14,2) DEFAULT 0 NOT NULL,
    "iva_monto" numeric(14,2) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) NOT NULL,
    "cae" "text",
    "cae_vencimiento" "date",
    "anula_comprobante_id" "uuid",
    "emitido_por" "uuid",
    "emitido_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "exento" numeric(14,2) DEFAULT 0 NOT NULL,
    "no_gravado" numeric(14,2) DEFAULT 0 NOT NULL,
    "fecha_comprobante" "date",
    "receptor_doc_tipo" integer,
    "receptor_doc_nro" "text",
    "arca_ambiente" "text",
    "arca_resultado" "text",
    "arca_observaciones" "jsonb",
    CONSTRAINT "comprobantes_arca_ambiente_check" CHECK (
CASE
    WHEN ("tipo" = 'TICKET'::"text") THEN ("arca_ambiente" IS NULL)
    ELSE ("arca_ambiente" = ANY (ARRAY['HOMOLOGACION'::"text", 'PRODUCCION'::"text"]))
END),
    CONSTRAINT "comprobantes_importes_coherentes_check" CHECK ((("neto" >= (0)::numeric) AND ("iva_monto" >= (0)::numeric) AND ("exento" >= (0)::numeric) AND ("no_gravado" >= (0)::numeric) AND ("total" >= (0)::numeric))),
    CONSTRAINT "comprobantes_numeracion_valida_check" CHECK (((("punto_venta" >= 1) AND ("punto_venta" <= 99999)) AND ("numero" >= 1))),
    CONSTRAINT "comprobantes_ticket_sin_cae_check" CHECK (
CASE
    WHEN ("tipo" = 'TICKET'::"text") THEN ("cae" IS NULL)
    ELSE ("cae" IS NOT NULL)
END),
    CONSTRAINT "comprobantes_tipo_check" CHECK (("tipo" = ANY (ARRAY['TICKET'::"text", 'FACTURA_A'::"text", 'FACTURA_B'::"text", 'FACTURA_C'::"text", 'NOTA_CREDITO_A'::"text", 'NOTA_CREDITO_B'::"text", 'NOTA_CREDITO_C'::"text"])))
);


ALTER TABLE "public"."comprobantes" OWNER TO "postgres";


COMMENT ON TABLE "public"."comprobantes" IS 'Comprobantes emitidos por venta. INMUTABLE: sin policy de UPDATE/DELETE. Se corrige emitiendo una nota de credito que apunte al original via anula_comprobante_id.';



COMMENT ON COLUMN "public"."comprobantes"."receptor_cuit" IS 'Congelado al emitir. NO leer los datos del receptor por join contra clientes: la factura emitida no puede cambiar porque el cliente edito su ficha.';



COMMENT ON COLUMN "public"."comprobantes"."fecha_comprobante" IS 'CbteFch: dia fiscal en hora Argentina. emitido_en es el instante tecnico.';



COMMENT ON COLUMN "public"."comprobantes"."arca_ambiente" IS 'HOMOLOGACION o PRODUCCION para lo fiscal, NULL para TICKET. Los de homologacion NO van al libro de IVA: son pruebas.';



COMMENT ON CONSTRAINT "comprobantes_ticket_sin_cae_check" ON "public"."comprobantes" IS 'TICKET nunca lleva CAE; todo lo fiscal SIEMPRE lo lleva. Obliga a pedir el CAE antes de insertar la fila.';



CREATE TABLE IF NOT EXISTS "public"."comprobantes_iva" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "comprobante_id" "uuid" NOT NULL,
    "alicuota_id" integer NOT NULL,
    "base_imponible" numeric(14,2) NOT NULL,
    "importe" numeric(14,2) NOT NULL,
    CONSTRAINT "comprobantes_iva_importes_check" CHECK ((("base_imponible" >= (0)::numeric) AND ("importe" >= (0)::numeric)))
);


ALTER TABLE "public"."comprobantes_iva" OWNER TO "postgres";


COMMENT ON TABLE "public"."comprobantes_iva" IS 'Subtotal por alicuota de un comprobante fiscal. INMUTABLE (sin policy de UPDATE/DELETE), como comprobantes.';



CREATE TABLE IF NOT EXISTS "public"."configuracion_pos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "posName" "text" DEFAULT 'Vivero Tostado'::"text" NOT NULL,
    "whatsapp" "text" NOT NULL,
    "direccion" "text" DEFAULT ''::"text",
    "mensaje_ticket" "text" DEFAULT '¡Gracias por su compra!'::"text",
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "posLogo" "text",
    "catalogo_activo" boolean DEFAULT true,
    "mostrar_precios" boolean DEFAULT true,
    "mostrar_sin_stock" boolean DEFAULT false,
    "pedidos_whatsapp" boolean DEFAULT true,
    "direccion_visible" boolean DEFAULT true,
    "horario_visible" boolean DEFAULT true,
    "banner_activo" boolean DEFAULT false,
    "instagram" "text" DEFAULT ''::"text",
    "facebook" "text" DEFAULT ''::"text",
    "horario_texto" "text" DEFAULT ''::"text",
    "banner_imagen" "text" DEFAULT ''::"text",
    "banner_titulo" "text" DEFAULT ''::"text",
    "banner_subtitulo" "text" DEFAULT ''::"text",
    "banner_boton_texto" "text" DEFAULT ''::"text",
    "banner_link" "text" DEFAULT ''::"text",
    "marquee_activo" boolean DEFAULT false,
    "marquee_texto" "text" DEFAULT '🚀 3 CUOTAS SIN INTERÉS // ENVÍO GRATIS COMPRANDO +$50.000 // 15% OFF EN EFECTIVO 🚀'::"text",
    "cc_activas" boolean DEFAULT true,
    "cc_recargo_default" numeric(5,2) DEFAULT 0,
    "cc_anticipo_default" numeric(5,2) DEFAULT 0,
    "cc_limite_default" numeric(12,2) DEFAULT 0,
    "cc_plazo_mora" integer DEFAULT 30,
    "crm_dias_inactivo" integer DEFAULT 60,
    "modo_caja" "text" DEFAULT 'UNICA'::"text" NOT NULL,
    "requiere_caja_abierta" boolean DEFAULT true NOT NULL,
    "envio_costo_local" numeric,
    "envio_mensaje_lejos" "text" DEFAULT 'Envío a convenir — te contactamos por WhatsApp para coordinar'::"text",
    "localidad_negocio" "text",
    "permitir_venta_sin_stock" boolean DEFAULT false NOT NULL,
    "entrega_minima_bloqueante" boolean DEFAULT false NOT NULL,
    "recargo_mora_tipo" "text" DEFAULT 'NINGUNO'::"text" NOT NULL,
    "recargo_mora_valor" numeric(12,2) DEFAULT 0 NOT NULL,
    "rubro" "text" DEFAULT 'indumentaria'::"text" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "razon_social" "text",
    "cuit" "text",
    "condicion_iva" "text",
    "inicio_actividades" "date",
    "provincia" "text",
    "localidad" "text",
    "modo_facturacion" "text" DEFAULT 'INTERNO'::"text" NOT NULL,
    "comprobante_defecto" "text" DEFAULT 'TICKET'::"text" NOT NULL,
    "punto_venta" integer,
    "ancho_ticket_mm" integer DEFAULT 80 NOT NULL,
    "banner_imagen_desktop" "text",
    "banner_focal_x" smallint,
    "banner_focal_y" smallint,
    "banner_focal_desktop_x" smallint,
    "banner_focal_desktop_y" smallint,
    "arca_ambiente" "text" DEFAULT 'HOMOLOGACION'::"text" NOT NULL,
    "facturar_por_defecto" boolean DEFAULT true NOT NULL,
    "pedidos_a_caja" boolean DEFAULT false NOT NULL,
    "arca_recargos_iva" "text" DEFAULT 'GRAVADO_21'::"text" NOT NULL,
    "arca_ri_a_monotributo" "text" DEFAULT 'FACTURA_B'::"text" NOT NULL,
    "arca_tope_consumidor_final" numeric(14,2),
    "plan_tasas_financiacion" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "plan_frecuencia_default" "text" DEFAULT 'MENSUAL'::"text" NOT NULL,
    "plan_mora_tipo" "text" DEFAULT 'NINGUNO'::"text" NOT NULL,
    "plan_mora_valor" numeric(14,2) DEFAULT 0 NOT NULL,
    "plan_dias_gracia" integer DEFAULT 0 NOT NULL,
    "plan_penalidad_cancelacion_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "presupuesto_vigencia_dias" integer DEFAULT 7 NOT NULL,
    CONSTRAINT "configuracion_pos_ancho_ticket_valido" CHECK (("ancho_ticket_mm" = ANY (ARRAY[58, 80]))),
    CONSTRAINT "configuracion_pos_arca_ambiente_check" CHECK (("arca_ambiente" = ANY (ARRAY['HOMOLOGACION'::"text", 'PRODUCCION'::"text"]))),
    CONSTRAINT "configuracion_pos_arca_recargos_iva_check" CHECK (("arca_recargos_iva" = ANY (ARRAY['GRAVADO_21'::"text", 'GRAVADO_105'::"text", 'GRAVADO_27'::"text", 'EXENTO'::"text", 'NO_GRAVADO'::"text"]))),
    CONSTRAINT "configuracion_pos_arca_ri_a_monotributo_check" CHECK (("arca_ri_a_monotributo" = ANY (ARRAY['FACTURA_A'::"text", 'FACTURA_B'::"text"]))),
    CONSTRAINT "configuracion_pos_arca_tope_cf_check" CHECK ((("arca_tope_consumidor_final" IS NULL) OR ("arca_tope_consumidor_final" > (0)::numeric))),
    CONSTRAINT "configuracion_pos_comprobante_defecto_check" CHECK ((("comprobante_defecto" = ANY (ARRAY['TICKET'::"text", 'FACTURA_A'::"text", 'FACTURA_B'::"text", 'FACTURA_C'::"text"])) AND (("comprobante_defecto" = 'TICKET'::"text") OR ("modo_facturacion" = 'ARCA'::"text")))),
    CONSTRAINT "configuracion_pos_condicion_iva_check" CHECK ((("condicion_iva" IS NULL) OR ("condicion_iva" = ANY (ARRAY['Responsable Inscripto'::"text", 'Monotributo'::"text", 'Exento'::"text", 'Consumidor Final'::"text"])))),
    CONSTRAINT "configuracion_pos_focal_rango" CHECK (((("banner_focal_x" IS NULL) OR (("banner_focal_x" >= 0) AND ("banner_focal_x" <= 100))) AND (("banner_focal_y" IS NULL) OR (("banner_focal_y" >= 0) AND ("banner_focal_y" <= 100))) AND (("banner_focal_desktop_x" IS NULL) OR (("banner_focal_desktop_x" >= 0) AND ("banner_focal_desktop_x" <= 100))) AND (("banner_focal_desktop_y" IS NULL) OR (("banner_focal_desktop_y" >= 0) AND ("banner_focal_desktop_y" <= 100))))),
    CONSTRAINT "configuracion_pos_modo_facturacion_check" CHECK (("modo_facturacion" = ANY (ARRAY['INTERNO'::"text", 'MANUAL'::"text", 'ARCA'::"text"]))),
    CONSTRAINT "configuracion_pos_plan_frecuencia_check" CHECK (("plan_frecuencia_default" = ANY (ARRAY['SEMANAL'::"text", 'QUINCENAL'::"text", 'MENSUAL'::"text"]))),
    CONSTRAINT "configuracion_pos_plan_gracia_check" CHECK ((("plan_dias_gracia" >= 0) AND ("plan_dias_gracia" <= 365))),
    CONSTRAINT "configuracion_pos_plan_mora_check" CHECK ((("plan_mora_tipo" = ANY (ARRAY['NINGUNO'::"text", 'MONTO_FIJO'::"text", 'PORCENTAJE'::"text"])) AND ("plan_mora_valor" >= (0)::numeric) AND (("plan_mora_tipo" <> 'PORCENTAJE'::"text") OR ("plan_mora_valor" <= (100)::numeric)))),
    CONSTRAINT "configuracion_pos_plan_penalidad_check" CHECK ((("plan_penalidad_cancelacion_pct" >= (0)::numeric) AND ("plan_penalidad_cancelacion_pct" <= (100)::numeric))),
    CONSTRAINT "configuracion_pos_plan_tasas_check" CHECK ((("jsonb_typeof"("plan_tasas_financiacion") = 'array'::"text") AND (NOT "jsonb_path_exists"("plan_tasas_financiacion", '$[*]?(!((((@."cuotas".type() == "number" && @."cuotas" >= 1) && @."cuotas" == @."cuotas".floor()) && @."pct".type() == "number") && @."pct" >= 0))'::"jsonpath")))),
    CONSTRAINT "configuracion_pos_presupuesto_vigencia_check" CHECK ((("presupuesto_vigencia_dias" >= 1) AND ("presupuesto_vigencia_dias" <= 365))),
    CONSTRAINT "configuracion_pos_punto_venta_check" CHECK ((("punto_venta" IS NULL) OR (("punto_venta" >= 1) AND ("punto_venta" <= 99999)))),
    CONSTRAINT "configuracion_pos_recargo_mora_tipo_check" CHECK (("recargo_mora_tipo" = ANY (ARRAY['NINGUNO'::"text", 'MONTO_FIJO'::"text", 'PORCENTAJE'::"text"]))),
    CONSTRAINT "configuracion_pos_rubro_check" CHECK (("rubro" = ANY (ARRAY['indumentaria'::"text", 'electro'::"text", 'alimentos'::"text", 'farmacia'::"text", 'ferreteria'::"text", 'quioscos'::"text", 'cotillon'::"text", 'otros'::"text"])))
);


ALTER TABLE "public"."configuracion_pos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."configuracion_pos"."rubro" IS 'Rubro operativo del comercio. Decide que columnas trae la plantilla de mercaderia (columnas-por-rubro.ts) y como se muestra la identidad del producto en Inventario. Fail-closed: un valor desconocido se lee como indumentaria.';



COMMENT ON COLUMN "public"."configuracion_pos"."localidad" IS 'Localidad del domicilio fiscal (ticket/factura). Para envíos del catálogo, ver localidad_negocio.';



COMMENT ON COLUMN "public"."configuracion_pos"."modo_facturacion" IS 'INTERNO | MANUAL | ARCA. Solo ARCA emite comprobantes con CAE; MANUAL factura fuera de Comerz y para el POS se comporta como INTERNO.';



COMMENT ON COLUMN "public"."configuracion_pos"."comprobante_defecto" IS 'Comprobante preseleccionado en la caja. Solo puede ser una factura si modo_facturacion = ARCA (CHECK).';



COMMENT ON COLUMN "public"."configuracion_pos"."punto_venta" IS 'Punto de venta de ARCA (1..99999). NULL = todavía no dado de alta.';



COMMENT ON COLUMN "public"."configuracion_pos"."ancho_ticket_mm" IS 'Ancho del papel de la impresora termica, en milimetros: 58 u 80. Solo afecta la impresion; el PDF es A4 y el texto de WhatsApp no tiene ancho.';



COMMENT ON COLUMN "public"."configuracion_pos"."banner_imagen_desktop" IS 'Banner del catálogo para pantallas >= 640px. NULL = se usa banner_imagen en todos los tamaños. La de mobile es la obligatoria.';



COMMENT ON COLUMN "public"."configuracion_pos"."banner_focal_x" IS 'Punto de interes horizontal del banner de mobile, 0-100 (%). NULL = centrado.';



COMMENT ON COLUMN "public"."configuracion_pos"."banner_focal_y" IS 'Punto de interes vertical del banner de mobile, 0-100 (%). NULL = centrado.';



COMMENT ON COLUMN "public"."configuracion_pos"."banner_focal_desktop_x" IS 'Punto de interes horizontal del banner de desktop, 0-100 (%). NULL = centrado.';



COMMENT ON COLUMN "public"."configuracion_pos"."banner_focal_desktop_y" IS 'Punto de interes vertical del banner de desktop, 0-100 (%). NULL = centrado.';



COMMENT ON COLUMN "public"."configuracion_pos"."arca_ambiente" IS 'Contra que ARCA se emite: HOMOLOGACION (pruebas, CAE sin valor) o PRODUCCION. Solo importa con modo_facturacion = ARCA. Default homologacion a proposito.';



COMMENT ON COLUMN "public"."configuracion_pos"."facturar_por_defecto" IS 'Con modo ARCA: si el switch Factura/Ticket del POS arranca en factura. La vendedora con ventas.elegir_comprobante lo cambia por venta.';



COMMENT ON COLUMN "public"."configuracion_pos"."pedidos_a_caja" IS 'Si el POS ofrece "Enviar a caja": la venta se arma en un punto y la cobra la caja. Con false nada cambia.';



COMMENT ON COLUMN "public"."configuracion_pos"."arca_recargos_iva" IS 'Tratamiento de IVA de los recargos (metodo de pago y cuenta corriente) en facturas A/B. Lo confirma el contador.';



COMMENT ON COLUMN "public"."configuracion_pos"."arca_ri_a_monotributo" IS 'Letra que emite un Responsable Inscripto a un Monotributista: FACTURA_A o FACTURA_B. Lo confirma el contador.';



COMMENT ON COLUMN "public"."configuracion_pos"."arca_tope_consumidor_final" IS 'Tope para facturar a consumidor final sin DNI/CUIT. NULL = default del sistema (codigos-arca.ts), que sigue a la RG vigente.';



COMMENT ON COLUMN "public"."configuracion_pos"."plan_tasas_financiacion" IS 'Recargo de financiación por cantidad de cuotas: [{"cuotas":3,"pct":10}, ...]. Se aplica sobre el saldo FINANCIADO (total - anticipo), no sobre el total.';



COMMENT ON COLUMN "public"."configuracion_pos"."plan_mora_tipo" IS 'Mora por cuota vencida: NINGUNO | MONTO_FIJO | PORCENTAJE. Una sola vez por cuota y sobre capital, igual que la cuenta corriente: no se compone.';



COMMENT ON COLUMN "public"."configuracion_pos"."plan_penalidad_cancelacion_pct" IS 'Porcentaje de lo pagado que el comercio retiene si el cliente cancela un plan. El resto se le devuelve.';



COMMENT ON COLUMN "public"."configuracion_pos"."presupuesto_vigencia_dias" IS 'Validez por defecto de una cotización. Vencida, al aceptarla se recotiza al precio vigente.';



CREATE TABLE IF NOT EXISTS "public"."cuenta_corriente_movimientos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "venta_id" "uuid",
    "pago_id" "uuid",
    "tipo" "text" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "descripcion" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "monto_recargo" numeric(12,2) DEFAULT 0 NOT NULL,
    "fecha_origen" "date",
    "anulado" boolean DEFAULT false NOT NULL,
    "anulado_en" timestamp with time zone,
    "anulado_por" "uuid",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "recargo_porcentaje" numeric(5,2),
    "debito_origen_id" "uuid",
    "origen_reconstruido" boolean DEFAULT false NOT NULL,
    "es_saldo_a_favor" boolean DEFAULT false NOT NULL,
    CONSTRAINT "cc_mov_origen_no_es_si_mismo" CHECK ((("debito_origen_id" IS NULL) OR ("debito_origen_id" <> "id"))),
    CONSTRAINT "cc_mov_origen_solo_en_mora" CHECK ((("debito_origen_id" IS NULL) OR (("tipo" = 'DEBITO'::"text") AND ("pago_id" IS NOT NULL))))
);


ALTER TABLE "public"."cuenta_corriente_movimientos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."cuenta_corriente_movimientos"."monto_recargo" IS 'Parte de `monto` que es recargo por fiar, no mercaderia. En los CREDITO no aplica.';



COMMENT ON COLUMN "public"."cuenta_corriente_movimientos"."recargo_porcentaje" IS 'Porcentaje de recargo aplicado al DEBITO. Acompana a monto_recargo, que hasta 20260823140000 existia pero nunca se escribia.';



COMMENT ON COLUMN "public"."cuenta_corriente_movimientos"."debito_origen_id" IS 'Solo en filas de recargo por mora: el DEBITO de capital al que pertenece ese recargo. Capital y mora del mismo ticket se imputan como una unidad. NULL = no se sabe (nunca "es del primero").';



COMMENT ON COLUMN "public"."cuenta_corriente_movimientos"."origen_reconstruido" IS 'true = el vinculo lo dedujo el backfill del 9/9/2026 a partir del ledger, no se declaro al cobrar. Queda para siempre: una deduccion no puede hacerse pasar por un dato cargado.';



COMMENT ON COLUMN "public"."cuenta_corriente_movimientos"."es_saldo_a_favor" IS 'Movimiento que usa (DEBITO) o genera (CREDITO) saldo a favor sin ser deuda ni cobro de deuda: pago con saldo a favor, saldo a favor devuelto al anular, reintegro "a cuenta". No se cuenta como fiado.';



CREATE TABLE IF NOT EXISTS "public"."cuentas_financieras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "codigo" "text" NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "es_efectivo" boolean DEFAULT false NOT NULL,
    "requiere_arqueo" boolean DEFAULT false NOT NULL,
    "es_sistema" boolean DEFAULT false NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cuentas_financieras_arqueo_solo_efectivo" CHECK (((NOT "requiere_arqueo") OR "es_efectivo")),
    CONSTRAINT "cuentas_financieras_codigo_canonico" CHECK (("codigo" = "upper"("btrim"("codigo")))),
    CONSTRAINT "cuentas_financieras_codigo_no_vacio" CHECK (("length"("btrim"("codigo")) > 0)),
    CONSTRAINT "cuentas_financieras_nombre_no_vacio" CHECK (("length"("btrim"("nombre")) > 0)),
    CONSTRAINT "cuentas_financieras_tipo_check" CHECK (("tipo" = ANY (ARRAY['CAJA_DIARIA'::"text", 'CAJA_GENERAL'::"text", 'BANCO'::"text", 'BILLETERA'::"text", 'PUENTE_ACREDITACION'::"text", 'OTRA'::"text"])))
);


ALTER TABLE "public"."cuentas_financieras" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."devoluciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "venta_id" "uuid" NOT NULL,
    "base_devuelta" numeric NOT NULL,
    "recargo_devuelto" numeric DEFAULT 0 NOT NULL,
    "monto_devuelto" numeric NOT NULL,
    "metodo_tipo" "text" NOT NULL,
    "metodo_nombre" "text",
    "turno_caja_id" "uuid",
    "motivo_codigo" "text",
    "motivo_detalle" "text",
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recargo_cc_perdonado" numeric DEFAULT 0 NOT NULL,
    "credito_cc" numeric DEFAULT 0 NOT NULL,
    "excedente_a_devolver" numeric DEFAULT 0 NOT NULL,
    "reintegro_metodo_id" "uuid",
    "reintegro_metodo_tipo" "text",
    "reintegro_metodo_nombre" "text",
    CONSTRAINT "devoluciones_motivo_codigo_check" CHECK ((("motivo_codigo" IS NULL) OR ("motivo_codigo" = ANY (ARRAY['ERROR_DE_CARGA'::"text", 'CAMBIO'::"text", 'ARREPENTIMIENTO'::"text", 'FALLADO'::"text", 'OTRO'::"text"]))))
);


ALTER TABLE "public"."devoluciones" OWNER TO "postgres";


COMMENT ON COLUMN "public"."devoluciones"."recargo_devuelto" IS 'Siempre 0 desde 20260903190000: el recargo por metodo de pago no se devuelve porque el banco o la fintech no reintegra su comision. Se conserva la columna por si una politica futura devuelve parte.';



COMMENT ON COLUMN "public"."devoluciones"."recargo_cc_perdonado" IS 'Recargo de cuenta corriente que se le perdona al cliente por lo devuelto. A diferencia del recargo por metodo de pago, este SI vuelve: no se lo quedo un tercero.';



COMMENT ON COLUMN "public"."devoluciones"."credito_cc" IS 'Cuanto bajo efectivamente la deuda del cliente. Acotado al saldo vivo con least(), igual que anular_venta.';



COMMENT ON COLUMN "public"."devoluciones"."excedente_a_devolver" IS 'Lo que la deuda no pudo absorber porque el cliente ya habia pagado de mas. NO se mueve solo: los pagos de CC no estan imputados a una venta, asi que la app lo avisa para resolverlo a mano.';



COMMENT ON COLUMN "public"."devoluciones"."reintegro_metodo_tipo" IS 'Medio por el que se le devolvio la plata al cliente. DISTINTO de metodo_tipo, que guarda con que se habia COBRADO la venta. null = no se eligio.';



CREATE TABLE IF NOT EXISTS "public"."devoluciones_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "devolucion_id" "uuid" NOT NULL,
    "venta_item_id" "uuid" NOT NULL,
    "variante_id" "uuid",
    "cantidad" numeric NOT NULL,
    "precio_final" numeric NOT NULL,
    "destino" "text" NOT NULL,
    CONSTRAINT "devoluciones_items_cantidad_check" CHECK (("cantidad" > (0)::numeric)),
    CONSTRAINT "devoluciones_items_destino_check" CHECK (("destino" = ANY (ARRAY['STOCK'::"text", 'BAJA'::"text"])))
);


ALTER TABLE "public"."devoluciones_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."diccionario_alias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proveedor" "text" NOT NULL,
    "raw_nombre" "text" NOT NULL,
    "producto_id" "uuid",
    "creado_en" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"()
);


ALTER TABLE "public"."diccionario_alias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."egresos_programados" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "concepto" "text" NOT NULL,
    "monto" numeric(14,2) NOT NULL,
    "tipo" "text" DEFAULT 'OPERATIVO'::"text" NOT NULL,
    "categoria_id" "uuid",
    "cuenta_origen_id" "uuid",
    "frecuencia" "text" NOT NULL,
    "proxima_fecha" "date" NOT NULL,
    "dia_ancla" smallint,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_por" "uuid" DEFAULT "auth"."uid"(),
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "egresos_programados_categoria_solo_operativo" CHECK ((("categoria_id" IS NULL) OR ("tipo" = 'OPERATIVO'::"text"))),
    CONSTRAINT "egresos_programados_concepto_check" CHECK (("btrim"("concepto") <> ''::"text")),
    CONSTRAINT "egresos_programados_dia_ancla_check" CHECK ((("dia_ancla" >= 1) AND ("dia_ancla" <= 31))),
    CONSTRAINT "egresos_programados_frecuencia_check" CHECK (("frecuencia" = ANY (ARRAY['UNICO'::"text", 'SEMANAL'::"text", 'QUINCENAL'::"text", 'MENSUAL'::"text", 'BIMESTRAL'::"text", 'TRIMESTRAL'::"text", 'ANUAL'::"text"]))),
    CONSTRAINT "egresos_programados_monto_check" CHECK (("monto" > (0)::numeric)),
    CONSTRAINT "egresos_programados_tipo_check" CHECK (("tipo" = ANY (ARRAY['OPERATIVO'::"text", 'RETIRO_SOCIO'::"text", 'COMPRA_MERCADERIA'::"text"])))
);


ALTER TABLE "public"."egresos_programados" OWNER TO "postgres";


COMMENT ON TABLE "public"."egresos_programados" IS 'Agenda de gastos que se repiten (alquiler, sueldos, suscripciones). NO registra el gasto al llegar la fecha: recuerda, y una persona confirma. Confirmar inserta en `egresos` por el camino de siempre y corre la fecha, en una transaccion.';



CREATE TABLE IF NOT EXISTS "public"."email_bajas" (
    "email" "text" NOT NULL,
    "motivo" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_bajas" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_bajas" IS 'Direcciones que pidieron no recibir mas mails de Comerz. Se consulta antes de cada envio. Por direccion y no por usuario: la baja es de la casilla. Ver 20260910120000.';



CREATE TABLE IF NOT EXISTS "public"."envios_email" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "campana" "text" NOT NULL,
    "etapa" "text" NOT NULL,
    "proveedor_id" "text",
    "forzado" boolean DEFAULT false NOT NULL,
    "enviado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."envios_email" OWNER TO "postgres";


COMMENT ON TABLE "public"."envios_email" IS 'Mails de ciclo de vida que salieron desde /admincomerz, uno por envio. NO incluye los de auth (confirmacion, magic link), que los manda Supabase. Ver 20260910120000.';



COMMENT ON COLUMN "public"."envios_email"."usuario_id" IS 'auth.users.id. SIN FK: el registro del envio sobrevive a que la cuenta se borre.';



COMMENT ON COLUMN "public"."envios_email"."etapa" IS 'Escalon del embudo AL MOMENTO del envio, congelado. La etapa actual se recalcula y ya no serviria para evaluar la campana.';



CREATE TABLE IF NOT EXISTS "public"."eventos_comerz" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid",
    "tipo" "text" NOT NULL,
    "detalle" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "visto_en" timestamp with time zone,
    CONSTRAINT "eventos_comerz_tipo_check" CHECK (("tipo" = ANY (ARRAY['NEGOCIO_CREADO'::"text", 'SOLICITUD_PLAN'::"text", 'PAGO_REGISTRADO'::"text", 'PLAN_CAMBIADO'::"text", 'ESTADO_CAMBIADO'::"text", 'SLUG_CAMBIADO'::"text"])))
);


ALTER TABLE "public"."eventos_comerz" OWNER TO "postgres";


COMMENT ON TABLE "public"."eventos_comerz" IS 'Hechos puntuales del negocio SaaS. Solo lo que ocurre una vez y en un instante: lo que es ESTADO (vencido, en prueba, sin plan) se deriva en vivo y no se guarda acá, para que no pueda quedar desactualizado.';



CREATE TABLE IF NOT EXISTS "public"."eventos_uso" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "tipo" "text" NOT NULL,
    "detalle" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eventos_uso_tipo_no_vacio" CHECK (("length"(TRIM(BOTH FROM "tipo")) > 0))
);


ALTER TABLE "public"."eventos_uso" OWNER TO "postgres";


COMMENT ON TABLE "public"."eventos_uso" IS 'Telemetria de uso del producto: que acciones usa la gente. Append-only. Distinta de eventos_comerz, que es el ciclo de vida del SaaS y solo la ve el super admin.';



COMMENT ON COLUMN "public"."eventos_uso"."tipo" IS 'Etiqueta del evento, ej. COMPROBANTE_ENTREGADO. Sin CHECK: medir algo nuevo no tiene que costar una migracion.';



COMMENT ON COLUMN "public"."eventos_uso"."detalle" IS 'Contexto del evento, opaco para la base. Nada de plata ni de datos de clientes.';



CREATE TABLE IF NOT EXISTS "public"."gastos_comerz" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "mes" "date" NOT NULL,
    "concepto" "text" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "nota" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "registrado_por" "uuid",
    "tipo" "text" DEFAULT 'UNICO'::"text" NOT NULL,
    "categoria" "text" DEFAULT 'otro'::"text" NOT NULL,
    "hasta" "date",
    CONSTRAINT "costos_infra_monto_check" CHECK (("monto" >= (0)::numeric)),
    CONSTRAINT "gastos_comerz_categoria_check" CHECK (("categoria" = ANY (ARRAY['infra'::"text", 'sueldo'::"text", 'marketing'::"text", 'impuestos'::"text", 'servicios'::"text", 'otro'::"text"]))),
    CONSTRAINT "gastos_comerz_hasta_posterior" CHECK ((("hasta" IS NULL) OR ("hasta" >= "mes"))),
    CONSTRAINT "gastos_comerz_hasta_solo_fijo" CHECK ((("hasta" IS NULL) OR ("tipo" = 'FIJO'::"text"))),
    CONSTRAINT "gastos_comerz_tipo_check" CHECK (("tipo" = ANY (ARRAY['FIJO'::"text", 'UNICO'::"text"])))
);


ALTER TABLE "public"."gastos_comerz" OWNER TO "postgres";


COMMENT ON TABLE "public"."gastos_comerz" IS 'Los gastos de Comerz como negocio. Reemplaza a costos_infra, que solo contemplaba proveedores de infraestructura. Un gasto FIJO cuenta en todos los meses desde `mes` hasta `hasta` (null = vigente); uno UNICO cuenta solo en `mes`.';



COMMENT ON COLUMN "public"."gastos_comerz"."hasta" IS 'Ultimo mes en que aplica un gasto FIJO. Null = sigue vigente. Dar de baja un fijo es ponerle fecha aca, NO borrar la fila: el margen de los meses pasados tiene que seguir dando lo mismo.';



CREATE TABLE IF NOT EXISTS "public"."importaciones_productos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "hash" "text" NOT NULL,
    "nombre_archivo" "text",
    "forzada" boolean DEFAULT false NOT NULL,
    "filas_totales" integer DEFAULT 0 NOT NULL,
    "filas_ok" integer DEFAULT 0 NOT NULL,
    "filas_error" integer DEFAULT 0 NOT NULL,
    "importado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."importaciones_productos" OWNER TO "postgres";


COMMENT ON TABLE "public"."importaciones_productos" IS 'Una fila por import de planilla ejecutado. El unique parcial (negocio_id, hash) where not forzada es el guard de idempotencia que consume importar_productos_planilla.';



CREATE TABLE IF NOT EXISTS "public"."ingresos_financieros" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "cuenta_destino_id" "uuid" NOT NULL,
    "turno_caja_id" "uuid",
    "tipo" "text" NOT NULL,
    "monto" numeric NOT NULL,
    "concepto" "text" NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "registrado_por" "uuid",
    "anulado_en" timestamp with time zone,
    "anulado_por" "uuid",
    "motivo_anulacion" "text",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ingresos_financieros_anulacion_completa" CHECK (((("anulado_en" IS NULL) = ("anulado_por" IS NULL)) AND (("anulado_en" IS NULL) = ("motivo_anulacion" IS NULL)))),
    CONSTRAINT "ingresos_financieros_concepto_check" CHECK (("length"("btrim"("concepto")) > 0)),
    CONSTRAINT "ingresos_financieros_monto_check" CHECK (("monto" > (0)::numeric)),
    CONSTRAINT "ingresos_financieros_tipo_check" CHECK (("tipo" = ANY (ARRAY['APORTE_SOCIO'::"text", 'PRESTAMO'::"text", 'INGRESO_EXTRAORDINARIO'::"text"])))
);


ALTER TABLE "public"."ingresos_financieros" OWNER TO "postgres";


COMMENT ON TABLE "public"."ingresos_financieros" IS 'Plata que entra sin venir de una venta (aporte, préstamo, ingreso extraordinario). Lo que suma es su fila en movimientos_financieros (origen INGRESO). Se anula con reversa, nunca se borra. Ver 20260922100000.';



CREATE TABLE IF NOT EXISTS "public"."invitaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "email" "text" NOT NULL,
    "rol_id" "uuid" NOT NULL,
    "token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invitado_por" "uuid",
    "estado" "text" DEFAULT 'PENDIENTE'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expira_en" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    CONSTRAINT "invitaciones_estado_check" CHECK (("estado" = ANY (ARRAY['PENDIENTE'::"text", 'ACEPTADA'::"text", 'CANCELADA'::"text"])))
);


ALTER TABLE "public"."invitaciones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."listas_precios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo_regla" "text" DEFAULT 'PORCENTAJE'::"text" NOT NULL,
    "valor" numeric DEFAULT 0 NOT NULL,
    "admite_promociones" boolean DEFAULT false NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "listas_precios_nombre_no_vacio" CHECK (("length"(TRIM(BOTH FROM "nombre")) > 0)),
    CONSTRAINT "listas_precios_tipo_regla_check" CHECK (("tipo_regla" = ANY (ARRAY['PORCENTAJE'::"text", 'MARKUP'::"text"]))),
    CONSTRAINT "listas_precios_valor_coherente" CHECK (((("tipo_regla" = 'PORCENTAJE'::"text") AND ("valor" > ('-100'::integer)::numeric)) OR (("tipo_regla" = 'MARKUP'::"text") AND ("valor" > (0)::numeric))))
);


ALTER TABLE "public"."listas_precios" OWNER TO "postgres";


COMMENT ON TABLE "public"."listas_precios" IS 'Listas de precios de un comercio (Mayorista, Distribuidor). NO hay fila para el precio minorista: productos.precio ya lo es, y "sin lista" se representa con NULL. Una lista es un PRECIO por segmento de cliente; una promocion es un DESCUENTO por condicion de venta.';



COMMENT ON COLUMN "public"."listas_precios"."tipo_regla" IS 'PORCENTAJE (ajuste firmado sobre productos.precio) | MARKUP (multiplicador sobre productos.precio_costo). CHECK fail-closed.';



COMMENT ON COLUMN "public"."listas_precios"."valor" IS 'Con PORCENTAJE, el ajuste firmado: -20 es 20% menos. Con MARKUP, el multiplicador sobre el costo: 1.5 es costo x 1,5.';



COMMENT ON COLUMN "public"."listas_precios"."admite_promociones" IS 'Si una promocion puede descontar ADEMAS del precio de lista. Default false: el precio de lista ya es el descuento, y acumular sin decidirlo se come el margen (20.000 a -20% mas 5% deja el margen en 34,2% contra 50%).';



CREATE TABLE IF NOT EXISTS "public"."metodos_pago" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "comision" numeric(5,2) DEFAULT 0 NOT NULL,
    "acreditacion_dias" integer DEFAULT 0 NOT NULL,
    "activo" boolean DEFAULT true NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recargo_porcentaje" numeric DEFAULT 0 NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "cuenta_destino_id" "uuid",
    CONSTRAINT "metodos_pago_recargo_porcentaje_check" CHECK ((("recargo_porcentaje" >= (0)::numeric) AND ("recargo_porcentaje" <= (100)::numeric)))
);


ALTER TABLE "public"."metodos_pago" OWNER TO "postgres";


COMMENT ON COLUMN "public"."metodos_pago"."recargo_porcentaje" IS 'Recargo % que se le suma al cliente por pagar con este metodo (0 = sin recargo). NO es la comision del procesador, que es `comision` y se resta.';



CREATE TABLE IF NOT EXISTS "public"."movimientos_financieros" (
    "id" bigint NOT NULL,
    "evento_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "operacion_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "cuenta_financiera_id" "uuid" NOT NULL,
    "origen_tipo" "text" NOT NULL,
    "origen_id" "uuid" NOT NULL,
    "evento" "text" NOT NULL,
    "importe" numeric NOT NULL,
    "impacto_resultado" numeric DEFAULT 0 NOT NULL,
    "turno_caja_id" "uuid",
    "orden_compra_id" "uuid",
    "descripcion" "text",
    "datos" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "fecha_movimiento" timestamp with time zone NOT NULL,
    "registrado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "registrado_por" "uuid",
    CONSTRAINT "movimientos_financieros_datos_objeto" CHECK (("jsonb_typeof"("datos") = 'object'::"text")),
    CONSTRAINT "movimientos_financieros_evento_check" CHECK (("evento" = ANY (ARRAY['MIGRACION_ESTADO_INICIAL'::"text", 'REGISTRO'::"text", 'REGISTRO_ANULADO'::"text", 'ANULACION'::"text", 'REACTIVACION'::"text", 'CORRECCION_REVERSA'::"text", 'CORRECCION_APLICADA'::"text", 'CORRECCION_SIN_IMPACTO'::"text", 'ELIMINACION_REVERSA'::"text", 'TRANSFERENCIA_SALIDA'::"text", 'TRANSFERENCIA_ENTRADA'::"text", 'ACREDITACION_SALIDA'::"text", 'ACREDITACION_ENTRADA'::"text", 'APERTURA_TURNO'::"text", 'CIERRE_TURNO'::"text", 'AJUSTE_ARQUEO'::"text", 'CORRECCION_HISTORICA'::"text", 'AJUSTE_SALDO_INICIAL'::"text"]))),
    CONSTRAINT "movimientos_financieros_origen_tipo_check" CHECK (("origen_tipo" = ANY (ARRAY['VENTA_PAGO'::"text", 'EGRESO'::"text", 'TRANSFERENCIA'::"text", 'ACREDITACION'::"text", 'TURNO_CAJA'::"text", 'AJUSTE'::"text", 'INGRESO'::"text"])))
);


ALTER TABLE "public"."movimientos_financieros" OWNER TO "postgres";


ALTER TABLE "public"."movimientos_financieros" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."movimientos_financieros_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."movimientos_stock" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "variante_id" "uuid" NOT NULL,
    "producto_id" "uuid",
    "delta" numeric(12,3),
    "stock_anterior" numeric(12,3),
    "stock_nuevo" numeric(12,3) NOT NULL,
    "origen" "text" DEFAULT 'DESCONOCIDO'::"text" NOT NULL,
    "referencia_id" "uuid",
    "usuario_id" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "movimientos_stock_foto_check" CHECK (((("origen" = 'FOTO_INICIAL'::"text") = ("delta" IS NULL)) AND (("delta" IS NULL) = ("stock_anterior" IS NULL)))),
    CONSTRAINT "movimientos_stock_origen_check" CHECK (("origen" = ANY (ARRAY['VENTA'::"text", 'ANULACION_VENTA'::"text", 'DEVOLUCION_PARCIAL'::"text", 'REVERSO_VENTA'::"text", 'REMITO'::"text", 'CARGA_RAPIDA'::"text", 'IMPORTACION'::"text", 'EDICION_VARIANTES'::"text", 'BAJA'::"text", 'BAJA_PRODUCTO'::"text", 'FOTO_INICIAL'::"text", 'DESCONOCIDO'::"text"])))
);


ALTER TABLE "public"."movimientos_stock" OWNER TO "postgres";


COMMENT ON TABLE "public"."movimientos_stock" IS 'Historia del NIVEL de stock por variante. Append-only (no hay policy de UPDATE ni DELETE). La escribe un trigger sobre producto_variantes, asi que ningun camino puede saltearla. stock_nuevo es lo que hace computable un quiebre: sin nivel, un delta no dice si quedo en cero.';



COMMENT ON COLUMN "public"."movimientos_stock"."stock_nuevo" IS 'Stock DESPUES del movimiento, tomado del propio UPDATE. Es el dato que permite reconstruir desde cuando una variante esta en cero.';



COMMENT ON COLUMN "public"."movimientos_stock"."origen" IS 'Por que se movio. Viaja por la variable de transaccion comerz.origen_movimiento; DESCONOCIDO significa que nadie la declaro, no que haya sido un ajuste.';



CREATE TABLE IF NOT EXISTS "public"."negocios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "logo_url" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "plan_id" "uuid",
    "plan_vencimiento" timestamp with time zone,
    "estado" "text" DEFAULT 'activo'::"text" NOT NULL,
    "slug" "text" NOT NULL,
    "estado_cambiado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "modalidad" "text" DEFAULT 'mensual'::"text" NOT NULL,
    "rubro_comercial" "text",
    "tamano_equipo" "text",
    "reglas_override" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "modulo_presupuestos" boolean DEFAULT false NOT NULL,
    CONSTRAINT "negocios_estado_check" CHECK (("estado" = ANY (ARRAY['activo'::"text", 'prueba'::"text", 'demo'::"text", 'suspendido'::"text", 'cancelado'::"text"]))),
    CONSTRAINT "negocios_modalidad_check" CHECK (("modalidad" = ANY (ARRAY['mensual'::"text", 'semestral'::"text"]))),
    CONSTRAINT "negocios_slug_formato" CHECK ((("slug" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'::"text") AND (("char_length"("slug") >= 3) AND ("char_length"("slug") <= 30)))),
    CONSTRAINT "negocios_slug_no_reservado" CHECK (("slug" <> ALL (ARRAY['app'::"text", 'www'::"text", 'admin'::"text", 'api'::"text", 'mail'::"text", 'status'::"text", 'support'::"text", 'help'::"text", 'blog'::"text", 'docs'::"text", 'cdn'::"text", 'static'::"text", 'assets'::"text", 'auth'::"text", 'login'::"text"])))
);


ALTER TABLE "public"."negocios" OWNER TO "postgres";


COMMENT ON COLUMN "public"."negocios"."estado" IS 'activo (paga) | prueba (14 dias, todavia no pago) | demo (comercio de muestra de los vendedores: funciona entero pero queda afuera de metricas y cobranza) | suspendido (dejo de pagar) | cancelado (se fue). Espejo de ESTADOS_HABILITADOS en shared/lib/estado-negocio.ts.';



COMMENT ON COLUMN "public"."negocios"."estado_cambiado_en" IS 'Cuándo pasó a su estado actual. Sin esto el churn no se puede acotar a un período.';



COMMENT ON COLUMN "public"."negocios"."modalidad" IS 'mensual = precio de lista; semestral = 15% off. El precio efectivo se calcula, no se guarda.';



COMMENT ON COLUMN "public"."negocios"."rubro_comercial" IS 'Rubro comercial declarado en el alta (14 valores, ver shared/lib/rubros.ts). Segmentación, NO confundir con configuracion_pos.rubro, que es operativo y tiene 2 valores.';



COMMENT ON COLUMN "public"."negocios"."tamano_equipo" IS 'Cuánta gente trabaja en el comercio, declarado en el alta: solo_yo | 2_a_5 | 6_a_10 | mas_de_10.';



COMMENT ON COLUMN "public"."negocios"."reglas_override" IS 'Excepciones a las reglas del plan para ESTE negocio (grandfathering, acuerdos puntuales). Se mergea sobre planes.reglas; vacio = manda el plan. Ver reglas_negocio().';



COMMENT ON COLUMN "public"."negocios"."modulo_presupuestos" IS 'Si el negocio tiene el módulo de presupuestos y planes en cuotas. Lo prende SOLO el super admin (RLS de negocios). Con false no aparece en ninguna pantalla y las RPCs del módulo lanzan MODULO_NO_HABILITADO.';



COMMENT ON CONSTRAINT "negocios_slug_formato" ON "public"."negocios" IS 'El slug es una etiqueta de subdominio (LDH, 3-30). Espejo de shared/lib/slug-negocio.ts.';



COMMENT ON CONSTRAINT "negocios_slug_no_reservado" ON "public"."negocios" IS 'Hosts de la plataforma (app, www, api...) que ningún negocio puede tomar.';



CREATE TABLE IF NOT EXISTS "public"."onboarding_pasos_vistos" (
    "usuario_id" "uuid" NOT NULL,
    "paso" "text" NOT NULL,
    "visto_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."onboarding_pasos_vistos" OWNER TO "postgres";


COMMENT ON TABLE "public"."onboarding_pasos_vistos" IS 'Cuándo vio cada paso del alta la primera vez. Es el único escalón del embudo que no se deduce de auth.users. Ver 20260909140000.';



CREATE TABLE IF NOT EXISTS "public"."ordenes_borradores" (
    "orden_id" "uuid" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "payload" "jsonb" NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ordenes_borradores" OWNER TO "postgres";


COMMENT ON TABLE "public"."ordenes_borradores" IS 'Progreso sin confirmar de una conciliación de remito. Una fila por orden. Reemplaza al borrador en IndexedDB, que se perdía al cambiar de máquina o limpiar el navegador. Se borra sola cuando la orden se borra (FK on delete cascade) y la borra la app al aprobar.';



COMMENT ON COLUMN "public"."ordenes_borradores"."payload" IS 'Estado de la pantalla, opaco para la base. Nada del sistema lee adentro: lo definitivo vive en productos y ordenes_items.';



CREATE TABLE IF NOT EXISTS "public"."ordenes_compra" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "proveedor" "text" NOT NULL,
    "fecha_remito" "date",
    "total_presupuestado" numeric DEFAULT 0 NOT NULL,
    "estado" "text" DEFAULT 'PENDIENTE'::"text",
    "creado_en" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "aprobado_en" timestamp with time zone,
    "hash_planilla" "text"
);


ALTER TABLE "public"."ordenes_compra" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ordenes_compra"."aprobado_en" IS 'Cuando se impacto el remito en el stock. Distinto de creado_en: un remito se carga un dia y se concilia otro, y el movimiento de stock ocurre al aprobar. Para las ordenes anteriores a esta columna se sembro con creado_en, que es lo mas cercano que habia.';



COMMENT ON COLUMN "public"."ordenes_compra"."hash_planilla" IS 'Huella del contenido de la planilla propia que origino esta orden (sha256 de las filas parseadas, ver hash-import-productos.ts). Null en los remitos de proveedor, que se cargan a mano y no tienen archivo canonico. Evita que subir dos veces el mismo archivo cree dos ordenes y termine duplicando stock.';



CREATE TABLE IF NOT EXISTS "public"."ordenes_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "orden_id" "uuid",
    "raw_nombre" "text" NOT NULL,
    "raw_variante" "text" NOT NULL,
    "cantidad" numeric(12,3) DEFAULT 0 NOT NULL,
    "precio_costo" numeric DEFAULT 0 NOT NULL,
    "estado_match" "text" DEFAULT 'PENDIENTE'::"text",
    "producto_id" "uuid",
    "variante_match" "text",
    "raw_categoria" "text",
    "raw_sku" "text",
    "raw_marca" "text",
    "raw_categoria_id" "uuid",
    "raw_genero" "text",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "precio_venta_sugerido" numeric,
    "raw_imei" "text"
);


ALTER TABLE "public"."ordenes_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ordenes_items"."precio_venta_sugerido" IS 'Precio de venta al publico sugerido en la planilla del proveedor. Siembra precio_venta_actualizado en la conciliacion; NO es el precio final.';



COMMENT ON COLUMN "public"."ordenes_items"."raw_imei" IS 'IMEI o numero de serie de ESTA linea. Un aparato por fila: dos unidades iguales son dos filas. Lo usa aprobar_orden_compra para crear la fila en unidades_serie, igual que hace importar_productos_planilla.';



CREATE TABLE IF NOT EXISTS "public"."pagos_suscripcion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "monto" numeric(12,2) NOT NULL,
    "fecha_pago" "date" DEFAULT CURRENT_DATE NOT NULL,
    "periodo_desde" "date" NOT NULL,
    "periodo_hasta" "date" NOT NULL,
    "medio" "text" DEFAULT 'transferencia'::"text" NOT NULL,
    "plan_nombre" "text",
    "nota" "text",
    "registrado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pagos_suscripcion_check" CHECK (("periodo_hasta" > "periodo_desde")),
    CONSTRAINT "pagos_suscripcion_medio_check" CHECK (("medio" = ANY (ARRAY['transferencia'::"text", 'mercadopago'::"text", 'efectivo'::"text", 'otro'::"text"]))),
    CONSTRAINT "pagos_suscripcion_monto_check" CHECK (("monto" >= (0)::numeric))
);


ALTER TABLE "public"."pagos_suscripcion" OWNER TO "postgres";


COMMENT ON TABLE "public"."pagos_suscripcion" IS 'Cobros de suscripcion, cargados a mano desde /admincomerz. No hay pasarela: esta tabla es lo que de verdad se cobro, no lo que se espera cobrar. plan_nombre va congelado porque el plan del negocio puede cambiar despues.';



CREATE TABLE IF NOT EXISTS "public"."pedidos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "numero" integer NOT NULL,
    "dia" "date" NOT NULL,
    "estado" "text" DEFAULT 'POR_COBRAR'::"text" NOT NULL,
    "vendedor_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "cliente_id" "uuid",
    "items" "jsonb" NOT NULL,
    "total_estimado" numeric(14,2) DEFAULT 0 NOT NULL,
    "nota" "text",
    "cobrado_por" "uuid",
    "venta_id" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contexto" "jsonb",
    CONSTRAINT "pedidos_estado_check" CHECK (("estado" = ANY (ARRAY['POR_COBRAR'::"text", 'COBRADO'::"text", 'CANCELADO'::"text"]))),
    CONSTRAINT "pedidos_items_check" CHECK ((("jsonb_typeof"("items") = 'array'::"text") AND ("jsonb_array_length"("items") > 0)))
);


ALTER TABLE "public"."pedidos" OWNER TO "postgres";


COMMENT ON TABLE "public"."pedidos" IS 'Carrito armado en un punto de venta, pendiente de cobro en caja. NO es una venta: no toca stock ni caja. Se convierte en venta con registrar_venta desde la caja.';



COMMENT ON COLUMN "public"."pedidos"."contexto" IS 'Estado del paso de cobro tal como lo dejo la vendedora (cliente, medio de pago, promo, lista, factura/ticket, CC). Opaco: lo interpreta el POS.';



CREATE TABLE IF NOT EXISTS "public"."pedidos_numeracion" (
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "dia" "date" NOT NULL,
    "ultimo" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."pedidos_numeracion" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."perfiles" (
    "id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "email" "text" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."perfiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permisos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clave" "text" NOT NULL,
    "modulo" "text" NOT NULL,
    "descripcion" "text"
);


ALTER TABLE "public"."permisos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."planes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "precio_mensual" numeric(10,2) DEFAULT 0,
    "reglas" "jsonb" DEFAULT '{"features": ["caja", "stock"], "max_usuarios": 1, "max_sucursales": 1}'::"jsonb" NOT NULL,
    "activo" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "orden" integer DEFAULT 0 NOT NULL,
    "descripcion" "text",
    "link_suscripcion" "text"
);


ALTER TABLE "public"."planes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."planes"."link_suscripcion" IS 'Link de adhesion a la suscripcion de Mercado Pago para este plan. Lo usan los mails de cobro; null = ese plan no tiene link y el mail no se manda. Ver 20260910140000.';



CREATE TABLE IF NOT EXISTS "public"."producto_precios" (
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "lista_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "precio" numeric NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "producto_precios_precio_check" CHECK (("precio" > (0)::numeric))
);


ALTER TABLE "public"."producto_precios" OWNER TO "postgres";


COMMENT ON TABLE "public"."producto_precios" IS 'Precio FIJO de un producto en una lista. Solo excepciones a la regla de la lista: lo normal es que un comercio no tenga ninguna fila aca. El override REEMPLAZA la regla, no se le suma.';



COMMENT ON COLUMN "public"."producto_precios"."precio" IS 'Precio final por unidad para esta lista. Reemplaza la regla entera, incluido el precio propio de una variante.';



CREATE TABLE IF NOT EXISTS "public"."producto_presentaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "variante_id" "uuid",
    "nombre" "text" NOT NULL,
    "factor" numeric(12,3) NOT NULL,
    "regla_precio" "text" DEFAULT 'FIJO'::"text" NOT NULL,
    "precio" numeric,
    "costo" numeric,
    "sku" "text",
    "es_default" boolean DEFAULT false NOT NULL,
    "visible_catalogo" boolean DEFAULT true NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "orden" smallint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "producto_presentaciones_costo_no_negativo" CHECK ((("costo" IS NULL) OR ("costo" >= (0)::numeric))),
    CONSTRAINT "producto_presentaciones_factor_positivo" CHECK (("factor" > (0)::numeric)),
    CONSTRAINT "producto_presentaciones_nombre_no_vacio" CHECK (("length"(TRIM(BOTH FROM "nombre")) > 0)),
    CONSTRAINT "producto_presentaciones_precio_fijo" CHECK ((("regla_precio" <> 'FIJO'::"text") OR (("precio" IS NOT NULL) AND ("precio" > (0)::numeric)))),
    CONSTRAINT "producto_presentaciones_regla_precio_check" CHECK (("regla_precio" = ANY (ARRAY['FIJO'::"text", 'HEREDADO'::"text"])))
);


ALTER TABLE "public"."producto_presentaciones" OWNER TO "postgres";


COMMENT ON TABLE "public"."producto_presentaciones" IS 'Formas comerciales de vender el stock de un producto (Balde 4,7 kg, Pack x10). NO tiene stock: consume producto_variantes.stock según factor. La unidad base es la presentación implícita con factor 1 y no es una fila. variante_id null = aplica a todas las variantes. Ver 20260918120000.';



COMMENT ON COLUMN "public"."producto_presentaciones"."factor" IS 'Unidades de stock (productos.unidad_medida) que consume UNA presentación. Entero cuando la unidad no es fraccionable (trigger). NO deriva el precio.';



COMMENT ON COLUMN "public"."producto_presentaciones"."regla_precio" IS 'FIJO: se cobra `precio`. HEREDADO: precio base efectivo de la variante × factor, explícito y recalculado en cada venta. CHECK fail-closed.';



COMMENT ON COLUMN "public"."producto_presentaciones"."es_default" IS 'La que el POS elige al tocar el producto. Como mucho una activa por (producto, variante-o-null); sin default se vende la unidad base.';



CREATE TABLE IF NOT EXISTS "public"."producto_variante_valores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "variante_id" "uuid" NOT NULL,
    "atributo_id" "uuid" NOT NULL,
    "atributo_valor_id" "uuid" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."producto_variante_valores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."producto_variantes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "sku" "text",
    "nombre_display" "text" NOT NULL,
    "precio" numeric,
    "costo" numeric,
    "stock" numeric(12,3) DEFAULT 0 NOT NULL,
    "stock_minimo" numeric(12,3) DEFAULT 0 NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atributos" "jsonb" DEFAULT '{}'::"jsonb",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."producto_variantes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."producto_variantes"."stock" IS 'Stock en la unidad de medida del producto (productos.unidad_medida). numeric(12,3): 12.5 son 12,5 kg si el producto es KG. Quien acepta decimales lo decide el producto, no esta columna.';



CREATE TABLE IF NOT EXISTS "public"."producto_variantes_auditoria" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "variante_id_anterior" "uuid",
    "variante_id_nueva" "uuid",
    "atributos" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "nombre_display" "text",
    "accion" "text" NOT NULL,
    "stock_anterior" numeric(12,3),
    "stock_nuevo" numeric(12,3),
    "precio_anterior" numeric(12,2),
    "precio_nuevo" numeric(12,2),
    "costo_anterior" numeric(12,2),
    "costo_nuevo" numeric(12,2),
    "editado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    CONSTRAINT "producto_variantes_auditoria_accion_check" CHECK (("accion" = ANY (ARRAY['CREADA'::"text", 'ACTUALIZADA'::"text", 'ELIMINADA'::"text", 'BLOQUEADO_FALTANTE'::"text"])))
);


ALTER TABLE "public"."producto_variantes_auditoria" OWNER TO "postgres";


COMMENT ON COLUMN "public"."producto_variantes_auditoria"."accion" IS 'BLOQUEADO_FALTANTE: el freno de editarProductoAction impidió el guardado porque esta variante, que existía en base, no vino en el payload del cliente. stock_nuevo/precio_nuevo/costo_nuevo quedan NULL porque el guardado no se llegó a aplicar.';



CREATE TABLE IF NOT EXISTS "public"."productos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "tipo" "text" DEFAULT 'Interior'::"text",
    "precio" numeric DEFAULT 0 NOT NULL,
    "precio_costo" numeric DEFAULT 0 NOT NULL,
    "imagen_url" "text",
    "creado_en" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "publicado" boolean DEFAULT true,
    "slug" "text",
    "descripcion" "text",
    "categoria_id" "uuid",
    "atributos_globales" "jsonb" DEFAULT '{}'::"jsonb",
    "thumbnail_url" "text",
    "grid_url" "text",
    "marca" "text",
    "modelo" "text",
    "id_master" "uuid",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "tratamiento_iva" "text" DEFAULT 'GRAVADO_21'::"text" NOT NULL,
    "unidad_medida" "text" DEFAULT 'UNIDAD'::"text" NOT NULL,
    "genero" "text",
    "master_url" "text",
    "destacado_en" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "productos_tratamiento_iva_check" CHECK (("tratamiento_iva" = ANY (ARRAY['GRAVADO_21'::"text", 'GRAVADO_105'::"text", 'GRAVADO_27'::"text", 'EXENTO'::"text", 'NO_GRAVADO'::"text"]))),
    CONSTRAINT "productos_unidad_medida_check" CHECK (("unidad_medida" = ANY (ARRAY['UNIDAD'::"text", 'KG'::"text", 'GRAMO'::"text", 'LITRO'::"text", 'METRO'::"text", 'PAR'::"text"])))
);


ALTER TABLE "public"."productos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."productos"."id_master" IS 'catalogo_maestro.id_master del que se precargó este producto (T5). Referencia informativa, sin FK: el maestro vive en otro proyecto.';



COMMENT ON COLUMN "public"."productos"."tratamiento_iva" IS 'GRAVADO_21 | GRAVADO_105 | GRAVADO_27 | EXENTO | NO_GRAVADO. Un solo campo dice alicuota Y condicion: con dos campos separados existen combinaciones imposibles. El criterio vive en shared/lib/fiscal-producto.ts.';



COMMENT ON COLUMN "public"."productos"."unidad_medida" IS 'Unidad semantica de venta. El codigo de unidad de ARCA se traduce desde aca cuando se conecte la facturacion; a proposito no se guarda el numero.';



COMMENT ON COLUMN "public"."productos"."genero" IS 'Segmento del producto en indumentaria (Hombre, Mujer, Nino, Unisex). Libre y opcional: no hay una lista canonica que sirva para todos los rubros.';



COMMENT ON COLUMN "public"."productos"."master_url" IS 'JSON array de URLs de la copia de mayor calidad (1600px @0.9), alineado por índice con imagen_url. Fuente para regenerar derivadas; nunca se muestra en la UI. NULL = foto anterior a esta migración, no regenerable.';



COMMENT ON COLUMN "public"."productos"."destacado_en" IS 'Cuándo se marcó este producto como destacado de la portada del catálogo. null = no destacado. La portada muestra los 8 con la marca más reciente; el tope de 8 lo aplica la app (bulkToggleDestacadoAction), no la base.';



COMMENT ON COLUMN "public"."productos"."updated_at" IS 'Ultima modificacion de la fila, mantenida por el trigger trg_productos_updated_at. Backfilleada a creado_en en 20260902170000: antes de esa fecha no hay registro de modificaciones.';



CREATE OR REPLACE VIEW "public"."productos_precio_efectivo" WITH ("security_invoker"='on') AS
 SELECT "p"."id",
    "p"."negocio_id",
    "p"."nombre",
    "p"."tipo",
    "p"."publicado",
    "p"."precio",
    "p"."precio_costo",
        CASE
            WHEN (("v"."total" > 0) AND ("v"."con_precio" = "v"."total") AND ("v"."precios_distintos" = 1)) THEN "v"."precio_unico"
            ELSE "p"."precio"
        END AS "precio_efectivo",
        CASE
            WHEN (("v"."total" > 0) AND ("v"."con_costo" = "v"."total") AND ("v"."costos_distintos" = 1)) THEN "v"."costo_unico"
            ELSE "p"."precio_costo"
        END AS "costo_efectivo",
    COALESCE("v"."con_precio", (0)::bigint) AS "variantes_con_precio_propio",
    COALESCE("v"."total", (0)::bigint) AS "variantes_totales",
    ((COALESCE("v"."total", (0)::bigint) > 0) AND (("v"."precios_distintos" > 1) OR (("v"."con_precio" > 0) AND ("v"."con_precio" < "v"."total")))) AS "precios_dispares"
   FROM ("public"."productos" "p"
     LEFT JOIN LATERAL ( SELECT "count"(*) AS "total",
            "count"("pv"."precio") AS "con_precio",
            "count"(DISTINCT "pv"."precio") AS "precios_distintos",
            "min"("pv"."precio") AS "precio_unico",
            "count"("pv"."costo") AS "con_costo",
            "count"(DISTINCT "pv"."costo") AS "costos_distintos",
            "min"("pv"."costo") AS "costo_unico"
           FROM "public"."producto_variantes" "pv"
          WHERE ("pv"."producto_id" = "p"."id")) "v" ON (true));


ALTER VIEW "public"."productos_precio_efectivo" OWNER TO "postgres";


COMMENT ON VIEW "public"."productos_precio_efectivo" IS 'El precio que realmente se cobra de cada producto: el de sus variantes cuando todas coinciden, el de cabecera si no. `precios_dispares` avisa que no hay un precio único que mostrar. Solo lectura; la escribe nadie. Ver 20260908180000.';



CREATE TABLE IF NOT EXISTS "public"."productos_stock" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "producto_id" "uuid",
    "variante" "text" NOT NULL,
    "cantidad" numeric(12,3) DEFAULT 0 NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."productos_stock" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promociones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "descripcion" "text",
    "tipo_regla" "text",
    "tipo_descuento" "text" NOT NULL,
    "valor_descuento" numeric(12,2) NOT NULL,
    "monto_minimo" numeric(12,2) DEFAULT 0,
    "fecha_inicio" timestamp with time zone,
    "fecha_fin" timestamp with time zone,
    "limite_usos" integer,
    "usos_actuales" integer DEFAULT 0,
    "activa" boolean DEFAULT true NOT NULL,
    "acumulable" boolean DEFAULT false NOT NULL,
    "prioridad" integer DEFAULT 0 NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mostrar_en_catalogo" boolean DEFAULT false NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"()
);


ALTER TABLE "public"."promociones" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promociones_categorias" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promocion_id" "uuid" NOT NULL,
    "categoria_nombre" "text" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."promociones_categorias" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promociones_metodos_pago" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promocion_id" "uuid" NOT NULL,
    "metodo_pago" "text" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."promociones_metodos_pago" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promociones_productos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promocion_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."promociones_productos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cantidad" numeric(12,3) DEFAULT 1 NOT NULL,
    "precio_costo" numeric DEFAULT 0 NOT NULL,
    "fecha_venta" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "vendedor_id" "uuid",
    "metodo_pago" "text" DEFAULT 'EFECTIVO'::"text" NOT NULL,
    "total" numeric DEFAULT 0 NOT NULL,
    "total_bruto" numeric(12,2),
    "comision_total" numeric(12,2) DEFAULT 0,
    "total_neto" numeric(12,2),
    "es_pago_mixto" boolean DEFAULT false,
    "cliente_id" "uuid",
    "estado_pago" "text" DEFAULT 'PAGADA'::"text" NOT NULL,
    "monto_cobrado" numeric(12,2) DEFAULT 0 NOT NULL,
    "monto_pendiente" numeric(12,2) DEFAULT 0 NOT NULL,
    "turno_caja_id" "uuid",
    "estado_operacion" "text" DEFAULT 'CONFIRMADA'::"text" NOT NULL,
    "motivo_anulacion" "text",
    "fecha_vencimiento" "date",
    "recargo_metodo_total" numeric DEFAULT 0 NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "recargo_cc_porcentaje" numeric(5,2),
    "recargo_cc_monto" numeric(12,2),
    "registrada_offline" boolean DEFAULT false NOT NULL,
    "desfasaje_precio" numeric,
    "anulada_por" "uuid",
    "anulada_en" timestamp with time zone,
    "destino_mercaderia" "text",
    "motivo_codigo" "text",
    "motivo_detalle" "text",
    "monto_devuelto" numeric DEFAULT 0 NOT NULL,
    "base_devuelta" numeric DEFAULT 0 NOT NULL,
    "recargo_cc_devuelto" numeric DEFAULT 0 NOT NULL,
    "lista_precio_id" "uuid",
    "lista_precio_nombre" "text",
    "reintegro_metodo_id" "uuid",
    "reintegro_metodo_tipo" "text",
    "reintegro_metodo_nombre" "text",
    "saldo_a_favor_aplicado" numeric DEFAULT 0 NOT NULL,
    CONSTRAINT "ventas_destino_mercaderia_check" CHECK ((("destino_mercaderia" IS NULL) OR ("destino_mercaderia" = ANY (ARRAY['RESTAURAR_STOCK'::"text", 'BAJA'::"text"])))),
    CONSTRAINT "ventas_metodo_pago_check" CHECK (("metodo_pago" = ANY (ARRAY['EFECTIVO'::"text", 'TRANSFERENCIA'::"text", 'TARJETA'::"text", 'PAGO_MIXTO'::"text", 'CUENTA_CORRIENTE'::"text", 'SALDO_A_FAVOR'::"text"]))),
    CONSTRAINT "ventas_motivo_anulacion_check" CHECK (("motivo_anulacion" = ANY (ARRAY['RESTAURAR_STOCK'::"text", 'BAJA'::"text"]))),
    CONSTRAINT "ventas_motivo_codigo_check" CHECK ((("motivo_codigo" IS NULL) OR ("motivo_codigo" = ANY (ARRAY['ERROR_DE_CARGA'::"text", 'CAMBIO'::"text", 'ARREPENTIMIENTO'::"text", 'FALLADO'::"text", 'OTRO'::"text"])))),
    CONSTRAINT "ventas_saldo_a_favor_no_negativo" CHECK (("saldo_a_favor_aplicado" >= (0)::numeric))
);


ALTER TABLE "public"."ventas" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ventas"."cantidad" IS 'Cantidad vendida = suma de ventas_items.cantidad. UNIDADES, no renglones (ver 20260816170000). Con venta por peso mezcla magnitudes: 0,750 kg + 2 unidades = 2,750.';



COMMENT ON COLUMN "public"."ventas"."precio_costo" IS 'Costo TOTAL de la venta: suma de precio_costo * cantidad de cada renglon. NO es unitario - no multiplicarlo por ventas.cantidad.';



COMMENT ON COLUMN "public"."ventas"."motivo_anulacion" IS 'DEPRECADA: guarda el destino de la mercaderia (RESTAURAR_STOCK / BAJA), no un motivo. Se sigue escribiendo en paralelo para no romper el codigo desplegado. Leer destino_mercaderia.';



COMMENT ON COLUMN "public"."ventas"."recargo_metodo_total" IS 'Suma de los recargos por metodo de este ticket. Ya esta incluido en `total` y en `monto_cobrado`; se guarda aparte para poder descontarlo del margen de producto en reportes.';



COMMENT ON COLUMN "public"."ventas"."recargo_cc_porcentaje" IS 'Porcentaje de recargo por cuenta corriente aplicado a ESTA venta, congelado. null = no determinable (ventas anteriores a 20260823140000); 0 = se fio sin recargo.';



COMMENT ON COLUMN "public"."ventas"."recargo_cc_monto" IS 'Monto del recargo por cuenta corriente incluido en ventas.total. Se calcula sobre el subtotal con descuento, ANTES del recargo por metodo de pago.';



COMMENT ON COLUMN "public"."ventas"."registrada_offline" IS 'La venta se cobró sin conexión y se sincronizó después. Su precio NO fue revalidado contra la base: ver desfasaje_precio.';



COMMENT ON COLUMN "public"."ventas"."desfasaje_precio" IS 'Solo en ventas offline: total cobrado menos total recalculado con los precios vigentes al sincronizar. 0 = el precio no cambió. null = no aplica.';



COMMENT ON COLUMN "public"."ventas"."anulada_por" IS 'Quien anulo la venta. Null en las anulaciones anteriores a esta columna que no dejaron egreso del que reconstruirlo.';



COMMENT ON COLUMN "public"."ventas"."anulada_en" IS 'Cuando se anulo. Backfilleado desde egresos.fecha donde existia: ese egreso lo inserta la misma transaccion que la anulacion, asi que es el momento exacto, no una estimacion.';



COMMENT ON COLUMN "public"."ventas"."destino_mercaderia" IS 'A donde fue la mercaderia devuelta: RESTAURAR_STOCK o BAJA. Es lo que hasta ahora guardaba motivo_anulacion.';



COMMENT ON COLUMN "public"."ventas"."motivo_codigo" IS 'POR QUE se anulo, que es otra pregunta que a donde fue la mercaderia. Lista cerrada, ver features/sales/lib/motivo-anulacion.ts.';



COMMENT ON COLUMN "public"."ventas"."monto_devuelto" IS 'Cuanto de esta venta se devolvio, con el recargo prorrateado incluido. La venta sigue CONFIRMADA: el ingreso neto es total - monto_devuelto. Ver 20260903160000.';



COMMENT ON COLUMN "public"."ventas"."base_devuelta" IS 'De monto_devuelto, cuanto es mercaderia (sin el recargo prorrateado). Los reportes restan esto de los ingresos y la diferencia del recargo cobrado. Ver 20260903170000.';



COMMENT ON COLUMN "public"."ventas"."recargo_cc_devuelto" IS 'De monto_devuelto, cuanto es recargo de cuenta corriente perdonado. monto_devuelto = base_devuelta + recargo_cc_devuelto, porque el recargo por metodo nunca se devuelve.';



COMMENT ON COLUMN "public"."ventas"."lista_precio_id" IS 'Lista con la que se cobro esta venta, congelada por registrar_venta. SIN FK a proposito: el historial sobrevive a que la lista se borre. NULL = precio base, o venta anterior a las listas de precios.';



COMMENT ON COLUMN "public"."ventas"."lista_precio_nombre" IS 'El nombre que tenia la lista al momento de la venta, congelado. La lista se puede renombrar; el ticket ya emitido no.';



COMMENT ON COLUMN "public"."ventas"."reintegro_metodo_tipo" IS 'Medio por el que se le devolvio la plata al cliente al ANULAR. null = no se eligio: volvio por el medio del cobro (todas las filas anteriores al 20/9/2026). Congelado, sin FK.';



COMMENT ON COLUMN "public"."ventas"."saldo_a_favor_aplicado" IS 'Parte del ticket pagada con saldo a favor del cliente. NO está en monto_cobrado (esa plata entró antes) ni en venta_pagos. 0 = no se usó; las ventas anteriores a la columna tampoco lo usaron, porque no existía.';



CREATE OR REPLACE VIEW "public"."reintegros_al_cliente" WITH ("security_invoker"='true') AS
 SELECT "d"."negocio_id",
    "d"."venta_id",
    'DEVOLUCION'::"text" AS "origen",
    "d"."creado_en" AS "fecha",
    "d"."reintegro_metodo_id" AS "metodo_id",
    COALESCE("d"."reintegro_metodo_tipo", "d"."metodo_tipo") AS "metodo_tipo",
    COALESCE("d"."reintegro_metodo_nombre", "d"."metodo_nombre") AS "metodo_nombre",
    "d"."base_devuelta" AS "monto"
   FROM "public"."devoluciones" "d"
  WHERE ((COALESCE("d"."reintegro_metodo_tipo", "d"."metodo_tipo") <> ALL (ARRAY['CUENTA_CORRIENTE'::"text", 'SALDO_A_FAVOR'::"text"])) AND ("d"."base_devuelta" > (0)::numeric))
UNION ALL
 SELECT "v"."negocio_id",
    "v"."id" AS "venta_id",
    'ANULACION'::"text" AS "origen",
    "v"."anulada_en" AS "fecha",
    "v"."reintegro_metodo_id" AS "metodo_id",
    "v"."reintegro_metodo_tipo" AS "metodo_tipo",
    "v"."reintegro_metodo_nombre" AS "metodo_nombre",
    ( SELECT COALESCE("sum"("vp"."monto_base"), (0)::numeric) AS "coalesce"
           FROM "public"."venta_pagos" "vp"
          WHERE (("vp"."venta_id" = "v"."id") AND ("vp"."negocio_id" = "v"."negocio_id") AND ("vp"."tipo_movimiento" = 'PAGO_VENTA'::"text"))) AS "monto"
   FROM "public"."ventas" "v"
  WHERE (("v"."estado_operacion" = 'ANULADA'::"text") AND ("v"."reintegro_metodo_id" IS NOT NULL))
UNION ALL
 SELECT "v"."negocio_id",
    "v"."id" AS "venta_id",
    'ANULACION'::"text" AS "origen",
    "v"."anulada_en" AS "fecha",
    "vp"."metodo_pago_id" AS "metodo_id",
    "vp"."metodo_tipo",
    "vp"."metodo_nombre",
    "vp"."monto_base" AS "monto"
   FROM ("public"."ventas" "v"
     JOIN "public"."venta_pagos" "vp" ON ((("vp"."venta_id" = "v"."id") AND ("vp"."negocio_id" = "v"."negocio_id") AND ("vp"."tipo_movimiento" = 'PAGO_VENTA'::"text"))))
  WHERE (("v"."estado_operacion" = 'ANULADA'::"text") AND ("v"."reintegro_metodo_id" IS NULL) AND ("v"."reintegro_metodo_tipo" IS DISTINCT FROM 'SALDO_A_FAVOR'::"text"));


ALTER VIEW "public"."reintegros_al_cliente" OWNER TO "postgres";


COMMENT ON VIEW "public"."reintegros_al_cliente" IS 'Plata que se le devolvió al cliente y por qué medio (anulaciones y devoluciones parciales). NO incluye los reintegros a cuenta (SALDO_A_FAVOR, 20260928240000): un vale no es plata que sale, y esta vista alimenta neto_caja y los reintegros digitales de posicion_dinero.';



CREATE TABLE IF NOT EXISTS "public"."reservas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "variante_id" "uuid" NOT NULL,
    "cliente_id" "uuid" NOT NULL,
    "venta_id" "uuid",
    "nota" "text",
    "estado" "text" DEFAULT 'ACTIVA'::"text" NOT NULL,
    "creado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resuelto_en" timestamp with time zone,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    CONSTRAINT "reservas_estado_check" CHECK (("estado" = ANY (ARRAY['ACTIVA'::"text", 'CONFIRMADA'::"text", 'DEVUELTA'::"text"])))
);


ALTER TABLE "public"."reservas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rol_permisos" (
    "rol_id" "uuid" NOT NULL,
    "permiso_id" "uuid" NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."rol_permisos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nombre" "text" NOT NULL,
    "es_sistema" boolean DEFAULT false NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"()
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slugs_historicos" (
    "slug" "text" NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."slugs_historicos" OWNER TO "postgres";


COMMENT ON TABLE "public"."slugs_historicos" IS 'Slugs que un negocio tuvo antes. Los catalogos se comparten por WhatsApp y quedan en chats y estados durante meses: sin esto, cambiar el link mata toda venta que venga de un link viejo.';



CREATE TABLE IF NOT EXISTS "public"."solicitudes_plan" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "plan_actual" "text",
    "plan_solicitado_id" "uuid",
    "plan_solicitado_nombre" "text" NOT NULL,
    "modalidad" "text" DEFAULT 'mensual'::"text" NOT NULL,
    "nota" "text",
    "estado" "text" DEFAULT 'PENDIENTE'::"text" NOT NULL,
    "solicitado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resuelto_en" timestamp with time zone,
    "resuelto_por" "uuid",
    CONSTRAINT "solicitudes_plan_estado_check" CHECK (("estado" = ANY (ARRAY['PENDIENTE'::"text", 'APLICADA'::"text", 'RECHAZADA'::"text"])))
);


ALTER TABLE "public"."solicitudes_plan" OWNER TO "postgres";


COMMENT ON TABLE "public"."solicitudes_plan" IS 'Pedidos de cambio de plan hechos por el comercio desde Perfil > Suscripcion. El cambio lo aplica a mano el super admin desde /admincomerz: NO cambia el plan por si sola, porque el plan se cambia cuando el pago esta acordado.';



COMMENT ON COLUMN "public"."solicitudes_plan"."plan_actual" IS 'Nombre del plan al momento de pedir, congelado. Si despues cambia, la solicitud tiene que seguir diciendo desde donde se pidio.';



CREATE TABLE IF NOT EXISTS "public"."transferencias_financieras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "cuenta_origen_id" "uuid" NOT NULL,
    "cuenta_destino_id" "uuid" NOT NULL,
    "monto" numeric NOT NULL,
    "concepto" "text" NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "registrado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revierte_a" "uuid",
    CONSTRAINT "transferencias_cuentas_distintas" CHECK (("cuenta_origen_id" <> "cuenta_destino_id")),
    CONSTRAINT "transferencias_financieras_concepto_check" CHECK (("length"("btrim"("concepto")) > 0)),
    CONSTRAINT "transferencias_financieras_monto_check" CHECK (("monto" > (0)::numeric))
);


ALTER TABLE "public"."transferencias_financieras" OWNER TO "postgres";


COMMENT ON TABLE "public"."transferencias_financieras" IS 'Cabecera inmutable de pases entre fondos propios. Sus dos movimientos financieros suman cero y su impacto_resultado es cero.';



COMMENT ON COLUMN "public"."transferencias_financieras"."revierte_a" IS 'Si esta transferencia es la reversa de otra, la original. Única por original; una reversa no se revierte.';



CREATE TABLE IF NOT EXISTS "public"."turnos_caja" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vendedor_id" "uuid" NOT NULL,
    "fecha_apertura" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "fecha_cierre" timestamp with time zone,
    "monto_inicial" numeric DEFAULT 0 NOT NULL,
    "monto_final" numeric,
    "estado" "text" DEFAULT 'ABIERTO'::"text" NOT NULL,
    "observaciones" "text",
    "efectivo_esperado" numeric,
    "modo" "text" DEFAULT 'UNICA'::"text" NOT NULL,
    "usuario_id" "uuid",
    "punto_venta_id" "uuid",
    "monto_declarado" numeric(12,2),
    "diferencia" numeric(12,2),
    "abierta_por" "uuid",
    "cerrada_por" "uuid",
    "observacion_apertura" "text",
    "observacion_cierre" "text",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "cuenta_financiera_id" "uuid" NOT NULL,
    CONSTRAINT "turnos_caja_estado_check" CHECK (("estado" = ANY (ARRAY['ABIERTO'::"text", 'CERRADO'::"text"])))
);


ALTER TABLE "public"."turnos_caja" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."unidades_serie" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"(),
    "producto_variante_id" "uuid" NOT NULL,
    "imei" "text" NOT NULL,
    "estado" "text" DEFAULT 'disponible'::"text" NOT NULL,
    "fecha_ingreso" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha_venta" timestamp with time zone,
    "venta_id" "uuid",
    CONSTRAINT "unidades_serie_estado_check" CHECK (("estado" = ANY (ARRAY['disponible'::"text", 'vendido'::"text", 'baja'::"text"]))),
    CONSTRAINT "unidades_serie_estado_fecha_coherente" CHECK (((("estado" = 'vendido'::"text") AND ("fecha_venta" IS NOT NULL)) OR (("estado" = 'disponible'::"text") AND ("fecha_venta" IS NULL)) OR ("estado" = 'baja'::"text"))),
    CONSTRAINT "unidades_serie_imei_check" CHECK (("length"(TRIM(BOTH FROM "imei")) > 0))
);


ALTER TABLE "public"."unidades_serie" OWNER TO "postgres";


COMMENT ON TABLE "public"."unidades_serie" IS 'Unidades fisicas serializadas (IMEI / numero de serie) de productos de electro. Registro de trazabilidad y garantia por aparato. La fuente de verdad del stock sigue siendo producto_variantes.stock hasta que se cablee la venta.';



COMMENT ON COLUMN "public"."unidades_serie"."negocio_id" IS 'Reservado para multi-tenant (ROADMAP TIER 2). NULL y sin FK en el modelo por-proyecto actual.';



COMMENT ON COLUMN "public"."unidades_serie"."venta_id" IS 'Venta en la que salio la unidad. Sin FK dura: la trazabilidad debe sobrevivir a la desaparicion de la venta.';



CREATE TABLE IF NOT EXISTS "public"."usuarios_negocios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "rol_id" "uuid" NOT NULL,
    "rol" "text" DEFAULT 'VENDEDOR'::"text" NOT NULL,
    "es_owner" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usuarios_negocios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usuarios_prueba" (
    "usuario_id" "uuid" NOT NULL,
    "motivo" "text",
    "marcado_por" "uuid",
    "creado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."usuarios_prueba" OWNER TO "postgres";


COMMENT ON TABLE "public"."usuarios_prueba" IS 'Cuentas creadas probando el flujo de alta. Salen del denominador del embudo (embudo_de_alta) sin desaparecer de la lista. Ver 20260909130000.';



COMMENT ON COLUMN "public"."usuarios_prueba"."usuario_id" IS 'auth.users.id. SIN FK: la marca sobrevive a que la cuenta de prueba se borre.';



CREATE TABLE IF NOT EXISTS "public"."variantes_fusionadas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" NOT NULL,
    "producto_id" "uuid" NOT NULL,
    "clave" "text" NOT NULL,
    "variante_id_eliminada" "uuid" NOT NULL,
    "variante_id_sobrevive" "uuid" NOT NULL,
    "fila_eliminada" "jsonb" NOT NULL,
    "stock_antes_sobrevive" numeric(12,3) NOT NULL,
    "stock_despues" numeric(12,3) NOT NULL,
    "fusionado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."variantes_fusionadas" OWNER TO "postgres";


COMMENT ON TABLE "public"."variantes_fusionadas" IS 'Variantes que compartian identidad (atributos_comparables) dentro de un producto y se unificaron en 20260902100000, paso previo al upsert de guardar_variantes_producto. Guarda la fila eliminada entera para poder revertir.';



CREATE TABLE IF NOT EXISTS "public"."variantes_remapeo" (
    "variante_id_viejo" "uuid" NOT NULL,
    "variante_id_nuevo" "uuid" NOT NULL,
    "saltos" integer NOT NULL,
    "resuelto_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."variantes_remapeo" OWNER TO "postgres";


COMMENT ON TABLE "public"."variantes_remapeo" IS 'Mapa viejo->nuevo de UUID de variante, reconstruido desde producto_variantes_auditoria en 20260902130000. La cadena dejo de crecer con el upsert de 20260902110000, asi que esta tabla es la unica copia.';



CREATE TABLE IF NOT EXISTS "public"."variantes_remapeo_aplicado" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tabla" "text" NOT NULL,
    "fila_id" "uuid" NOT NULL,
    "variante_id_viejo" "uuid" NOT NULL,
    "variante_id_nuevo" "uuid" NOT NULL,
    "aplicado_en" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."variantes_remapeo_aplicado" OWNER TO "postgres";


COMMENT ON TABLE "public"."variantes_remapeo_aplicado" IS 'Filas concretas repuntadas por 20260902130000, con el id que tenian antes. Existe para que el rollback sea exacto: una de las tablas es ventas_items.';



CREATE TABLE IF NOT EXISTS "public"."ventas_correcciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "venta_id" "uuid" NOT NULL,
    "campo" "text" NOT NULL,
    "valor_anterior" "jsonb" NOT NULL,
    "valor_nuevo" "jsonb" NOT NULL,
    "motivo" "text",
    "corregido_por" "uuid",
    "corregido_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ventas_correcciones_campo_check" CHECK (("campo" = 'METODO_PAGO'::"text"))
);


ALTER TABLE "public"."ventas_correcciones" OWNER TO "postgres";


COMMENT ON TABLE "public"."ventas_correcciones" IS 'Auditoria de correcciones sobre ventas ya registradas: que campo, con que valor antes y despues, quien y cuando. Append-only por RLS. Ver 20260903130000.';



COMMENT ON COLUMN "public"."ventas_correcciones"."valor_anterior" IS 'Snapshot congelado, no una referencia: la correccion tiene que poder leerse aunque el metodo de pago involucrado se borre o se renombre.';



CREATE TABLE IF NOT EXISTS "public"."ventas_descuentos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venta_id" "uuid" NOT NULL,
    "promocion_id" "uuid",
    "promocion_nombre" "text" NOT NULL,
    "tipo_descuento" "text" NOT NULL,
    "monto_descontado" numeric(12,2) NOT NULL,
    "aplicado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL
);


ALTER TABLE "public"."ventas_descuentos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ventas_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "venta_id" "uuid" NOT NULL,
    "producto_id" "uuid",
    "variante" "text" NOT NULL,
    "cantidad" numeric(12,3) NOT NULL,
    "precio_unitario" numeric NOT NULL,
    "precio_costo" numeric DEFAULT 0 NOT NULL,
    "descuento_monto" numeric(12,2) DEFAULT 0,
    "precio_final" numeric(12,2),
    "promocion_id" "uuid",
    "promocion_nombre" "text",
    "unidad_serie_id" "uuid",
    "negocio_id" "uuid" DEFAULT "security"."current_negocio_id"() NOT NULL,
    "variante_id" "uuid",
    "cantidad_devuelta" numeric DEFAULT 0 NOT NULL,
    "es_venta_libre" boolean DEFAULT false NOT NULL,
    "presentacion_id" "uuid",
    "presentacion_nombre" "text",
    "factor" numeric(12,3) DEFAULT 1 NOT NULL,
    "cantidad_presentacion" numeric(12,3),
    "precio_presentacion" numeric(12,2),
    CONSTRAINT "ventas_items_cantidad_devuelta_check" CHECK ((("cantidad_devuelta" >= (0)::numeric) AND ("cantidad_devuelta" <= "cantidad"))),
    CONSTRAINT "ventas_items_factor_positivo" CHECK (("factor" > (0)::numeric)),
    CONSTRAINT "ventas_items_presentacion_coherente" CHECK (((("presentacion_id" IS NULL) AND ("cantidad_presentacion" IS NULL) AND ("factor" = (1)::numeric)) OR (("presentacion_id" IS NOT NULL) AND ("cantidad_presentacion" IS NOT NULL) AND ("cantidad_presentacion" > (0)::numeric) AND ("cantidad" = "public"."cantidad_base"("cantidad_presentacion", "factor"))))),
    CONSTRAINT "ventas_items_serie_sin_presentacion" CHECK ((("unidad_serie_id" IS NULL) OR ("presentacion_id" IS NULL))),
    CONSTRAINT "ventas_items_venta_libre_sin_catalogo" CHECK (((NOT "es_venta_libre") OR (("producto_id" IS NULL) AND ("variante_id" IS NULL))))
);


ALTER TABLE "public"."ventas_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ventas_items"."cantidad" IS 'UNIDAD BASE (productos.unidad_medida), siempre. Con presentación es cantidad_presentacion × factor. Es la columna que leen reportes, devoluciones y anulaciones.';



COMMENT ON COLUMN "public"."ventas_items"."unidad_serie_id" IS 'Unidad fisica (IMEI/serie) que salio en esta linea. NULL para productos no serializados.';



COMMENT ON COLUMN "public"."ventas_items"."variante_id" IS 'Variante vendida. Es por aca que la anulacion devuelve el stock (RPC ajustar_stock_variante), no por el texto de `variante`. Sin FK a proposito: el historial de ventas sobrevive a que la variante se borre del catalogo. NULL en los renglones viejos que ya no matchean por nombre y en los productos legacy sin producto_variantes.';



COMMENT ON COLUMN "public"."ventas_items"."cantidad_devuelta" IS 'Unidades ya devueltas de este renglon. Se valida dentro del UPDATE de registrar_devolucion: es el guard de concurrencia, no un cache.';



COMMENT ON COLUMN "public"."ventas_items"."es_venta_libre" IS 'true = renglón cobrado sin producto del catálogo (venta libre): producto_id y variante_id van null y la descripción tipeada vive en `variante`. NO confundir con producto_id null por producto borrado, que es es_venta_libre = false.';



COMMENT ON COLUMN "public"."ventas_items"."presentacion_id" IS 'Presentación vendida, sin FK (el historial sobrevive a que se borre). null = unidad base.';



COMMENT ON COLUMN "public"."ventas_items"."factor" IS 'Factor CONGELADO al vender. Si el balde pasa de 4,7 a 5 kg, esta venta sigue diciendo 4,7. 1 sin presentación.';



COMMENT ON COLUMN "public"."ventas_items"."cantidad_presentacion" IS 'Cuántas presentaciones se vendieron (entero). null sin presentación.';



COMMENT ON COLUMN "public"."ventas_items"."precio_presentacion" IS 'Lo cobrado por UNA presentación, exacto. precio_unitario/precio_final siguen siendo por unidad base (derivados: precio_presentacion / factor).';



CREATE TABLE IF NOT EXISTS "respaldos"."atributo_2_estilo_bonito" (
    "id" bigint NOT NULL,
    "tomado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" "text" NOT NULL,
    "fila" "jsonb" NOT NULL
);


ALTER TABLE "respaldos"."atributo_2_estilo_bonito" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "respaldos"."atributo_2_estilo_bonito_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "respaldos"."atributo_2_estilo_bonito_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "respaldos"."atributo_2_estilo_bonito_id_seq" OWNED BY "respaldos"."atributo_2_estilo_bonito"."id";



CREATE TABLE IF NOT EXISTS "respaldos"."genero_en_variantes" (
    "id" bigint NOT NULL,
    "tomado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" "text" NOT NULL,
    "fila" "jsonb" NOT NULL
);


ALTER TABLE "respaldos"."genero_en_variantes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "respaldos"."genero_en_variantes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "respaldos"."genero_en_variantes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "respaldos"."genero_en_variantes_id_seq" OWNED BY "respaldos"."genero_en_variantes"."id";



CREATE TABLE IF NOT EXISTS "respaldos"."marca_variante_estilo_bonito" (
    "id" bigint NOT NULL,
    "tomado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" "text" NOT NULL,
    "fila" "jsonb" NOT NULL
);


ALTER TABLE "respaldos"."marca_variante_estilo_bonito" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "respaldos"."marca_variante_estilo_bonito_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "respaldos"."marca_variante_estilo_bonito_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "respaldos"."marca_variante_estilo_bonito_id_seq" OWNED BY "respaldos"."marca_variante_estilo_bonito"."id";



CREATE TABLE IF NOT EXISTS "respaldos"."marcas_estilo_bonito" (
    "id" bigint NOT NULL,
    "tomado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fila" "jsonb" NOT NULL
);


ALTER TABLE "respaldos"."marcas_estilo_bonito" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "respaldos"."marcas_estilo_bonito_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "respaldos"."marcas_estilo_bonito_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "respaldos"."marcas_estilo_bonito_id_seq" OWNED BY "respaldos"."marcas_estilo_bonito"."id";



CREATE TABLE IF NOT EXISTS "respaldos"."split_marca_estilo_bonito" (
    "id" bigint NOT NULL,
    "tomado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" "text" NOT NULL,
    "fila" "jsonb" NOT NULL
);


ALTER TABLE "respaldos"."split_marca_estilo_bonito" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "respaldos"."split_marca_estilo_bonito_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "respaldos"."split_marca_estilo_bonito_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "respaldos"."split_marca_estilo_bonito_id_seq" OWNED BY "respaldos"."split_marca_estilo_bonito"."id";



CREATE TABLE IF NOT EXISTS "respaldos"."unificacion_variantes_genero" (
    "id" bigint NOT NULL,
    "tomado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tipo" "text" NOT NULL,
    "fila" "jsonb" NOT NULL
);


ALTER TABLE "respaldos"."unificacion_variantes_genero" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "respaldos"."unificacion_variantes_genero_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "respaldos"."unificacion_variantes_genero_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "respaldos"."unificacion_variantes_genero_id_seq" OWNED BY "respaldos"."unificacion_variantes_genero"."id";



ALTER TABLE ONLY "respaldos"."atributo_2_estilo_bonito" ALTER COLUMN "id" SET DEFAULT "nextval"('"respaldos"."atributo_2_estilo_bonito_id_seq"'::"regclass");



ALTER TABLE ONLY "respaldos"."genero_en_variantes" ALTER COLUMN "id" SET DEFAULT "nextval"('"respaldos"."genero_en_variantes_id_seq"'::"regclass");



ALTER TABLE ONLY "respaldos"."marca_variante_estilo_bonito" ALTER COLUMN "id" SET DEFAULT "nextval"('"respaldos"."marca_variante_estilo_bonito_id_seq"'::"regclass");



ALTER TABLE ONLY "respaldos"."marcas_estilo_bonito" ALTER COLUMN "id" SET DEFAULT "nextval"('"respaldos"."marcas_estilo_bonito_id_seq"'::"regclass");



ALTER TABLE ONLY "respaldos"."split_marca_estilo_bonito" ALTER COLUMN "id" SET DEFAULT "nextval"('"respaldos"."split_marca_estilo_bonito_id_seq"'::"regclass");



ALTER TABLE ONLY "respaldos"."unificacion_variantes_genero" ALTER COLUMN "id" SET DEFAULT "nextval"('"respaldos"."unificacion_variantes_genero_id_seq"'::"regclass");



ALTER TABLE ONLY "archivo"."solicitudes_comercio"
    ADD CONSTRAINT "solicitudes_comercio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."acreditaciones_financieras"
    ADD CONSTRAINT "acreditaciones_financieras_negocio_id_id_key" UNIQUE ("negocio_id", "id");



ALTER TABLE ONLY "public"."acreditaciones_financieras_pagos"
    ADD CONSTRAINT "acreditaciones_financieras_pagos_negocio_id_venta_pago_id_key" UNIQUE ("negocio_id", "venta_pago_id");



ALTER TABLE ONLY "public"."acreditaciones_financieras_pagos"
    ADD CONSTRAINT "acreditaciones_financieras_pagos_pkey" PRIMARY KEY ("acreditacion_id", "venta_pago_id");



ALTER TABLE ONLY "public"."acreditaciones_financieras"
    ADD CONSTRAINT "acreditaciones_financieras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."actualizaciones_precio_items"
    ADD CONSTRAINT "actualizaciones_precio_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."actualizaciones_precio"
    ADD CONSTRAINT "actualizaciones_precio_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."alertas_caja_revisadas"
    ADD CONSTRAINT "alertas_caja_revisadas_pkey" PRIMARY KEY ("negocio_id", "clave");



ALTER TABLE ONLY "public"."arca_credenciales"
    ADD CONSTRAINT "arca_credenciales_pkey" PRIMARY KEY ("negocio_id", "ambiente");



ALTER TABLE ONLY "public"."atributo_valores"
    ADD CONSTRAINT "atributo_valores_atributo_id_slug_key" UNIQUE ("atributo_id", "slug");



ALTER TABLE ONLY "public"."atributo_valores"
    ADD CONSTRAINT "atributo_valores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."atributos"
    ADD CONSTRAINT "atributos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."backfill_variante_id_20260903"
    ADD CONSTRAINT "backfill_variante_id_20260903_pkey" PRIMARY KEY ("venta_item_id");



ALTER TABLE ONLY "public"."bajas"
    ADD CONSTRAINT "bajas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."catalogo_borrados"
    ADD CONSTRAINT "catalogo_borrados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categoria_atributos"
    ADD CONSTRAINT "categoria_atributos_categoria_id_atributo_id_key" UNIQUE ("categoria_id", "atributo_id");



ALTER TABLE ONLY "public"."categoria_atributos"
    ADD CONSTRAINT "categoria_atributos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categorias_egreso"
    ADD CONSTRAINT "categorias_egreso_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cobros_cc_correcciones"
    ADD CONSTRAINT "cobros_cc_correcciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comprobante_numeracion"
    ADD CONSTRAINT "comprobante_numeracion_pkey" PRIMARY KEY ("negocio_id", "punto_venta", "tipo");



ALTER TABLE ONLY "public"."comprobantes_iva"
    ADD CONSTRAINT "comprobantes_iva_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comprobantes"
    ADD CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configuracion_pos"
    ADD CONSTRAINT "configuracion_pos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gastos_comerz"
    ADD CONSTRAINT "costos_infra_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuenta_corriente_movimientos"
    ADD CONSTRAINT "cuenta_corriente_movimientos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cuentas_financieras"
    ADD CONSTRAINT "cuentas_financieras_negocio_codigo_key" UNIQUE ("negocio_id", "codigo");



ALTER TABLE ONLY "public"."cuentas_financieras"
    ADD CONSTRAINT "cuentas_financieras_negocio_id_id_key" UNIQUE ("negocio_id", "id");



ALTER TABLE ONLY "public"."cuentas_financieras"
    ADD CONSTRAINT "cuentas_financieras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devoluciones_items"
    ADD CONSTRAINT "devoluciones_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."devoluciones"
    ADD CONSTRAINT "devoluciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."diccionario_alias"
    ADD CONSTRAINT "diccionario_alias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."egresos"
    ADD CONSTRAINT "egresos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."egresos_programados"
    ADD CONSTRAINT "egresos_programados_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_bajas"
    ADD CONSTRAINT "email_bajas_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."envios_email"
    ADD CONSTRAINT "envios_email_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eventos_comerz"
    ADD CONSTRAINT "eventos_comerz_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eventos_uso"
    ADD CONSTRAINT "eventos_uso_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."importaciones_productos"
    ADD CONSTRAINT "importaciones_productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ingresos_financieros"
    ADD CONSTRAINT "ingresos_financieros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."listas_precios"
    ADD CONSTRAINT "listas_precios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."metodos_pago"
    ADD CONSTRAINT "metodos_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movimientos_financieros"
    ADD CONSTRAINT "movimientos_financieros_evento_id_key" UNIQUE ("evento_id");



ALTER TABLE ONLY "public"."movimientos_financieros"
    ADD CONSTRAINT "movimientos_financieros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movimientos_stock"
    ADD CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."negocios"
    ADD CONSTRAINT "negocios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."onboarding_pasos_vistos"
    ADD CONSTRAINT "onboarding_pasos_vistos_pkey" PRIMARY KEY ("usuario_id", "paso");



ALTER TABLE ONLY "public"."ordenes_borradores"
    ADD CONSTRAINT "ordenes_borradores_pkey" PRIMARY KEY ("orden_id");



ALTER TABLE ONLY "public"."ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ordenes_items"
    ADD CONSTRAINT "ordenes_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pagos_suscripcion"
    ADD CONSTRAINT "pagos_suscripcion_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedidos_numeracion"
    ADD CONSTRAINT "pedidos_numeracion_pkey" PRIMARY KEY ("negocio_id", "dia");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."perfiles"
    ADD CONSTRAINT "perfiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permisos"
    ADD CONSTRAINT "permisos_clave_key" UNIQUE ("clave");



ALTER TABLE ONLY "public"."permisos"
    ADD CONSTRAINT "permisos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."planes"
    ADD CONSTRAINT "planes_nombre_key" UNIQUE ("nombre");



ALTER TABLE ONLY "public"."planes"
    ADD CONSTRAINT "planes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_precios"
    ADD CONSTRAINT "producto_precios_pkey" PRIMARY KEY ("lista_id", "producto_id");



ALTER TABLE ONLY "public"."producto_presentaciones"
    ADD CONSTRAINT "producto_presentaciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_variante_valores"
    ADD CONSTRAINT "producto_variante_valores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_variante_valores"
    ADD CONSTRAINT "producto_variante_valores_variante_id_atributo_id_key" UNIQUE ("variante_id", "atributo_id");



ALTER TABLE ONLY "public"."producto_variantes_auditoria"
    ADD CONSTRAINT "producto_variantes_auditoria_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producto_variantes"
    ADD CONSTRAINT "producto_variantes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."productos_stock"
    ADD CONSTRAINT "productos_stock_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."productos_stock"
    ADD CONSTRAINT "productos_stock_producto_id_variante_key" UNIQUE ("producto_id", "variante");



ALTER TABLE ONLY "public"."promociones_categorias"
    ADD CONSTRAINT "promociones_categorias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promociones_metodos_pago"
    ADD CONSTRAINT "promociones_metodos_pago_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promociones"
    ADD CONSTRAINT "promociones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promociones_productos"
    ADD CONSTRAINT "promociones_productos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reservas"
    ADD CONSTRAINT "reservas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rol_permisos"
    ADD CONSTRAINT "rol_permisos_pkey" PRIMARY KEY ("rol_id", "permiso_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_id_negocio_id_key" UNIQUE ("id", "negocio_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slugs_historicos"
    ADD CONSTRAINT "slugs_historicos_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."solicitudes_plan"
    ADD CONSTRAINT "solicitudes_plan_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transferencias_financieras"
    ADD CONSTRAINT "transferencias_financieras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."turnos_caja"
    ADD CONSTRAINT "turnos_caja_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."unidades_serie"
    ADD CONSTRAINT "unidades_serie_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios_negocios"
    ADD CONSTRAINT "usuarios_negocios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usuarios_negocios"
    ADD CONSTRAINT "usuarios_negocios_unico" UNIQUE ("usuario_id", "negocio_id");



ALTER TABLE ONLY "public"."usuarios_prueba"
    ADD CONSTRAINT "usuarios_prueba_pkey" PRIMARY KEY ("usuario_id");



ALTER TABLE ONLY "public"."variantes_fusionadas"
    ADD CONSTRAINT "variantes_fusionadas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."variantes_remapeo_aplicado"
    ADD CONSTRAINT "variantes_remapeo_aplicado_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."variantes_remapeo"
    ADD CONSTRAINT "variantes_remapeo_pkey" PRIMARY KEY ("variante_id_viejo");



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_negocio_id_id_key" UNIQUE ("negocio_id", "id");



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_correcciones"
    ADD CONSTRAINT "ventas_correcciones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_descuentos"
    ADD CONSTRAINT "ventas_descuentos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas_items"
    ADD CONSTRAINT "ventas_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "respaldos"."atributo_2_estilo_bonito"
    ADD CONSTRAINT "atributo_2_estilo_bonito_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "respaldos"."genero_en_variantes"
    ADD CONSTRAINT "genero_en_variantes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "respaldos"."marca_variante_estilo_bonito"
    ADD CONSTRAINT "marca_variante_estilo_bonito_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "respaldos"."marcas_estilo_bonito"
    ADD CONSTRAINT "marcas_estilo_bonito_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "respaldos"."split_marca_estilo_bonito"
    ADD CONSTRAINT "split_marca_estilo_bonito_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "respaldos"."unificacion_variantes_genero"
    ADD CONSTRAINT "unificacion_variantes_genero_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_solicitudes_comercio_estado" ON "archivo"."solicitudes_comercio" USING "btree" ("estado", "creado_en" DESC);



CREATE INDEX "acreditaciones_financieras_fecha_idx" ON "public"."acreditaciones_financieras" USING "btree" ("negocio_id", "fecha_acreditacion" DESC);



CREATE UNIQUE INDEX "atributos_negocio_slug_key" ON "public"."atributos" USING "btree" ("negocio_id", "slug");



CREATE UNIQUE INDEX "categorias_egreso_negocio_nombre_key" ON "public"."categorias_egreso" USING "btree" ("negocio_id", "lower"("btrim"("nombre")));



CREATE INDEX "categorias_egreso_negocio_orden_idx" ON "public"."categorias_egreso" USING "btree" ("negocio_id", "activa", "orden", "nombre");



CREATE UNIQUE INDEX "categorias_negocio_slug_root_key" ON "public"."categorias" USING "btree" ("negocio_id", "slug") WHERE ("parent_id" IS NULL);



CREATE UNIQUE INDEX "categorias_slug_child_key" ON "public"."categorias" USING "btree" ("parent_id", "slug") WHERE ("parent_id" IS NOT NULL);



CREATE UNIQUE INDEX "clientes_negocio_cuit_unico_idx" ON "public"."clientes" USING "btree" ("negocio_id", "cuit") WHERE (("cuit" IS NOT NULL) AND ("cuit" <> ''::"text"));



CREATE UNIQUE INDEX "clientes_negocio_dni_unico_idx" ON "public"."clientes" USING "btree" ("negocio_id", "dni") WHERE (("dni" IS NOT NULL) AND ("dni" <> ''::"text"));



CREATE UNIQUE INDEX "clientes_resumen_token_key" ON "public"."clientes" USING "btree" ("resumen_token") WHERE ("resumen_token" IS NOT NULL);



CREATE INDEX "comprobantes_iva_comprobante_idx" ON "public"."comprobantes_iva" USING "btree" ("comprobante_id");



CREATE INDEX "comprobantes_negocio_emitido_idx" ON "public"."comprobantes" USING "btree" ("negocio_id", "emitido_en" DESC);



CREATE UNIQUE INDEX "comprobantes_numeracion_unica_idx" ON "public"."comprobantes" USING "btree" ("negocio_id", "punto_venta", "tipo", "numero", COALESCE("arca_ambiente", ''::"text"));



CREATE INDEX "comprobantes_venta_idx" ON "public"."comprobantes" USING "btree" ("venta_id");



CREATE INDEX "cuenta_corriente_movimientos_cliente_fecha_idx" ON "public"."cuenta_corriente_movimientos" USING "btree" ("cliente_id", "creado_en" DESC);



CREATE INDEX "cuentas_financieras_activas_idx" ON "public"."cuentas_financieras" USING "btree" ("negocio_id", "tipo", "nombre") WHERE "activa";



CREATE UNIQUE INDEX "diccionario_alias_negocio_proveedor_raw_key" ON "public"."diccionario_alias" USING "btree" ("negocio_id", "proveedor", "raw_nombre");



CREATE INDEX "egresos_cuenta_origen_idx" ON "public"."egresos" USING "btree" ("negocio_id", "cuenta_origen_id", "fecha" DESC);



CREATE INDEX "egresos_negocio_categoria_idx" ON "public"."egresos" USING "btree" ("negocio_id", "categoria_id") WHERE ("categoria_id" IS NOT NULL);



CREATE INDEX "egresos_negocio_tipo_fecha_idx" ON "public"."egresos" USING "btree" ("negocio_id", "tipo", "fecha" DESC);



CREATE INDEX "idx_actualizaciones_precio_items_negocio_id" ON "public"."actualizaciones_precio_items" USING "btree" ("negocio_id");



CREATE INDEX "idx_actualizaciones_precio_items_variante_id" ON "public"."actualizaciones_precio_items" USING "btree" ("variante_id");



CREATE INDEX "idx_actualizaciones_precio_negocio_id" ON "public"."actualizaciones_precio" USING "btree" ("negocio_id");



CREATE INDEX "idx_atributo_valores_negocio_id" ON "public"."atributo_valores" USING "btree" ("negocio_id");



CREATE INDEX "idx_atributos_negocio_id" ON "public"."atributos" USING "btree" ("negocio_id");



CREATE INDEX "idx_bajas_negocio_id" ON "public"."bajas" USING "btree" ("negocio_id");



CREATE INDEX "idx_catalogo_borrados_feed" ON "public"."catalogo_borrados" USING "btree" ("negocio_id", "borrado_en", "id");



CREATE INDEX "idx_categoria_atributos_negocio_id" ON "public"."categoria_atributos" USING "btree" ("negocio_id");



CREATE INDEX "idx_categorias_delta" ON "public"."categorias" USING "btree" ("negocio_id", "updated_at");



CREATE INDEX "idx_categorias_negocio_id" ON "public"."categorias" USING "btree" ("negocio_id");



CREATE INDEX "idx_cc_mov_debito_origen" ON "public"."cuenta_corriente_movimientos" USING "btree" ("debito_origen_id") WHERE ("debito_origen_id" IS NOT NULL);



CREATE INDEX "idx_clientes_lista_precio" ON "public"."clientes" USING "btree" ("negocio_id", "lista_precio_id") WHERE ("lista_precio_id" IS NOT NULL);



CREATE INDEX "idx_clientes_negocio_id" ON "public"."clientes" USING "btree" ("negocio_id");



CREATE INDEX "idx_cobros_cc_correcciones_pago" ON "public"."cobros_cc_correcciones" USING "btree" ("negocio_id", "pago_id", "corregido_en");



CREATE INDEX "idx_configuracion_pos_negocio_id" ON "public"."configuracion_pos" USING "btree" ("negocio_id");



CREATE INDEX "idx_costos_infra_mes" ON "public"."gastos_comerz" USING "btree" ("mes" DESC);



CREATE INDEX "idx_cuenta_corriente_movimientos_negocio_id" ON "public"."cuenta_corriente_movimientos" USING "btree" ("negocio_id");



CREATE INDEX "idx_devoluciones_items_devolucion" ON "public"."devoluciones_items" USING "btree" ("devolucion_id");



CREATE INDEX "idx_devoluciones_venta" ON "public"."devoluciones" USING "btree" ("negocio_id", "venta_id", "creado_en");



CREATE INDEX "idx_diccionario_alias_negocio_id" ON "public"."diccionario_alias" USING "btree" ("negocio_id");



CREATE INDEX "idx_egresos_negocio_id" ON "public"."egresos" USING "btree" ("negocio_id");



CREATE INDEX "idx_egresos_programados_categoria" ON "public"."egresos_programados" USING "btree" ("categoria_id") WHERE ("categoria_id" IS NOT NULL);



CREATE INDEX "idx_egresos_programados_negocio_fecha" ON "public"."egresos_programados" USING "btree" ("negocio_id", "proxima_fecha") WHERE "activo";



CREATE INDEX "idx_egresos_turno_caja_id" ON "public"."egresos" USING "btree" ("turno_caja_id");



CREATE UNIQUE INDEX "idx_envios_email_campana_unica" ON "public"."envios_email" USING "btree" ("usuario_id", "campana") WHERE (NOT "forzado");



CREATE INDEX "idx_envios_email_usuario" ON "public"."envios_email" USING "btree" ("usuario_id", "creado_en" DESC);



CREATE INDEX "idx_eventos_comerz_feed" ON "public"."eventos_comerz" USING "btree" ("creado_en" DESC);



CREATE INDEX "idx_eventos_comerz_sin_ver" ON "public"."eventos_comerz" USING "btree" ("creado_en" DESC) WHERE ("visto_en" IS NULL);



CREATE INDEX "idx_eventos_uso_negocio_tipo_fecha" ON "public"."eventos_uso" USING "btree" ("negocio_id", "tipo", "creado_en" DESC);



CREATE INDEX "idx_gastos_comerz_mes" ON "public"."gastos_comerz" USING "btree" ("mes");



CREATE INDEX "idx_importaciones_productos_negocio_fecha" ON "public"."importaciones_productos" USING "btree" ("negocio_id", "creado_en" DESC);



CREATE INDEX "idx_invitaciones_negocio" ON "public"."invitaciones" USING "btree" ("negocio_id");



CREATE INDEX "idx_metodos_pago_negocio_id" ON "public"."metodos_pago" USING "btree" ("negocio_id");



CREATE INDEX "idx_movimientos_stock_feed" ON "public"."movimientos_stock" USING "btree" ("negocio_id", "creado_en" DESC);



CREATE INDEX "idx_movimientos_stock_referencia" ON "public"."movimientos_stock" USING "btree" ("negocio_id", "referencia_id") WHERE ("referencia_id" IS NOT NULL);



CREATE INDEX "idx_movimientos_stock_variante" ON "public"."movimientos_stock" USING "btree" ("negocio_id", "variante_id", "creado_en" DESC);



CREATE INDEX "idx_ordenes_compra_aprobado_en" ON "public"."ordenes_compra" USING "btree" ("aprobado_en" DESC) WHERE ("estado" = 'APROBADA'::"text");



CREATE INDEX "idx_ordenes_compra_negocio_id" ON "public"."ordenes_compra" USING "btree" ("negocio_id");



CREATE INDEX "idx_ordenes_items_negocio_id" ON "public"."ordenes_items" USING "btree" ("negocio_id");



CREATE INDEX "idx_ordenes_items_orden_id" ON "public"."ordenes_items" USING "btree" ("orden_id");



CREATE INDEX "idx_pagos_suscripcion_negocio" ON "public"."pagos_suscripcion" USING "btree" ("negocio_id", "fecha_pago" DESC);



CREATE INDEX "idx_producto_precios_negocio_producto" ON "public"."producto_precios" USING "btree" ("negocio_id", "producto_id");



CREATE INDEX "idx_producto_presentaciones_negocio_producto" ON "public"."producto_presentaciones" USING "btree" ("negocio_id", "producto_id");



CREATE INDEX "idx_producto_variante_valores_negocio_id" ON "public"."producto_variante_valores" USING "btree" ("negocio_id");



CREATE INDEX "idx_producto_variantes_auditoria_negocio_id" ON "public"."producto_variantes_auditoria" USING "btree" ("negocio_id");



CREATE INDEX "idx_producto_variantes_auditoria_producto_id" ON "public"."producto_variantes_auditoria" USING "btree" ("producto_id", "creado_en" DESC);



CREATE INDEX "idx_producto_variantes_delta" ON "public"."producto_variantes" USING "btree" ("negocio_id", "updated_at");



CREATE INDEX "idx_producto_variantes_negocio_id" ON "public"."producto_variantes" USING "btree" ("negocio_id");



CREATE INDEX "idx_producto_variantes_producto_id" ON "public"."producto_variantes" USING "btree" ("producto_id");



CREATE INDEX "idx_productos_atributos" ON "public"."productos" USING "gin" ("atributos_globales");



CREATE INDEX "idx_productos_delta" ON "public"."productos" USING "btree" ("negocio_id", "updated_at");



COMMENT ON INDEX "public"."idx_productos_delta" IS 'Sostiene la consulta de delta del catalogo: "que cambio desde tal momento" en este negocio. Ver 20260903120000.';



CREATE INDEX "idx_productos_id_master" ON "public"."productos" USING "btree" ("id_master") WHERE ("id_master" IS NOT NULL);



CREATE INDEX "idx_productos_negocio_id" ON "public"."productos" USING "btree" ("negocio_id");



CREATE INDEX "idx_productos_nombre_trgm" ON "public"."productos" USING "gin" ("public"."unaccent_immutable"("lower"("nombre")) "extensions"."gin_trgm_ops") WHERE ("publicado" = true);



CREATE INDEX "idx_productos_stock_negocio_id" ON "public"."productos_stock" USING "btree" ("negocio_id");



CREATE INDEX "idx_promociones_categorias_negocio_id" ON "public"."promociones_categorias" USING "btree" ("negocio_id");



CREATE INDEX "idx_promociones_metodos_pago_negocio_id" ON "public"."promociones_metodos_pago" USING "btree" ("negocio_id");



CREATE INDEX "idx_promociones_negocio_id" ON "public"."promociones" USING "btree" ("negocio_id");



CREATE INDEX "idx_promociones_productos_negocio_id" ON "public"."promociones_productos" USING "btree" ("negocio_id");



CREATE INDEX "idx_reservas_negocio_id" ON "public"."reservas" USING "btree" ("negocio_id");



CREATE INDEX "idx_rol_permisos_negocio_id" ON "public"."rol_permisos" USING "btree" ("negocio_id");



CREATE INDEX "idx_roles_negocio_id" ON "public"."roles" USING "btree" ("negocio_id");



CREATE INDEX "idx_slugs_historicos_negocio" ON "public"."slugs_historicos" USING "btree" ("negocio_id");



CREATE INDEX "idx_solicitudes_plan_pendientes" ON "public"."solicitudes_plan" USING "btree" ("estado", "creado_en" DESC) WHERE ("estado" = 'PENDIENTE'::"text");



CREATE INDEX "idx_turnos_caja_negocio_id" ON "public"."turnos_caja" USING "btree" ("negocio_id");



CREATE INDEX "idx_unidades_serie_negocio_id" ON "public"."unidades_serie" USING "btree" ("negocio_id");



CREATE INDEX "idx_unidades_serie_variante_disponible" ON "public"."unidades_serie" USING "btree" ("producto_variante_id") WHERE ("estado" = 'disponible'::"text");



CREATE INDEX "idx_unidades_serie_venta" ON "public"."unidades_serie" USING "btree" ("venta_id") WHERE ("venta_id" IS NOT NULL);



CREATE INDEX "idx_usuarios_negocios_negocio" ON "public"."usuarios_negocios" USING "btree" ("negocio_id");



CREATE INDEX "idx_usuarios_negocios_usuario" ON "public"."usuarios_negocios" USING "btree" ("usuario_id");



CREATE UNIQUE INDEX "idx_variante_identidad" ON "public"."producto_variantes" USING "btree" ("negocio_id", "producto_id", "public"."atributos_comparables"("atributos"));



COMMENT ON INDEX "public"."idx_variante_identidad" IS 'La identidad de una variante: sus atributos normalizados, dentro de su producto. Es lo que permite que guardar_variantes_producto haga UPSERT en vez de borrar y reinsertar (20260902110000). Si se toca atributos_comparables(), hay que hacer REINDEX.';



CREATE INDEX "idx_variantes_atributos" ON "public"."producto_variantes" USING "gin" ("atributos");



CREATE INDEX "idx_venta_pagos_negocio_id" ON "public"."venta_pagos" USING "btree" ("negocio_id");



CREATE INDEX "idx_ventas_correcciones_venta" ON "public"."ventas_correcciones" USING "btree" ("negocio_id", "venta_id", "corregido_en");



CREATE INDEX "idx_ventas_descuentos_negocio_id" ON "public"."ventas_descuentos" USING "btree" ("negocio_id");



CREATE INDEX "idx_ventas_items_negocio_id" ON "public"."ventas_items" USING "btree" ("negocio_id");



CREATE INDEX "idx_ventas_items_unidad_serie" ON "public"."ventas_items" USING "btree" ("unidad_serie_id") WHERE ("unidad_serie_id" IS NOT NULL);



CREATE INDEX "idx_ventas_negocio_id" ON "public"."ventas" USING "btree" ("negocio_id");



CREATE UNIQUE INDEX "importaciones_productos_negocio_hash_key" ON "public"."importaciones_productos" USING "btree" ("negocio_id", "hash") WHERE (NOT "forzada");



CREATE INDEX "ingresos_financieros_fecha_idx" ON "public"."ingresos_financieros" USING "btree" ("negocio_id", "fecha" DESC);



CREATE INDEX "ingresos_financieros_turno_idx" ON "public"."ingresos_financieros" USING "btree" ("negocio_id", "turno_caja_id") WHERE ("turno_caja_id" IS NOT NULL);



CREATE UNIQUE INDEX "invitaciones_pendiente_unica" ON "public"."invitaciones" USING "btree" ("negocio_id", "lower"("email")) WHERE ("estado" = 'PENDIENTE'::"text");



CREATE INDEX "metodos_pago_cuenta_destino_idx" ON "public"."metodos_pago" USING "btree" ("negocio_id", "cuenta_destino_id");



CREATE INDEX "movimientos_financieros_cuenta_fecha_idx" ON "public"."movimientos_financieros" USING "btree" ("negocio_id", "cuenta_financiera_id", "fecha_movimiento" DESC, "id" DESC);



CREATE INDEX "movimientos_financieros_operacion_idx" ON "public"."movimientos_financieros" USING "btree" ("operacion_id", "id");



CREATE INDEX "movimientos_financieros_origen_idx" ON "public"."movimientos_financieros" USING "btree" ("negocio_id", "origen_tipo", "origen_id", "registrado_en", "id");



CREATE INDEX "movimientos_financieros_turno_idx" ON "public"."movimientos_financieros" USING "btree" ("negocio_id", "turno_caja_id") WHERE ("turno_caja_id" IS NOT NULL);



CREATE UNIQUE INDEX "negocios_nombre_key" ON "public"."negocios" USING "btree" ("nombre");



CREATE INDEX "negocios_slug_activo_idx" ON "public"."negocios" USING "btree" ("slug") WHERE ("estado" = 'activo'::"text");



CREATE UNIQUE INDEX "negocios_slug_key" ON "public"."negocios" USING "btree" ("slug");



CREATE UNIQUE INDEX "pedidos_numero_dia_idx" ON "public"."pedidos" USING "btree" ("negocio_id", "dia", "numero");



CREATE INDEX "pedidos_por_cobrar_idx" ON "public"."pedidos" USING "btree" ("negocio_id", "estado", "creado_en" DESC);



CREATE INDEX "producto_variantes_negocio_sku_idx" ON "public"."producto_variantes" USING "btree" ("negocio_id", "sku") WHERE (("sku" IS NOT NULL) AND ("sku" <> ''::"text"));



CREATE INDEX "productos_destacados_idx" ON "public"."productos" USING "btree" ("negocio_id", "destacado_en" DESC) WHERE ("destacado_en" IS NOT NULL);



CREATE UNIQUE INDEX "productos_negocio_slug_key" ON "public"."productos" USING "btree" ("negocio_id", "slug");



CREATE INDEX "productos_negocio_tratamiento_iva_idx" ON "public"."productos" USING "btree" ("negocio_id", "tratamiento_iva");



CREATE INDEX "reservas_cliente_id_idx" ON "public"."reservas" USING "btree" ("cliente_id");



CREATE INDEX "reservas_variante_activa_idx" ON "public"."reservas" USING "btree" ("variante_id") WHERE ("estado" = 'ACTIVA'::"text");



CREATE UNIQUE INDEX "roles_negocio_nombre_key" ON "public"."roles" USING "btree" ("negocio_id", "nombre");



CREATE INDEX "transferencias_financieras_fecha_idx" ON "public"."transferencias_financieras" USING "btree" ("negocio_id", "fecha" DESC);



CREATE UNIQUE INDEX "transferencias_financieras_revierte_a_key" ON "public"."transferencias_financieras" USING "btree" ("revierte_a") WHERE ("revierte_a" IS NOT NULL);



CREATE INDEX "turnos_caja_cuenta_financiera_idx" ON "public"."turnos_caja" USING "btree" ("negocio_id", "cuenta_financiera_id");



CREATE UNIQUE INDEX "turnos_caja_negocio_vendedor_abierto_unico" ON "public"."turnos_caja" USING "btree" ("negocio_id", "vendedor_id") WHERE ("estado" = 'ABIERTO'::"text");



CREATE UNIQUE INDEX "unidades_serie_negocio_imei_key" ON "public"."unidades_serie" USING "btree" ("negocio_id", "imei");



CREATE UNIQUE INDEX "uq_costos_infra_mes_proveedor" ON "public"."gastos_comerz" USING "btree" ("mes", "concepto");



CREATE UNIQUE INDEX "uq_listas_precios_nombre" ON "public"."listas_precios" USING "btree" ("negocio_id", "lower"(TRIM(BOTH FROM "nombre")));



CREATE UNIQUE INDEX "uq_ordenes_compra_hash_planilla" ON "public"."ordenes_compra" USING "btree" ("negocio_id", "hash_planilla") WHERE ("hash_planilla" IS NOT NULL);



CREATE UNIQUE INDEX "uq_producto_presentaciones_default" ON "public"."producto_presentaciones" USING "btree" ("producto_id", COALESCE("variante_id", '00000000-0000-0000-0000-000000000000'::"uuid")) WHERE ("es_default" AND "activa");



CREATE UNIQUE INDEX "uq_producto_presentaciones_nombre" ON "public"."producto_presentaciones" USING "btree" ("producto_id", COALESCE("variante_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "lower"(TRIM(BOTH FROM "nombre")));



CREATE UNIQUE INDEX "uq_producto_presentaciones_sku" ON "public"."producto_presentaciones" USING "btree" ("negocio_id", "sku") WHERE (("sku" IS NOT NULL) AND ("sku" <> ''::"text"));



CREATE UNIQUE INDEX "uq_solicitud_plan_pendiente_por_negocio" ON "public"."solicitudes_plan" USING "btree" ("negocio_id") WHERE ("estado" = 'PENDIENTE'::"text");



CREATE UNIQUE INDEX "usuarios_negocios_un_owner" ON "public"."usuarios_negocios" USING "btree" ("negocio_id") WHERE "es_owner";



CREATE INDEX "venta_pagos_cuenta_destino_idx" ON "public"."venta_pagos" USING "btree" ("negocio_id", "cuenta_destino_id", "creado_en" DESC);



CREATE INDEX "venta_pagos_turno_idx" ON "public"."venta_pagos" USING "btree" ("turno_caja_id") WHERE ("turno_caja_id" IS NOT NULL);



CREATE INDEX "venta_pagos_venta_idx" ON "public"."venta_pagos" USING "btree" ("venta_id");



CREATE INDEX "ventas_cliente_idx" ON "public"."ventas" USING "btree" ("cliente_id") WHERE ("cliente_id" IS NOT NULL);



CREATE INDEX "ventas_descuentos_venta_idx" ON "public"."ventas_descuentos" USING "btree" ("venta_id");



CREATE INDEX "ventas_items_variante_idx" ON "public"."ventas_items" USING "btree" ("variante_id") WHERE ("variante_id" IS NOT NULL);



CREATE INDEX "ventas_items_venta_idx" ON "public"."ventas_items" USING "btree" ("venta_id");



CREATE INDEX "ventas_negocio_fecha_idx" ON "public"."ventas" USING "btree" ("negocio_id", "fecha_venta" DESC);



CREATE INDEX "ventas_turno_idx" ON "public"."ventas" USING "btree" ("turno_caja_id") WHERE ("turno_caja_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "egresos_programados_updated_at" BEFORE UPDATE ON "public"."egresos_programados" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atributo_valores_updated_at" BEFORE UPDATE ON "public"."atributo_valores" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_atributos_updated_at" BEFORE UPDATE ON "public"."atributos" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_bloquear_edicion_turno_cerrado" BEFORE UPDATE ON "public"."turnos_caja" FOR EACH ROW EXECUTE FUNCTION "public"."bloquear_edicion_turno_cerrado"();



CREATE OR REPLACE TRIGGER "trg_categorias_borrado" AFTER DELETE ON "public"."categorias" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_borrado_catalogo"();



CREATE OR REPLACE TRIGGER "trg_categorias_egreso_updated_at" BEFORE UPDATE ON "public"."categorias_egreso" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_categorias_updated_at" BEFORE UPDATE ON "public"."categorias" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cuentas_financieras_updated_at" BEFORE UPDATE ON "public"."cuentas_financieras" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_egresos_asignar_cuenta" BEFORE INSERT ON "public"."egresos" FOR EACH ROW EXECUTE FUNCTION "public"."asignar_cuenta_financiera_actual"();



CREATE OR REPLACE TRIGGER "trg_egresos_bitacora_financiera" AFTER INSERT OR DELETE OR UPDATE ON "public"."egresos" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_bitacora_egreso"();



CREATE OR REPLACE TRIGGER "trg_egresos_solo_descriptivo_editable" BEFORE UPDATE ON "public"."egresos" FOR EACH ROW EXECUTE FUNCTION "public"."egresos_solo_descriptivo_editable"();



CREATE OR REPLACE TRIGGER "trg_egresos_validar_cuenta_origen" BEFORE INSERT OR UPDATE OF "cuenta_origen_id", "negocio_id" ON "public"."egresos" FOR EACH ROW EXECUTE FUNCTION "public"."validar_cuenta_origen_egreso"();



CREATE OR REPLACE TRIGGER "trg_egresos_validar_turno" BEFORE INSERT ON "public"."egresos" FOR EACH ROW EXECUTE FUNCTION "public"."validar_turno_egreso_arqueado"();



CREATE OR REPLACE TRIGGER "trg_evento_negocio" AFTER INSERT OR UPDATE ON "public"."negocios" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_evento_negocio"();



CREATE OR REPLACE TRIGGER "trg_evento_pago" AFTER INSERT ON "public"."pagos_suscripcion" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_evento_pago"();



CREATE OR REPLACE TRIGGER "trg_evento_solicitud_plan" AFTER INSERT ON "public"."solicitudes_plan" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_evento_solicitud_plan"();



CREATE OR REPLACE TRIGGER "trg_limite_cc_manual" BEFORE INSERT ON "public"."cuenta_corriente_movimientos" FOR EACH ROW EXECUTE FUNCTION "public"."validar_limite_cc_manual"();



CREATE OR REPLACE TRIGGER "trg_limite_invitaciones" BEFORE INSERT ON "public"."invitaciones" FOR EACH ROW EXECUTE FUNCTION "public"."validar_limite_usuarios"();



CREATE OR REPLACE TRIGGER "trg_limite_productos" BEFORE INSERT ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."validar_limite_productos"();



CREATE OR REPLACE TRIGGER "trg_limite_usuarios" BEFORE INSERT ON "public"."usuarios_negocios" FOR EACH ROW EXECUTE FUNCTION "public"."validar_limite_usuarios"();



CREATE OR REPLACE TRIGGER "trg_listas_precios_updated_at" BEFORE UPDATE ON "public"."listas_precios" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_marcar_aprobacion_orden" BEFORE UPDATE ON "public"."ordenes_compra" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_aprobacion_orden"();



CREATE OR REPLACE TRIGGER "trg_metodos_pago_asignar_cuenta" BEFORE INSERT OR UPDATE OF "tipo", "cuenta_destino_id" ON "public"."metodos_pago" FOR EACH ROW EXECUTE FUNCTION "public"."asignar_cuenta_financiera_actual"();



CREATE OR REPLACE TRIGGER "trg_movimiento_stock" AFTER INSERT OR DELETE OR UPDATE ON "public"."producto_variantes" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_movimiento_stock"();



CREATE OR REPLACE TRIGGER "trg_movimientos_financieros_inmutable" BEFORE DELETE OR UPDATE ON "public"."movimientos_financieros" FOR EACH ROW EXECUTE FUNCTION "public"."impedir_mutacion_movimiento_financiero"();



CREATE OR REPLACE TRIGGER "trg_movimientos_financieros_saldo_caja" BEFORE INSERT ON "public"."movimientos_financieros" FOR EACH ROW EXECUTE FUNCTION "public"."validar_saldo_caja_arqueada"();



CREATE OR REPLACE TRIGGER "trg_negocios_estado_cambiado" BEFORE UPDATE ON "public"."negocios" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_cambio_de_estado"();



CREATE OR REPLACE TRIGGER "trg_negocios_sembrar_categorias_egreso" AFTER INSERT ON "public"."negocios" FOR EACH ROW EXECUTE FUNCTION "public"."sembrar_categorias_egreso_nuevo_negocio"();



CREATE OR REPLACE TRIGGER "trg_negocios_sembrar_cuentas_financieras" AFTER INSERT ON "public"."negocios" FOR EACH ROW EXECUTE FUNCTION "public"."sembrar_cuentas_financieras_nuevo_negocio"();



CREATE OR REPLACE TRIGGER "trg_pedidos_broadcast" AFTER INSERT OR DELETE OR UPDATE ON "public"."pedidos" FOR EACH ROW EXECUTE FUNCTION "public"."pedidos_broadcast_cambio"();



CREATE OR REPLACE TRIGGER "trg_producto_precios_updated_at" BEFORE UPDATE ON "public"."producto_precios" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_producto_presentaciones_tocar_producto" AFTER INSERT OR DELETE OR UPDATE ON "public"."producto_presentaciones" FOR EACH ROW EXECUTE FUNCTION "public"."producto_presentaciones_tocar_producto"();



CREATE OR REPLACE TRIGGER "trg_producto_presentaciones_updated_at" BEFORE UPDATE ON "public"."producto_presentaciones" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_producto_presentaciones_validar" BEFORE INSERT OR UPDATE ON "public"."producto_presentaciones" FOR EACH ROW EXECUTE FUNCTION "public"."producto_presentaciones_validar"();



CREATE OR REPLACE TRIGGER "trg_producto_variantes_borrado" AFTER DELETE ON "public"."producto_variantes" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_borrado_catalogo"();



CREATE OR REPLACE TRIGGER "trg_producto_variantes_updated_at" BEFORE UPDATE ON "public"."producto_variantes" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_productos_borrado" AFTER DELETE ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_borrado_catalogo"();



CREATE OR REPLACE TRIGGER "trg_productos_updated_at" BEFORE UPDATE ON "public"."productos" FOR EACH ROW EXECUTE FUNCTION "public"."marcar_updated_at"();



CREATE OR REPLACE TRIGGER "trg_transferencias_inmutables" BEFORE DELETE OR UPDATE ON "public"."transferencias_financieras" FOR EACH ROW EXECUTE FUNCTION "public"."impedir_mutacion_movimiento_financiero"();



CREATE OR REPLACE TRIGGER "trg_turnos_caja_asignar_cuenta" BEFORE INSERT ON "public"."turnos_caja" FOR EACH ROW EXECUTE FUNCTION "public"."asignar_cuenta_financiera_actual"();



CREATE OR REPLACE TRIGGER "trg_turnos_caja_bitacora_financiera" AFTER INSERT OR UPDATE ON "public"."turnos_caja" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_bitacora_turno_caja"();



CREATE OR REPLACE TRIGGER "trg_venta_pagos_asignar_cuenta" BEFORE INSERT OR UPDATE OF "metodo_pago_id", "metodo_tipo" ON "public"."venta_pagos" FOR EACH ROW EXECUTE FUNCTION "public"."asignar_cuenta_financiera_actual"();



CREATE OR REPLACE TRIGGER "trg_venta_pagos_bitacora_financiera" AFTER INSERT OR DELETE OR UPDATE ON "public"."venta_pagos" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_bitacora_venta_pago"();



ALTER TABLE ONLY "public"."acreditaciones_financieras"
    ADD CONSTRAINT "acreditaciones_financieras_negocio_id_cuenta_destino_id_fkey" FOREIGN KEY ("negocio_id", "cuenta_destino_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."acreditaciones_financieras"
    ADD CONSTRAINT "acreditaciones_financieras_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."acreditaciones_financieras_pagos"
    ADD CONSTRAINT "acreditaciones_financieras_pagos_acreditacion_id_fkey" FOREIGN KEY ("acreditacion_id") REFERENCES "public"."acreditaciones_financieras"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."acreditaciones_financieras_pagos"
    ADD CONSTRAINT "acreditaciones_financieras_pagos_negocio_id_venta_pago_id_fkey" FOREIGN KEY ("negocio_id", "venta_pago_id") REFERENCES "public"."venta_pagos"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."actualizaciones_precio"
    ADD CONSTRAINT "actualizaciones_precio_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."perfiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."actualizaciones_precio_items"
    ADD CONSTRAINT "actualizaciones_precio_items_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "public"."actualizaciones_precio"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."actualizaciones_precio_items"
    ADD CONSTRAINT "actualizaciones_precio_items_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."actualizaciones_precio_items"
    ADD CONSTRAINT "actualizaciones_precio_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."actualizaciones_precio"
    ADD CONSTRAINT "actualizaciones_precio_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."alertas_caja_revisadas"
    ADD CONSTRAINT "alertas_caja_revisadas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."arca_credenciales"
    ADD CONSTRAINT "arca_credenciales_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atributo_valores"
    ADD CONSTRAINT "atributo_valores_atributo_id_fkey" FOREIGN KEY ("atributo_id") REFERENCES "public"."atributos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."atributo_valores"
    ADD CONSTRAINT "atributo_valores_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."atributos"
    ADD CONSTRAINT "atributos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."bajas"
    ADD CONSTRAINT "bajas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."categoria_atributos"
    ADD CONSTRAINT "categoria_atributos_atributo_id_fkey" FOREIGN KEY ("atributo_id") REFERENCES "public"."atributos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categoria_atributos"
    ADD CONSTRAINT "categoria_atributos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categoria_atributos"
    ADD CONSTRAINT "categoria_atributos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."categorias_egreso"
    ADD CONSTRAINT "categorias_egreso_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."categorias"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_lista_precio_id_fkey" FOREIGN KEY ("lista_precio_id") REFERENCES "public"."listas_precios"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clientes"
    ADD CONSTRAINT "clientes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."cobros_cc_correcciones"
    ADD CONSTRAINT "cobros_cc_correcciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cobros_cc_correcciones"
    ADD CONSTRAINT "cobros_cc_correcciones_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "public"."venta_pagos"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."comprobante_numeracion"
    ADD CONSTRAINT "comprobante_numeracion_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."comprobantes"
    ADD CONSTRAINT "comprobantes_anula_comprobante_id_fkey" FOREIGN KEY ("anula_comprobante_id") REFERENCES "public"."comprobantes"("id");



ALTER TABLE ONLY "public"."comprobantes"
    ADD CONSTRAINT "comprobantes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."comprobantes"
    ADD CONSTRAINT "comprobantes_emitido_por_fkey" FOREIGN KEY ("emitido_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."comprobantes_iva"
    ADD CONSTRAINT "comprobantes_iva_comprobante_id_fkey" FOREIGN KEY ("comprobante_id") REFERENCES "public"."comprobantes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."comprobantes_iva"
    ADD CONSTRAINT "comprobantes_iva_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."comprobantes"
    ADD CONSTRAINT "comprobantes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."comprobantes"
    ADD CONSTRAINT "comprobantes_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."configuracion_pos"
    ADD CONSTRAINT "configuracion_pos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."gastos_comerz"
    ADD CONSTRAINT "costos_infra_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cuenta_corriente_movimientos"
    ADD CONSTRAINT "cuenta_corriente_movimientos_anulado_por_fkey" FOREIGN KEY ("anulado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cuenta_corriente_movimientos"
    ADD CONSTRAINT "cuenta_corriente_movimientos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cuenta_corriente_movimientos"
    ADD CONSTRAINT "cuenta_corriente_movimientos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."cuenta_corriente_movimientos"
    ADD CONSTRAINT "cuenta_corriente_movimientos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."cuenta_corriente_movimientos"
    ADD CONSTRAINT "cuenta_corriente_movimientos_pago_id_fkey" FOREIGN KEY ("pago_id") REFERENCES "public"."venta_pagos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cuenta_corriente_movimientos"
    ADD CONSTRAINT "cuenta_corriente_movimientos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cuentas_financieras"
    ADD CONSTRAINT "cuentas_financieras_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."devoluciones_items"
    ADD CONSTRAINT "devoluciones_items_devolucion_id_fkey" FOREIGN KEY ("devolucion_id") REFERENCES "public"."devoluciones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."devoluciones"
    ADD CONSTRAINT "devoluciones_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."diccionario_alias"
    ADD CONSTRAINT "diccionario_alias_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."diccionario_alias"
    ADD CONSTRAINT "diccionario_alias_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."egresos"
    ADD CONSTRAINT "egresos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_egreso"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."egresos"
    ADD CONSTRAINT "egresos_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."perfiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."egresos"
    ADD CONSTRAINT "egresos_cuenta_origen_fkey" FOREIGN KEY ("negocio_id", "cuenta_origen_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."egresos"
    ADD CONSTRAINT "egresos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."egresos"
    ADD CONSTRAINT "egresos_orden_compra_id_fkey" FOREIGN KEY ("orden_compra_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."egresos_programados"
    ADD CONSTRAINT "egresos_programados_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_egreso"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."egresos_programados"
    ADD CONSTRAINT "egresos_programados_cuenta_origen_id_fkey" FOREIGN KEY ("cuenta_origen_id") REFERENCES "public"."cuentas_financieras"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."egresos_programados"
    ADD CONSTRAINT "egresos_programados_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."egresos"
    ADD CONSTRAINT "egresos_turno_caja_id_fkey" FOREIGN KEY ("turno_caja_id") REFERENCES "public"."turnos_caja"("id");



ALTER TABLE ONLY "public"."envios_email"
    ADD CONSTRAINT "envios_email_enviado_por_fkey" FOREIGN KEY ("enviado_por") REFERENCES "public"."perfiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."eventos_comerz"
    ADD CONSTRAINT "eventos_comerz_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."importaciones_productos"
    ADD CONSTRAINT "importaciones_productos_importado_por_fkey" FOREIGN KEY ("importado_por") REFERENCES "public"."perfiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."importaciones_productos"
    ADD CONSTRAINT "importaciones_productos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ingresos_financieros"
    ADD CONSTRAINT "ingresos_financieros_cuenta_fkey" FOREIGN KEY ("negocio_id", "cuenta_destino_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ingresos_financieros"
    ADD CONSTRAINT "ingresos_financieros_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ingresos_financieros"
    ADD CONSTRAINT "ingresos_financieros_turno_caja_id_fkey" FOREIGN KEY ("turno_caja_id") REFERENCES "public"."turnos_caja"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_invitado_por_fkey" FOREIGN KEY ("invitado_por") REFERENCES "public"."perfiles"("id");



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitaciones"
    ADD CONSTRAINT "invitaciones_rol_fkey" FOREIGN KEY ("rol_id", "negocio_id") REFERENCES "public"."roles"("id", "negocio_id");



ALTER TABLE ONLY "public"."bajas"
    ADD CONSTRAINT "mermas_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."perfiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bajas"
    ADD CONSTRAINT "mermas_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."metodos_pago"
    ADD CONSTRAINT "metodos_pago_cuenta_destino_fkey" FOREIGN KEY ("negocio_id", "cuenta_destino_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."metodos_pago"
    ADD CONSTRAINT "metodos_pago_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."movimientos_financieros"
    ADD CONSTRAINT "movimientos_financieros_cuenta_fkey" FOREIGN KEY ("negocio_id", "cuenta_financiera_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."negocios"
    ADD CONSTRAINT "negocios_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."planes"("id");



ALTER TABLE ONLY "public"."ordenes_borradores"
    ADD CONSTRAINT "ordenes_borradores_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ordenes_compra"
    ADD CONSTRAINT "ordenes_compra_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."ordenes_items"
    ADD CONSTRAINT "ordenes_items_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."ordenes_items"
    ADD CONSTRAINT "ordenes_items_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "public"."ordenes_compra"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ordenes_items"
    ADD CONSTRAINT "ordenes_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ordenes_items"
    ADD CONSTRAINT "ordenes_items_raw_categoria_id_fkey" FOREIGN KEY ("raw_categoria_id") REFERENCES "public"."categorias"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pagos_suscripcion"
    ADD CONSTRAINT "pagos_suscripcion_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pagos_suscripcion"
    ADD CONSTRAINT "pagos_suscripcion_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_cobrado_por_fkey" FOREIGN KEY ("cobrado_por") REFERENCES "public"."perfiles"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."pedidos_numeracion"
    ADD CONSTRAINT "pedidos_numeracion_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."perfiles"("id");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."perfiles"
    ADD CONSTRAINT "perfiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_precios"
    ADD CONSTRAINT "producto_precios_lista_id_fkey" FOREIGN KEY ("lista_id") REFERENCES "public"."listas_precios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_precios"
    ADD CONSTRAINT "producto_precios_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_presentaciones"
    ADD CONSTRAINT "producto_presentaciones_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_presentaciones"
    ADD CONSTRAINT "producto_presentaciones_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "public"."producto_variantes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_variante_valores"
    ADD CONSTRAINT "producto_variante_valores_atributo_id_fkey" FOREIGN KEY ("atributo_id") REFERENCES "public"."atributos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_variante_valores"
    ADD CONSTRAINT "producto_variante_valores_atributo_valor_id_fkey" FOREIGN KEY ("atributo_valor_id") REFERENCES "public"."atributo_valores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_variante_valores"
    ADD CONSTRAINT "producto_variante_valores_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."producto_variante_valores"
    ADD CONSTRAINT "producto_variante_valores_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "public"."producto_variantes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_variantes_auditoria"
    ADD CONSTRAINT "producto_variantes_auditoria_editado_por_fkey" FOREIGN KEY ("editado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."producto_variantes_auditoria"
    ADD CONSTRAINT "producto_variantes_auditoria_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."producto_variantes_auditoria"
    ADD CONSTRAINT "producto_variantes_auditoria_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producto_variantes"
    ADD CONSTRAINT "producto_variantes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."producto_variantes"
    ADD CONSTRAINT "producto_variantes_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."productos"
    ADD CONSTRAINT "productos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."productos_stock"
    ADD CONSTRAINT "productos_stock_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."productos_stock"
    ADD CONSTRAINT "productos_stock_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promociones_categorias"
    ADD CONSTRAINT "promociones_categorias_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."promociones_categorias"
    ADD CONSTRAINT "promociones_categorias_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promociones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promociones"
    ADD CONSTRAINT "promociones_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."promociones_metodos_pago"
    ADD CONSTRAINT "promociones_metodos_pago_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."promociones_metodos_pago"
    ADD CONSTRAINT "promociones_metodos_pago_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promociones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promociones"
    ADD CONSTRAINT "promociones_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."promociones_productos"
    ADD CONSTRAINT "promociones_productos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."promociones_productos"
    ADD CONSTRAINT "promociones_productos_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promociones_productos"
    ADD CONSTRAINT "promociones_productos_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promociones"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservas"
    ADD CONSTRAINT "reservas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservas"
    ADD CONSTRAINT "reservas_creado_por_fkey" FOREIGN KEY ("creado_por") REFERENCES "public"."perfiles"("id");



ALTER TABLE ONLY "public"."reservas"
    ADD CONSTRAINT "reservas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."reservas"
    ADD CONSTRAINT "reservas_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservas"
    ADD CONSTRAINT "reservas_variante_id_fkey" FOREIGN KEY ("variante_id") REFERENCES "public"."producto_variantes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reservas"
    ADD CONSTRAINT "reservas_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rol_permisos"
    ADD CONSTRAINT "rol_permisos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."rol_permisos"
    ADD CONSTRAINT "rol_permisos_permiso_id_fkey" FOREIGN KEY ("permiso_id") REFERENCES "public"."permisos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rol_permisos"
    ADD CONSTRAINT "rol_permisos_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."slugs_historicos"
    ADD CONSTRAINT "slugs_historicos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."solicitudes_plan"
    ADD CONSTRAINT "solicitudes_plan_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."solicitudes_plan"
    ADD CONSTRAINT "solicitudes_plan_plan_solicitado_id_fkey" FOREIGN KEY ("plan_solicitado_id") REFERENCES "public"."planes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."solicitudes_plan"
    ADD CONSTRAINT "solicitudes_plan_resuelto_por_fkey" FOREIGN KEY ("resuelto_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."solicitudes_plan"
    ADD CONSTRAINT "solicitudes_plan_solicitado_por_fkey" FOREIGN KEY ("solicitado_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."transferencias_financieras"
    ADD CONSTRAINT "transferencias_destino_fkey" FOREIGN KEY ("negocio_id", "cuenta_destino_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transferencias_financieras"
    ADD CONSTRAINT "transferencias_financieras_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transferencias_financieras"
    ADD CONSTRAINT "transferencias_financieras_revierte_a_fkey" FOREIGN KEY ("revierte_a") REFERENCES "public"."transferencias_financieras"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transferencias_financieras"
    ADD CONSTRAINT "transferencias_origen_fkey" FOREIGN KEY ("negocio_id", "cuenta_origen_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."turnos_caja"
    ADD CONSTRAINT "turnos_caja_abierta_por_fkey" FOREIGN KEY ("abierta_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."turnos_caja"
    ADD CONSTRAINT "turnos_caja_cerrada_por_fkey" FOREIGN KEY ("cerrada_por") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."turnos_caja"
    ADD CONSTRAINT "turnos_caja_cuenta_financiera_fkey" FOREIGN KEY ("negocio_id", "cuenta_financiera_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."turnos_caja"
    ADD CONSTRAINT "turnos_caja_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."turnos_caja"
    ADD CONSTRAINT "turnos_caja_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."turnos_caja"
    ADD CONSTRAINT "turnos_caja_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."perfiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."unidades_serie"
    ADD CONSTRAINT "unidades_serie_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."unidades_serie"
    ADD CONSTRAINT "unidades_serie_producto_variante_id_fkey" FOREIGN KEY ("producto_variante_id") REFERENCES "public"."producto_variantes"("id") ON DELETE RESTRICT;



COMMENT ON CONSTRAINT "unidades_serie_producto_variante_id_fkey" ON "public"."unidades_serie" IS 'RESTRICT, no CASCADE: borrar un producto o una variante no puede borrar el registro de garantia de un equipo con IMEI. Ver 20260902150000.';



ALTER TABLE ONLY "public"."usuarios_negocios"
    ADD CONSTRAINT "usuarios_negocios_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios_negocios"
    ADD CONSTRAINT "usuarios_negocios_rol_fkey" FOREIGN KEY ("rol_id", "negocio_id") REFERENCES "public"."roles"("id", "negocio_id");



ALTER TABLE ONLY "public"."usuarios_negocios"
    ADD CONSTRAINT "usuarios_negocios_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."perfiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usuarios_prueba"
    ADD CONSTRAINT "usuarios_prueba_marcado_por_fkey" FOREIGN KEY ("marcado_por") REFERENCES "public"."perfiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_cuenta_destino_fkey" FOREIGN KEY ("negocio_id", "cuenta_destino_id") REFERENCES "public"."cuentas_financieras"("negocio_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_metodo_pago_id_fkey" FOREIGN KEY ("metodo_pago_id") REFERENCES "public"."metodos_pago"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_turno_caja_id_fkey" FOREIGN KEY ("turno_caja_id") REFERENCES "public"."turnos_caja"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."venta_pagos"
    ADD CONSTRAINT "venta_pagos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas_correcciones"
    ADD CONSTRAINT "ventas_correcciones_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ventas_descuentos"
    ADD CONSTRAINT "ventas_descuentos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."ventas_descuentos"
    ADD CONSTRAINT "ventas_descuentos_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promociones"("id");



ALTER TABLE ONLY "public"."ventas_descuentos"
    ADD CONSTRAINT "ventas_descuentos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas_items"
    ADD CONSTRAINT "ventas_items_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."ventas_items"
    ADD CONSTRAINT "ventas_items_producto_id_fkey" FOREIGN KEY ("producto_id") REFERENCES "public"."productos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas_items"
    ADD CONSTRAINT "ventas_items_promocion_id_fkey" FOREIGN KEY ("promocion_id") REFERENCES "public"."promociones"("id");



ALTER TABLE ONLY "public"."ventas_items"
    ADD CONSTRAINT "ventas_items_unidad_serie_id_fkey" FOREIGN KEY ("unidad_serie_id") REFERENCES "public"."unidades_serie"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas_items"
    ADD CONSTRAINT "ventas_items_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."ventas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id");



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_turno_caja_id_fkey" FOREIGN KEY ("turno_caja_id") REFERENCES "public"."turnos_caja"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ventas"
    ADD CONSTRAINT "ventas_vendedor_id_fkey" FOREIGN KEY ("vendedor_id") REFERENCES "public"."perfiles"("id") ON DELETE SET NULL;



ALTER TABLE "archivo"."_backup_broderie_20260731_alias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "archivo"."_backup_broderie_20260731_stock" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "archivo"."_backup_broderie_20260731_variantes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "archivo"."solicitudes_comercio" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "solicitudes_comercio_insert_publico" ON "archivo"."solicitudes_comercio" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "solicitudes_comercio_super_admin" ON "archivo"."solicitudes_comercio" TO "authenticated" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



CREATE POLICY "Actualizar actualizaciones solo admin" ON "public"."actualizaciones_precio" FOR UPDATE USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Creación ventas solo auth" ON "public"."ventas" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Edición stock solo auth" ON "public"."productos_stock" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Insertar actualizaciones" ON "public"."actualizaciones_precio" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Lectura actualizaciones" ON "public"."actualizaciones_precio" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Lectura ventas solo auth" ON "public"."ventas" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Leer planes activos" ON "public"."planes" FOR SELECT USING (true);



CREATE POLICY "Manejo diccionario" ON "public"."diccionario_alias" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Manejo ordenes_compra" ON "public"."ordenes_compra" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Manejo ordenes_items" ON "public"."ordenes_items" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Permitir a usuarios autenticados crear bajas" ON "public"."bajas" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "creado_por"));



CREATE POLICY "Permitir actualizar bajas" ON "public"."bajas" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir actualizar promociones" ON "public"."promociones" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir actualizar stock" ON "public"."productos_stock" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir borrar items" ON "public"."ventas_items" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "Permitir crear turnos" ON "public"."turnos_caja" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "vendedor_id"));



CREATE POLICY "Permitir gestion de diccionario a staff" ON "public"."diccionario_alias" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir gestion de importaciones a staff" ON "public"."importaciones_productos" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir gestion de items a staff" ON "public"."ordenes_items" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir gestion de ordenes a staff" ON "public"."ordenes_compra" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir insertar bajas" ON "public"."bajas" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Permitir insertar descuentos" ON "public"."ventas_descuentos" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Permitir insertar stock a autenticados" ON "public"."productos_stock" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Permitir insertar variantes a autenticados" ON "public"."producto_variantes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Permitir insertar ventas" ON "public"."ventas" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Permitir lectura a usuarios autenticados" ON "public"."venta_pagos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir lectura de métodos a usuarios autenticados" ON "public"."metodos_pago" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir lectura de perfiles" ON "public"."perfiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir lectura de ventas" ON "public"."ventas" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir lectura pública de categorias" ON "public"."categorias" FOR SELECT TO "anon" USING (("activa" = true));



CREATE POLICY "Permitir leer bajas a usuarios autenticados" ON "public"."bajas" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir leer descuentos" ON "public"."ventas_descuentos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir leer items" ON "public"."ventas_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Permitir modificar stock" ON "public"."productos_stock" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Permitir todo a autenticados en atributo_valores" ON "public"."atributo_valores" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a autenticados en atributos" ON "public"."atributos" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a autenticados en categoria_atributos" ON "public"."categoria_atributos" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a autenticados en producto_variantes" ON "public"."producto_variantes" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a autenticados en pv_valores" ON "public"."producto_variante_valores" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a autenticados en unidades_serie" ON "public"."unidades_serie" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a usuarios autenticados (clientes)" ON "public"."clientes" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a usuarios autenticados (movimientos cc)" ON "public"."cuenta_corriente_movimientos" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Permitir todo a usuarios autenticados (reservas)" ON "public"."reservas" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "Select promociones" ON "public"."promociones" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Select promociones_categorias" ON "public"."promociones_categorias" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Select promociones_metodos" ON "public"."promociones_metodos_pago" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Select promociones_productos" ON "public"."promociones_productos" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."acreditaciones_financieras" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."acreditaciones_financieras_pagos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "acreditaciones_pagos_select_gerencial" ON "public"."acreditaciones_financieras_pagos" FOR SELECT TO "authenticated" USING (( SELECT "public"."tiene_permiso"('caja.ver_gerencial'::"text") AS "tiene_permiso"));



CREATE POLICY "acreditaciones_select_gerencial" ON "public"."acreditaciones_financieras" FOR SELECT TO "authenticated" USING (( SELECT "public"."tiene_permiso"('caja.ver_gerencial'::"text") AS "tiene_permiso"));



ALTER TABLE "public"."actualizaciones_precio" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."actualizaciones_precio_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "actualizaciones_precio_items_insert_propio" ON "public"."actualizaciones_precio_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."actualizaciones_precio" "ap"
  WHERE (("ap"."id" = "actualizaciones_precio_items"."lote_id") AND ("ap"."creado_por" = "auth"."uid"())))));



CREATE POLICY "actualizaciones_precio_items_select_propio_o_admin" ON "public"."actualizaciones_precio_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."actualizaciones_precio" "ap"
  WHERE (("ap"."id" = "actualizaciones_precio_items"."lote_id") AND (("ap"."creado_por" = "auth"."uid"()) OR "public"."is_admin"())))));



CREATE POLICY "aislamiento_negocio" ON "public"."acreditaciones_financieras" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."acreditaciones_financieras_pagos" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."actualizaciones_precio" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."actualizaciones_precio_items" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."alertas_caja_revisadas" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."atributo_valores" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."atributos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."bajas" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."catalogo_borrados" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."categoria_atributos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."categorias" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."categorias_egreso" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."clientes" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."cobros_cc_correcciones" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."comprobante_numeracion" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."comprobantes" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."comprobantes_iva" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."configuracion_pos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."cuenta_corriente_movimientos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."cuentas_financieras" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."devoluciones" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."devoluciones_items" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."diccionario_alias" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."egresos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."egresos_programados" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."eventos_uso" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."importaciones_productos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ingresos_financieros" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."listas_precios" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."metodos_pago" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."movimientos_financieros" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."movimientos_stock" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ordenes_borradores" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ordenes_compra" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ordenes_items" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."pedidos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."pedidos_numeracion" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."perfiles" AS RESTRICTIVE TO "authenticated" USING ((("id" = "auth"."uid"()) OR "security"."comparte_negocio"("id") OR "security"."is_super_admin"())) WITH CHECK ((("id" = "auth"."uid"()) OR "security"."comparte_negocio"("id") OR "security"."is_super_admin"()));



CREATE POLICY "aislamiento_negocio" ON "public"."producto_precios" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."producto_presentaciones" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."producto_variante_valores" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."producto_variantes" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."producto_variantes_auditoria" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."productos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."productos_stock" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."promociones" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."promociones_categorias" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."promociones_metodos_pago" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."promociones_productos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."reservas" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."rol_permisos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."roles" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."transferencias_financieras" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."turnos_caja" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."unidades_serie" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."venta_pagos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ventas" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ventas_correcciones" AS RESTRICTIVE USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ventas_descuentos" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio" ON "public"."ventas_items" AS RESTRICTIVE TO "authenticated" USING (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id"))) WITH CHECK (("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."categorias" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."configuracion_pos" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."metodos_pago" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."producto_variante_valores" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."producto_variantes" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."productos" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."productos_stock" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."promociones" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."promociones_categorias" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."promociones_metodos_pago" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



CREATE POLICY "aislamiento_negocio_publico" ON "public"."promociones_productos" AS RESTRICTIVE TO "anon" USING (("negocio_id" = "security"."negocio_publico"()));



ALTER TABLE "public"."alertas_caja_revisadas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "alertas_caja_revisadas_select" ON "public"."alertas_caja_revisadas" FOR SELECT TO "authenticated" USING ((( SELECT "public"."tiene_permiso"('caja.ver_movimientos'::"text") AS "tiene_permiso") OR ( SELECT "public"."tiene_permiso"('caja.ver_gerencial'::"text") AS "tiene_permiso")));



ALTER TABLE "public"."arca_credenciales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."atributo_valores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."atributos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."backfill_variante_id_20260903" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bajas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."catalogo_borrados" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "catalogo_borrados_insert" ON "public"."catalogo_borrados" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "catalogo_borrados_select" ON "public"."catalogo_borrados" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."categoria_atributos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categorias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categorias_delete_con_permiso" ON "public"."categorias" FOR DELETE TO "authenticated" USING (( SELECT "public"."tiene_permiso"('stock.cambiar_categoria'::"text") AS "tiene_permiso"));



ALTER TABLE "public"."categorias_egreso" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categorias_egreso_delete" ON "public"."categorias_egreso" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "categorias_egreso_insert" ON "public"."categorias_egreso" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."tiene_permiso"('caja.registrar_egreso'::"text") AS "tiene_permiso"));



CREATE POLICY "categorias_egreso_select" ON "public"."categorias_egreso" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "categorias_egreso_update" ON "public"."categorias_egreso" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "categorias_insert_con_permiso" ON "public"."categorias" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."tiene_permiso"('stock.cambiar_categoria'::"text") AS "tiene_permiso"));



CREATE POLICY "categorias_select_auth" ON "public"."categorias" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "categorias_update_con_permiso" ON "public"."categorias" FOR UPDATE TO "authenticated" USING (( SELECT "public"."tiene_permiso"('stock.cambiar_categoria'::"text") AS "tiene_permiso")) WITH CHECK (( SELECT "public"."tiene_permiso"('stock.cambiar_categoria'::"text") AS "tiene_permiso"));



ALTER TABLE "public"."clientes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cobros_cc_correcciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cobros_cc_correcciones_insert" ON "public"."cobros_cc_correcciones" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "cobros_cc_correcciones_select" ON "public"."cobros_cc_correcciones" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."comprobante_numeracion" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comprobante_numeracion_todo" ON "public"."comprobante_numeracion" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."comprobantes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comprobantes_insert" ON "public"."comprobantes" FOR INSERT TO "authenticated" WITH CHECK (true);



ALTER TABLE "public"."comprobantes_iva" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comprobantes_iva_insert" ON "public"."comprobantes_iva" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."comprobantes" "c"
  WHERE ("c"."id" = "comprobantes_iva"."comprobante_id"))));



CREATE POLICY "comprobantes_iva_select" ON "public"."comprobantes_iva" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "comprobantes_select" ON "public"."comprobantes" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."configuracion_pos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "configuracion_pos_select_anon" ON "public"."configuracion_pos" FOR SELECT TO "anon" USING (true);



CREATE POLICY "configuracion_pos_select_auth" ON "public"."configuracion_pos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "configuracion_pos_update_admin" ON "public"."configuracion_pos" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."cuenta_corriente_movimientos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cuentas_financieras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cuentas_financieras_delete_admin" ON "public"."cuentas_financieras" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "cuentas_financieras_insert_admin" ON "public"."cuentas_financieras" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "cuentas_financieras_select" ON "public"."cuentas_financieras" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "cuentas_financieras_update_admin" ON "public"."cuentas_financieras" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."devoluciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devoluciones_insert_de_venta_propia" ON "public"."devoluciones" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE ("v"."id" = "devoluciones"."venta_id"))));



ALTER TABLE "public"."devoluciones_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "devoluciones_items_insert_de_devolucion_propia" ON "public"."devoluciones_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."devoluciones" "d"
  WHERE ("d"."id" = "devoluciones_items"."devolucion_id"))));



CREATE POLICY "devoluciones_items_select" ON "public"."devoluciones_items" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "devoluciones_select" ON "public"."devoluciones" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."diccionario_alias" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."egresos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "egresos_insert_propio" ON "public"."egresos" FOR INSERT TO "authenticated" WITH CHECK ((("creado_por" = "auth"."uid"()) AND (( SELECT "public"."tiene_permiso"('caja.registrar_egreso'::"text") AS "tiene_permiso") OR ( SELECT "public"."tiene_permiso"('ventas.anular'::"text") AS "tiene_permiso"))));



ALTER TABLE "public"."egresos_programados" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "egresos_programados_delete_admin" ON "public"."egresos_programados" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "egresos_programados_insert_admin" ON "public"."egresos_programados" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "egresos_programados_select" ON "public"."egresos_programados" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "egresos_programados_update_admin" ON "public"."egresos_programados" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "egresos_select_propio_o_admin" ON "public"."egresos" FOR SELECT TO "authenticated" USING ((("creado_por" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "egresos_update_descriptivo" ON "public"."egresos" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_admin"() AS "is_admin") OR (("creado_por" = "auth"."uid"()) AND ( SELECT "public"."tiene_permiso"('caja.registrar_egreso'::"text") AS "tiene_permiso")))) WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") OR (("creado_por" = "auth"."uid"()) AND ( SELECT "public"."tiene_permiso"('caja.registrar_egreso'::"text") AS "tiene_permiso"))));



ALTER TABLE "public"."email_bajas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_bajas_super_admin" ON "public"."email_bajas" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."envios_email" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "envios_email_super_admin" ON "public"."envios_email" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."eventos_comerz" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eventos_comerz_super_admin" ON "public"."eventos_comerz" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."eventos_uso" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eventos_uso_insert" ON "public"."eventos_uso" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "eventos_uso_select_admin" ON "public"."eventos_uso" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."gastos_comerz" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gastos_comerz_super_admin" ON "public"."gastos_comerz" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."importaciones_productos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ingresos_financieros" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ingresos_financieros_select" ON "public"."ingresos_financieros" FOR SELECT TO "authenticated" USING ((("registrado_por" = "auth"."uid"()) OR ( SELECT "public"."tiene_permiso"('caja.ver_movimientos'::"text") AS "tiene_permiso")));



ALTER TABLE "public"."invitaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitaciones_admin_del_negocio" ON "public"."invitaciones" TO "authenticated" USING ((("negocio_id" = "security"."current_negocio_id"()) AND "public"."is_admin"())) WITH CHECK ((("negocio_id" = "security"."current_negocio_id"()) AND "public"."is_admin"()));



ALTER TABLE "public"."listas_precios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "listas_precios_delete_admin" ON "public"."listas_precios" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "listas_precios_insert_admin" ON "public"."listas_precios" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "listas_precios_select" ON "public"."listas_precios" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "listas_precios_update_admin" ON "public"."listas_precios" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."metodos_pago" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "metodos_pago_delete_admin" ON "public"."metodos_pago" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "metodos_pago_insert_admin" ON "public"."metodos_pago" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "metodos_pago_select_anon" ON "public"."metodos_pago" FOR SELECT TO "anon" USING ("activo");



CREATE POLICY "metodos_pago_update_admin" ON "public"."metodos_pago" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."movimientos_financieros" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movimientos_financieros_select_movimientos" ON "public"."movimientos_financieros" FOR SELECT TO "authenticated" USING (( SELECT "public"."tiene_permiso"('caja.ver_movimientos'::"text") AS "tiene_permiso"));



ALTER TABLE "public"."movimientos_stock" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "movimientos_stock_insert" ON "public"."movimientos_stock" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "movimientos_stock_select" ON "public"."movimientos_stock" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."negocios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "negocios_select_anon_activo" ON "public"."negocios" FOR SELECT TO "anon" USING (("estado" = ANY (ARRAY['activo'::"text", 'prueba'::"text", 'demo'::"text"])));



CREATE POLICY "negocios_select_membresia" ON "public"."negocios" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."usuarios_negocios" "un"
  WHERE (("un"."negocio_id" = "negocios"."id") AND ("un"."usuario_id" = "auth"."uid"())))));



CREATE POLICY "negocios_select_propio" ON "public"."negocios" FOR SELECT TO "authenticated" USING (("id" = "security"."current_negocio_id"()));



CREATE POLICY "negocios_select_super_admin" ON "public"."negocios" FOR SELECT TO "authenticated" USING ("security"."is_super_admin"());



CREATE POLICY "negocios_update_super_admin" ON "public"."negocios" FOR UPDATE TO "authenticated" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



CREATE POLICY "onboarding_pasos_select_propio" ON "public"."onboarding_pasos_vistos" FOR SELECT USING (("usuario_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."onboarding_pasos_vistos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ordenes_borradores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ordenes_borradores_delete" ON "public"."ordenes_borradores" FOR DELETE TO "authenticated" USING (true);



CREATE POLICY "ordenes_borradores_insert" ON "public"."ordenes_borradores" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "ordenes_borradores_select" ON "public"."ordenes_borradores" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "ordenes_borradores_update" ON "public"."ordenes_borradores" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."ordenes_compra" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ordenes_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pagos_suscripcion" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pagos_suscripcion_select_propio" ON "public"."pagos_suscripcion" FOR SELECT USING (("negocio_id" = "security"."current_negocio_id"()));



CREATE POLICY "pagos_suscripcion_super_admin" ON "public"."pagos_suscripcion" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."pedidos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pedidos_insert" ON "public"."pedidos" FOR INSERT TO "authenticated" WITH CHECK (("vendedor_id" = "auth"."uid"()));



ALTER TABLE "public"."pedidos_numeracion" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pedidos_numeracion_todo" ON "public"."pedidos_numeracion" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "pedidos_select" ON "public"."pedidos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "pedidos_update" ON "public"."pedidos" FOR UPDATE TO "authenticated" USING ((("vendedor_id" = "auth"."uid"()) OR ( SELECT "public"."tiene_permiso"('ventas.cobrar'::"text") AS "tiene_permiso"))) WITH CHECK ((("vendedor_id" = "auth"."uid"()) OR ( SELECT "public"."tiene_permiso"('ventas.cobrar'::"text") AS "tiene_permiso")));



ALTER TABLE "public"."perfiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "perfiles_update_admin" ON "public"."perfiles" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."permisos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permisos_select_admin" ON "public"."permisos" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."planes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_precios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "producto_precios_delete_admin" ON "public"."producto_precios" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "producto_precios_insert_admin" ON "public"."producto_precios" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "producto_precios_select" ON "public"."producto_precios" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "producto_precios_update_admin" ON "public"."producto_precios" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."producto_presentaciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "producto_presentaciones_delete" ON "public"."producto_presentaciones" FOR DELETE TO "authenticated" USING (( SELECT "public"."tiene_permiso"('stock.editar_producto'::"text") AS "tiene_permiso"));



CREATE POLICY "producto_presentaciones_insert" ON "public"."producto_presentaciones" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."tiene_permiso"('stock.editar_producto'::"text") AS "tiene_permiso"));



CREATE POLICY "producto_presentaciones_select" ON "public"."producto_presentaciones" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "producto_presentaciones_update" ON "public"."producto_presentaciones" FOR UPDATE TO "authenticated" USING (( SELECT "public"."tiene_permiso"('stock.editar_producto'::"text") AS "tiene_permiso")) WITH CHECK (( SELECT "public"."tiene_permiso"('stock.editar_producto'::"text") AS "tiene_permiso"));



ALTER TABLE "public"."producto_variante_valores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_variantes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."producto_variantes_auditoria" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "producto_variantes_auditoria_insert_authenticated" ON "public"."producto_variantes_auditoria" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "producto_variantes_auditoria_select_admin" ON "public"."producto_variantes_auditoria" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "producto_variantes_select_anon" ON "public"."producto_variantes" FOR SELECT TO "anon" USING (("activa" = true));



ALTER TABLE "public"."productos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "productos_delete_con_permiso" ON "public"."productos" FOR DELETE TO "authenticated" USING (( SELECT "public"."tiene_permiso"('stock.eliminar_producto'::"text") AS "tiene_permiso"));



CREATE POLICY "productos_insert_auth" ON "public"."productos" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "productos_select_anon" ON "public"."productos" FOR SELECT TO "anon" USING (("publicado" = true));



CREATE POLICY "productos_select_auth" ON "public"."productos" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."productos_stock" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "productos_stock_select_anon" ON "public"."productos_stock" FOR SELECT TO "anon" USING (true);



CREATE POLICY "productos_update_auth" ON "public"."productos" FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);



COMMENT ON POLICY "productos_update_auth" ON "public"."productos" IS 'Provisorio. Volvio a abrirse el 5/9/2026 porque exigir stock.editar_producto dejo a las vendedoras sin poder cargar fotos, y en silencio. Se vuelve a cerrar cuando la foto tenga su propia RPC SECURITY DEFINER.';



ALTER TABLE "public"."promociones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promociones_categorias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "promociones_categorias_delete_admin" ON "public"."promociones_categorias" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "promociones_categorias_insert_admin" ON "public"."promociones_categorias" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "promociones_categorias_select_anon" ON "public"."promociones_categorias" FOR SELECT TO "anon" USING (true);



CREATE POLICY "promociones_delete_admin" ON "public"."promociones" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "promociones_insert_admin" ON "public"."promociones" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



ALTER TABLE "public"."promociones_metodos_pago" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "promociones_metodos_pago_delete_admin" ON "public"."promociones_metodos_pago" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "promociones_metodos_pago_insert_admin" ON "public"."promociones_metodos_pago" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "promociones_metodos_pago_select_anon" ON "public"."promociones_metodos_pago" FOR SELECT TO "anon" USING (true);



ALTER TABLE "public"."promociones_productos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "promociones_productos_delete_admin" ON "public"."promociones_productos" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "promociones_productos_insert_admin" ON "public"."promociones_productos" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "promociones_productos_select_anon" ON "public"."promociones_productos" FOR SELECT TO "anon" USING (true);



CREATE POLICY "promociones_select_anon" ON "public"."promociones" FOR SELECT TO "anon" USING (("activa" = true));



ALTER TABLE "public"."reservas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rol_permisos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rol_permisos_delete_admin" ON "public"."rol_permisos" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "rol_permisos_insert_admin" ON "public"."rol_permisos" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "rol_permisos_select_admin" ON "public"."rol_permisos" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "rol_permisos_update_admin" ON "public"."rol_permisos" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_select_admin" ON "public"."roles" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."slugs_historicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "slugs_historicos_select_publico" ON "public"."slugs_historicos" FOR SELECT USING (true);



CREATE POLICY "slugs_historicos_super_admin" ON "public"."slugs_historicos" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."solicitudes_plan" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "solicitudes_plan_aislamiento" ON "public"."solicitudes_plan" AS RESTRICTIVE USING ((("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")) OR ( SELECT "security"."is_super_admin"() AS "is_super_admin"))) WITH CHECK ((("negocio_id" = ( SELECT "security"."current_negocio_id"() AS "current_negocio_id")) OR ( SELECT "security"."is_super_admin"() AS "is_super_admin")));



CREATE POLICY "solicitudes_plan_insert_admin" ON "public"."solicitudes_plan" FOR INSERT WITH CHECK ((("negocio_id" = "security"."current_negocio_id"()) AND "public"."is_admin"()));



CREATE POLICY "solicitudes_plan_select_propio" ON "public"."solicitudes_plan" FOR SELECT USING (("negocio_id" = "security"."current_negocio_id"()));



CREATE POLICY "solicitudes_plan_select_super_admin" ON "public"."solicitudes_plan" FOR SELECT USING ("security"."is_super_admin"());



CREATE POLICY "solicitudes_plan_update_super_admin" ON "public"."solicitudes_plan" FOR UPDATE USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."transferencias_financieras" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transferencias_select_movimientos" ON "public"."transferencias_financieras" FOR SELECT TO "authenticated" USING (( SELECT "public"."tiene_permiso"('caja.ver_movimientos'::"text") AS "tiene_permiso"));



ALTER TABLE "public"."turnos_caja" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "turnos_caja_select_propio_o_admin" ON "public"."turnos_caja" FOR SELECT TO "authenticated" USING ((("vendedor_id" = "auth"."uid"()) OR "public"."tiene_permiso"('caja.cerrar_ajena'::"text") OR ("modo" = 'UNICA'::"text")));



CREATE POLICY "turnos_caja_update_propio" ON "public"."turnos_caja" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "vendedor_id") OR "public"."tiene_permiso"('caja.cerrar_ajena'::"text"))) WITH CHECK ((("auth"."uid"() = "vendedor_id") OR "public"."tiene_permiso"('caja.cerrar_ajena'::"text")));



ALTER TABLE "public"."unidades_serie" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."usuarios_negocios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_negocios_admin_del_negocio" ON "public"."usuarios_negocios" TO "authenticated" USING ((("negocio_id" = "security"."current_negocio_id"()) AND "public"."is_admin"())) WITH CHECK ((("negocio_id" = "security"."current_negocio_id"()) AND "public"."is_admin"()));



CREATE POLICY "usuarios_negocios_select_propio" ON "public"."usuarios_negocios" FOR SELECT TO "authenticated" USING (("usuario_id" = "auth"."uid"()));



CREATE POLICY "usuarios_negocios_select_super_admin" ON "public"."usuarios_negocios" FOR SELECT TO "authenticated" USING ("security"."is_super_admin"());



ALTER TABLE "public"."usuarios_prueba" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usuarios_prueba_super_admin" ON "public"."usuarios_prueba" USING ("security"."is_super_admin"()) WITH CHECK ("security"."is_super_admin"());



ALTER TABLE "public"."venta_pagos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "venta_pagos_insert_de_venta_propia" ON "public"."venta_pagos" FOR INSERT TO "authenticated" WITH CHECK (
CASE
    WHEN ("venta_id" IS NOT NULL) THEN (EXISTS ( SELECT 1
       FROM "public"."ventas" "v"
      WHERE ("v"."id" = "venta_pagos"."venta_id")))
    WHEN ("cliente_id" IS NOT NULL) THEN (EXISTS ( SELECT 1
       FROM "public"."clientes" "c"
      WHERE ("c"."id" = "venta_pagos"."cliente_id")))
    ELSE false
END);



CREATE POLICY "venta_pagos_update_de_venta_propia_o_admin" ON "public"."venta_pagos" FOR UPDATE TO "authenticated" USING (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "venta_pagos"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"())))))) WITH CHECK (("public"."is_admin"() OR (EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE (("v"."id" = "venta_pagos"."venta_id") AND ("v"."vendedor_id" = "auth"."uid"()))))));



ALTER TABLE "public"."ventas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ventas_correcciones" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_correcciones_insert" ON "public"."ventas_correcciones" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "ventas_correcciones_select" ON "public"."ventas_correcciones" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "ventas_delete_propia_o_admin" ON "public"."ventas" FOR DELETE TO "authenticated" USING ((("vendedor_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."ventas_descuentos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ventas_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ventas_items_insert_de_venta_propia" ON "public"."ventas_items" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."ventas" "v"
  WHERE ("v"."id" = "ventas_items"."venta_id"))));



CREATE POLICY "ventas_update_propia_o_admin" ON "public"."ventas" FOR UPDATE TO "authenticated" USING (((("vendedor_id" = "auth"."uid"()) OR "public"."tiene_permiso"('ventas.ver_todas'::"text")) AND "public"."tiene_permiso"('ventas.anular'::"text"))) WITH CHECK (((("vendedor_id" = "auth"."uid"()) OR "public"."tiene_permiso"('ventas.ver_todas'::"text")) AND "public"."tiene_permiso"('ventas.anular'::"text")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



GRANT USAGE ON SCHEMA "security" TO "authenticated";
GRANT USAGE ON SCHEMA "security" TO "anon";































































































































































































































































GRANT ALL ON FUNCTION "public"."aceptar_invitacion"("p_token" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."aceptar_invitacion"("p_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."aceptar_invitacion"("p_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."aceptar_invitaciones_pendientes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aceptar_invitaciones_pendientes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."aceptar_invitaciones_pendientes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."acreditar_cobros_vencidos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."acreditar_cobros_vencidos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."acreditar_cobros_vencidos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ajustar_saldo_cliente"("p_cliente_id" "uuid", "p_delta" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ajustar_saldo_cliente"("p_cliente_id" "uuid", "p_delta" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ajustar_saldo_cliente"("p_cliente_id" "uuid", "p_delta" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ajustar_stock_legacy"("p_producto_id" "uuid", "p_variante" "text", "p_delta" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ajustar_stock_legacy"("p_producto_id" "uuid", "p_variante" "text", "p_delta" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."ajustar_stock_legacy"("p_producto_id" "uuid", "p_variante" "text", "p_delta" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ajustar_stock_legacy"("p_producto_id" "uuid", "p_variante" "text", "p_delta" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ajustar_stock_variante"("p_variante_id" "uuid", "p_delta" numeric, "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ajustar_stock_variante"("p_variante_id" "uuid", "p_delta" numeric, "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ajustar_stock_variante"("p_variante_id" "uuid", "p_delta" numeric, "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ajustar_stock_variante"("p_variante_id" "uuid", "p_delta" numeric, "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ajustar_stock_variantes"("p_movimientos" "jsonb", "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ajustar_stock_variantes"("p_movimientos" "jsonb", "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ajustar_stock_variantes"("p_movimientos" "jsonb", "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ajustar_stock_variantes"("p_movimientos" "jsonb", "p_permitir_negativo" boolean, "p_origen" "text", "p_referencia_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."alertas_caja"("p_dias" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."alertas_caja"("p_dias" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."alertas_caja"("p_dias" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."alertas_caja_pendientes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."alertas_caja_pendientes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."alertas_caja_pendientes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."alta_empleado_local"("p_usuario_id" "uuid", "p_rol_id" "uuid", "p_nombre" "text", "p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."alta_empleado_local"("p_usuario_id" "uuid", "p_rol_id" "uuid", "p_nombre" "text", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."alta_empleado_local"("p_usuario_id" "uuid", "p_rol_id" "uuid", "p_nombre" "text", "p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."antiguedad_saldo_cc"("p_limite" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."antiguedad_saldo_cc"("p_limite" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."antiguedad_saldo_cc"("p_limite" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."antiguedad_saldo_cc"("p_limite" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."anular_egreso"("p_egreso_id" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anular_egreso"("p_egreso_id" "uuid", "p_motivo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."anular_egreso"("p_egreso_id" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."anular_egreso"("p_egreso_id" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."anular_ingreso_financiero"("p_ingreso_id" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."anular_ingreso_financiero"("p_ingreso_id" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."anular_ingreso_financiero"("p_ingreso_id" "uuid", "p_motivo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."anular_venta"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."anular_venta"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."anular_venta"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."anular_venta_facturada"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_comprobante" "jsonb", "p_reintegro_metodo_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."anular_venta_facturada"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_comprobante" "jsonb", "p_reintegro_metodo_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."anular_venta_facturada"("p_venta_id" "uuid", "p_motivo" "text", "p_turno_id" "uuid", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_comprobante" "jsonb", "p_reintegro_metodo_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."aprobar_orden_compra"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aprobar_orden_compra"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."aprobar_orden_compra"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."aprobar_orden_compra"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."aprobar_orden_compra_impl"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."aprobar_orden_compra_impl"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."aprobar_orden_compra_impl"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."aprobar_orden_compra_impl"("p_orden_id" "uuid", "p_proveedor" "text", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."asignar_cuenta_financiera_actual"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."asignar_cuenta_financiera_actual"() TO "anon";
GRANT ALL ON FUNCTION "public"."asignar_cuenta_financiera_actual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."asignar_cuenta_financiera_actual"() TO "service_role";



GRANT ALL ON FUNCTION "public"."atributos_comparables"("p_atributos" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."atributos_comparables"("p_atributos" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."atributos_comparables"("p_atributos" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bloquear_edicion_turno_cerrado"() TO "anon";
GRANT ALL ON FUNCTION "public"."bloquear_edicion_turno_cerrado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bloquear_edicion_turno_cerrado"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."calcular_egresos_turno"("p_turno_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calcular_egresos_turno"("p_turno_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."calcular_egresos_turno"("p_turno_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cambiar_slug_negocio"("p_slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cambiar_slug_negocio"("p_slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cambiar_slug_negocio"("p_slug" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cantidad_base"("p_cantidad" numeric, "p_factor" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."cantidad_base"("p_cantidad" numeric, "p_factor" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cantidad_base"("p_cantidad" numeric, "p_factor" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."categoria_en_temporada"("p_temporada" "text", "p_fecha" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."categoria_en_temporada"("p_temporada" "text", "p_fecha" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."categoria_en_temporada"("p_temporada" "text", "p_fecha" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cerrar_sesiones_usuario"("p_usuario_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cerrar_sesiones_usuario"("p_usuario_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ciclo_de_vida_negocios"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ciclo_de_vida_negocios"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ciclo_de_vida_negocios"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cobrar_pedido"("p_pedido_id" "uuid", "p_venta_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cobrar_pedido"("p_pedido_id" "uuid", "p_venta_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cobrar_pedido"("p_pedido_id" "uuid", "p_venta_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."comercios_con_uso"() TO "anon";
GRANT ALL ON FUNCTION "public"."comercios_con_uso"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."comercios_con_uso"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."composicion_ticket"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."composicion_ticket"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."composicion_ticket"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."composicion_ticket"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."configurar_pedidos_a_caja"("p_activo" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."configurar_pedidos_a_caja"("p_activo" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."configurar_pedidos_a_caja"("p_activo" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."confirmar_egreso_programado"("p_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_cuenta_origen_id" "uuid", "p_turno_caja_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."confirmar_egreso_programado"("p_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_cuenta_origen_id" "uuid", "p_turno_caja_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirmar_egreso_programado"("p_id" "uuid", "p_monto" numeric, "p_fecha_pago" "date", "p_cuenta_origen_id" "uuid", "p_turno_caja_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."contexto_sesion"() TO "anon";
GRANT ALL ON FUNCTION "public"."contexto_sesion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."contexto_sesion"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."corregir_metodo_pago_cobro_cc"("p_pago_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."corregir_metodo_pago_cobro_cc"("p_pago_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."corregir_metodo_pago_cobro_cc"("p_pago_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."corregir_metodo_pago_cobro_cc"("p_pago_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."corregir_metodo_pago_venta"("p_venta_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."corregir_metodo_pago_venta"("p_venta_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."corregir_metodo_pago_venta"("p_venta_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."corregir_metodo_pago_venta"("p_venta_id" "uuid", "p_metodo_pago_id" "uuid", "p_motivo" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_plan" "text", "p_modalidad" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_plan" "text", "p_modalidad" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_plan" "text", "p_modalidad" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_whatsapp" "text", "p_rubro_comercial" "text", "p_tamano_equipo" "text", "p_rubro" "text", "p_razon_social" "text", "p_cuit" "text", "p_condicion_iva" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_whatsapp" "text", "p_rubro_comercial" "text", "p_tamano_equipo" "text", "p_rubro" "text", "p_razon_social" "text", "p_cuit" "text", "p_condicion_iva" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_negocio_con_owner"("p_nombre" "text", "p_slug" "text", "p_whatsapp" "text", "p_rubro_comercial" "text", "p_tamano_equipo" "text", "p_rubro" "text", "p_razon_social" "text", "p_cuit" "text", "p_condicion_iva" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."crear_pedido"("p_items" "jsonb", "p_cliente_id" "uuid", "p_total_estimado" numeric, "p_nota" "text", "p_contexto" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_pedido"("p_items" "jsonb", "p_cliente_id" "uuid", "p_total_estimado" numeric, "p_nota" "text", "p_contexto" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_pedido"("p_items" "jsonb", "p_cliente_id" "uuid", "p_total_estimado" numeric, "p_nota" "text", "p_contexto" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."crear_productos_desde_remito"("p_orden_id" "uuid", "p_items" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."crear_productos_desde_remito"("p_orden_id" "uuid", "p_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."crear_productos_desde_remito"("p_orden_id" "uuid", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."crear_productos_desde_remito"("p_orden_id" "uuid", "p_items" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cuenta_actual_venta_pago"("p_negocio_id" "uuid", "p_metodo_tipo" "text", "p_acreditacion_dias" integer, "p_cuenta_destino_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cuenta_actual_venta_pago"("p_negocio_id" "uuid", "p_metodo_tipo" "text", "p_acreditacion_dias" integer, "p_cuenta_destino_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cuenta_actual_venta_pago"("p_negocio_id" "uuid", "p_metodo_tipo" "text", "p_acreditacion_dias" integer, "p_cuenta_destino_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cuenta_actual_venta_pago"("p_negocio_id" "uuid", "p_metodo_tipo" "text", "p_acreditacion_dias" integer, "p_cuenta_destino_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cuenta_financiera_sistema"("p_negocio_id" "uuid", "p_codigo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cuenta_financiera_sistema"("p_negocio_id" "uuid", "p_codigo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cuenta_financiera_sistema"("p_negocio_id" "uuid", "p_codigo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cuenta_financiera_sistema"("p_negocio_id" "uuid", "p_codigo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."curva_de_precio"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."curva_de_precio"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."curva_de_precio"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."curva_de_precio"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_access_token_hook"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."dar_de_baja_mails"("p_envio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."dar_de_baja_mails"("p_envio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dar_de_baja_mails"("p_envio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."desmarcar_alerta_caja_revisada"("p_clave" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."desmarcar_alerta_caja_revisada"("p_clave" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."desmarcar_alerta_caja_revisada"("p_clave" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."detalle_medios_pago_dia"("p_fecha" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."detalle_medios_pago_dia"("p_fecha" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."detalle_medios_pago_dia"("p_fecha" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."deuda_cc_vencida"("p_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."deuda_cc_vencida"("p_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deuda_cc_vencida"("p_cliente_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."devolver_unidades_venta"("p_venta_id" "uuid", "p_a_stock" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."devolver_unidades_venta"("p_venta_id" "uuid", "p_a_stock" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."devolver_unidades_venta"("p_venta_id" "uuid", "p_a_stock" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."devolver_unidades_venta"("p_venta_id" "uuid", "p_a_stock" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."editar_empleado"("p_usuario_id" "uuid", "p_nombre" "text", "p_email" "text", "p_rol_id" "uuid", "p_cerrar_sesiones" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."editar_empleado"("p_usuario_id" "uuid", "p_nombre" "text", "p_email" "text", "p_rol_id" "uuid", "p_cerrar_sesiones" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."editar_empleado"("p_usuario_id" "uuid", "p_nombre" "text", "p_email" "text", "p_rol_id" "uuid", "p_cerrar_sesiones" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."efectivo_actual_turnos"("p_turno_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."efectivo_actual_turnos"("p_turno_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."efectivo_actual_turnos"("p_turno_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."egreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."egreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."egreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."egresos_solo_descriptivo_editable"() TO "anon";
GRANT ALL ON FUNCTION "public"."egresos_solo_descriptivo_editable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."egresos_solo_descriptivo_editable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."eliminar_productos"("p_producto_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."eliminar_productos"("p_producto_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."eliminar_productos"("p_producto_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."embudo_de_alta"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."embudo_de_alta"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."embudo_de_alta"() TO "service_role";



GRANT ALL ON FUNCTION "public"."emitir_comprobante_venta"("p_venta_id" "uuid", "p_tipo" "text", "p_punto_venta" integer, "p_total" numeric, "p_emitido_por" "uuid", "p_cliente_id" "uuid", "p_receptor_razon_social" "text", "p_receptor_cuit" "text", "p_receptor_condicion_iva" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."emitir_comprobante_venta"("p_venta_id" "uuid", "p_tipo" "text", "p_punto_venta" integer, "p_total" numeric, "p_emitido_por" "uuid", "p_cliente_id" "uuid", "p_receptor_razon_social" "text", "p_receptor_cuit" "text", "p_receptor_condicion_iva" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."emitir_comprobante_venta"("p_venta_id" "uuid", "p_tipo" "text", "p_punto_venta" integer, "p_total" numeric, "p_emitido_por" "uuid", "p_cliente_id" "uuid", "p_receptor_razon_social" "text", "p_receptor_cuit" "text", "p_receptor_condicion_iva" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."estado_activacion"() TO "anon";
GRANT ALL ON FUNCTION "public"."estado_activacion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."estado_activacion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."estado_activacion_de"("p_negocio" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."estado_activacion_de"("p_negocio" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."estado_activacion_de"("p_negocio" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."estado_cuentas_financieras"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."estado_cuentas_financieras"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."estado_cuentas_financieras"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."flujo_caja_turno"("p_turno_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."flujo_caja_turno"("p_turno_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flujo_caja_turno"("p_turno_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."funnel_comerz"() TO "anon";
GRANT ALL ON FUNCTION "public"."funnel_comerz"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."funnel_comerz"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fusionar_productos"("p_origen" "uuid", "p_destino" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fusionar_productos"("p_origen" "uuid", "p_destino" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fusionar_productos"("p_origen" "uuid", "p_destino" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_variantes_producto"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_variantes_producto"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."guardar_variantes_producto"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."guardar_variantes_producto"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guardar_variantes_producto_impl"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guardar_variantes_producto_impl"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."guardar_variantes_producto_impl"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."guardar_variantes_producto_impl"("p_producto_id" "uuid", "p_negocio_id" "uuid", "p_variantes" "jsonb", "p_editado_por" "uuid", "p_confirmadas_eliminar" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."impedir_mutacion_movimiento_financiero"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."impedir_mutacion_movimiento_financiero"() TO "anon";
GRANT ALL ON FUNCTION "public"."impedir_mutacion_movimiento_financiero"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."impedir_mutacion_movimiento_financiero"() TO "service_role";



GRANT ALL ON FUNCTION "public"."importar_productos_planilla"("p_negocio_id" "uuid", "p_items" "jsonb", "p_hash" "text", "p_nombre_archivo" "text", "p_forzar" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."importar_productos_planilla"("p_negocio_id" "uuid", "p_items" "jsonb", "p_hash" "text", "p_nombre_archivo" "text", "p_forzar" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."importar_productos_planilla"("p_negocio_id" "uuid", "p_items" "jsonb", "p_hash" "text", "p_nombre_archivo" "text", "p_forzar" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."importe_financiero_venta_pago"("p_metodo_tipo" "text", "p_monto_bruto" numeric, "p_monto_neto" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."importe_financiero_venta_pago"("p_metodo_tipo" "text", "p_monto_bruto" numeric, "p_monto_neto" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."importe_financiero_venta_pago"("p_metodo_tipo" "text", "p_monto_bruto" numeric, "p_monto_neto" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."importe_financiero_venta_pago"("p_metodo_tipo" "text", "p_monto_bruto" numeric, "p_monto_neto" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."ingreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."ingreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingreso_impacto_resultado"("p_tipo" "text", "p_monto" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."limite_plan"("clave" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."limite_plan"("clave" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."limite_plan"("clave" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."marcar_alerta_caja_revisada"("p_clave" "text", "p_nota" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_alerta_caja_revisada"("p_clave" "text", "p_nota" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_alerta_caja_revisada"("p_clave" "text", "p_nota" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."marcar_aprobacion_orden"() TO "anon";
GRANT ALL ON FUNCTION "public"."marcar_aprobacion_orden"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_aprobacion_orden"() TO "service_role";



GRANT ALL ON FUNCTION "public"."marcar_cambio_de_estado"() TO "anon";
GRANT ALL ON FUNCTION "public"."marcar_cambio_de_estado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_cambio_de_estado"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."marcar_origen_movimiento"("p_origen" "text", "p_referencia" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_origen_movimiento"("p_origen" "text", "p_referencia" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."marcar_origen_movimiento"("p_origen" "text", "p_referencia" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_origen_movimiento"("p_origen" "text", "p_referencia" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."marcar_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."marcar_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."margen_realizado"("p_desde" "date", "p_hasta" "date", "p_periodo" "text", "p_limite" integer, "p_min_unidades" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."margen_realizado"("p_desde" "date", "p_hasta" "date", "p_periodo" "text", "p_limite" integer, "p_min_unidades" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."margen_realizado"("p_desde" "date", "p_hasta" "date", "p_periodo" "text", "p_limite" integer, "p_min_unidades" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."margen_realizado"("p_desde" "date", "p_hasta" "date", "p_periodo" "text", "p_limite" integer, "p_min_unidades" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."metricas_globales_comerz"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."metricas_globales_comerz"() TO "anon";
GRANT ALL ON FUNCTION "public"."metricas_globales_comerz"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."metricas_globales_comerz"() TO "service_role";



GRANT ALL ON FUNCTION "public"."modulo_presupuestos_habilitado"() TO "anon";
GRANT ALL ON FUNCTION "public"."modulo_presupuestos_habilitado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."modulo_presupuestos_habilitado"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."movimientos_de_cuenta"("p_cuenta_id" "uuid", "p_limite" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."movimientos_de_cuenta"("p_cuenta_id" "uuid", "p_limite" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."movimientos_de_cuenta"("p_cuenta_id" "uuid", "p_limite" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."movimientos_digitales_turno"("p_turno_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."movimientos_digitales_turno"("p_turno_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."movimientos_digitales_turno"("p_turno_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."movimientos_financieros_negocio"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_cuenta_id" "uuid", "p_origen_tipos" "text"[], "p_categoria_id" "uuid", "p_sin_categoria" boolean, "p_metodo_pago_id" "uuid", "p_usuario_id" "uuid", "p_busqueda" "text", "p_limite" integer, "p_offset" integer, "p_vista" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."movimientos_financieros_negocio"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_cuenta_id" "uuid", "p_origen_tipos" "text"[], "p_categoria_id" "uuid", "p_sin_categoria" boolean, "p_metodo_pago_id" "uuid", "p_usuario_id" "uuid", "p_busqueda" "text", "p_limite" integer, "p_offset" integer, "p_vista" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."movimientos_financieros_negocio"("p_desde" timestamp with time zone, "p_hasta" timestamp with time zone, "p_cuenta_id" "uuid", "p_origen_tipos" "text"[], "p_categoria_id" "uuid", "p_sin_categoria" boolean, "p_metodo_pago_id" "uuid", "p_usuario_id" "uuid", "p_busqueda" "text", "p_limite" integer, "p_offset" integer, "p_vista" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."negocio_actual"() TO "anon";
GRANT ALL ON FUNCTION "public"."negocio_actual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."negocio_actual"() TO "service_role";



GRANT ALL ON FUNCTION "public"."omitir_egreso_programado"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."omitir_egreso_programado"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."omitir_egreso_programado"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pedidos_broadcast_cambio"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pedidos_broadcast_cambio"() TO "service_role";



GRANT ALL ON FUNCTION "public"."pesos_ar"("p_monto" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."pesos_ar"("p_monto" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pesos_ar"("p_monto" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."posicion_dinero"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."posicion_dinero"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."posicion_dinero"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."posicion_dinero_ledger"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."posicion_dinero_ledger"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."posicion_dinero_ledger"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."posicion_dinero_ledger"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."previsualizar_fusion_productos"("p_origen" "uuid", "p_destino" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."previsualizar_fusion_productos"("p_origen" "uuid", "p_destino" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."previsualizar_fusion_productos"("p_origen" "uuid", "p_destino" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."producto_presentaciones_tocar_producto"() TO "anon";
GRANT ALL ON FUNCTION "public"."producto_presentaciones_tocar_producto"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."producto_presentaciones_tocar_producto"() TO "service_role";



GRANT ALL ON FUNCTION "public"."producto_presentaciones_validar"() TO "anon";
GRANT ALL ON FUNCTION "public"."producto_presentaciones_validar"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."producto_presentaciones_validar"() TO "service_role";



GRANT ALL ON FUNCTION "public"."puede_fiar"("p_cliente" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."puede_fiar"("p_cliente" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."puede_fiar"("p_cliente" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."quitar_empleado"("p_usuario_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."quitar_empleado"("p_usuario_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."quitar_empleado"("p_usuario_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."recalcular_vencimiento_cc"("p_cliente_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."recalcular_vencimiento_cc"("p_cliente_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalcular_vencimiento_cc"("p_cliente_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_acreditacion_financiera"("p_cuenta_destino_id" "uuid", "p_venta_pago_ids" "uuid"[], "p_fecha_acreditacion" timestamp with time zone, "p_referencia" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_acreditacion_financiera"("p_cuenta_destino_id" "uuid", "p_venta_pago_ids" "uuid"[], "p_fecha_acreditacion" timestamp with time zone, "p_referencia" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_acreditacion_financiera"("p_cuenta_destino_id" "uuid", "p_venta_pago_ids" "uuid"[], "p_fecha_acreditacion" timestamp with time zone, "p_referencia" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_acreditacion_financiera"("p_cuenta_destino_id" "uuid", "p_venta_pago_ids" "uuid"[], "p_fecha_acreditacion" timestamp with time zone, "p_referencia" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_bitacora_egreso"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_bitacora_egreso"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_bitacora_egreso"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_bitacora_egreso"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_bitacora_turno_caja"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_bitacora_turno_caja"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_bitacora_turno_caja"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_bitacora_turno_caja"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_bitacora_venta_pago"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_bitacora_venta_pago"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_bitacora_venta_pago"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_bitacora_venta_pago"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_borrado_catalogo"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_borrado_catalogo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_borrado_catalogo"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_cobro_cc"("p_pago" "jsonb", "p_mora" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_cobro_cc"("p_pago" "jsonb", "p_mora" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_cobro_cc"("p_pago" "jsonb", "p_mora" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_devolucion"("p_venta_id" "uuid", "p_lineas" "jsonb", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_turno_id" "uuid", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_devolucion"("p_venta_id" "uuid", "p_lineas" "jsonb", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_turno_id" "uuid", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_devolucion"("p_venta_id" "uuid", "p_lineas" "jsonb", "p_motivo_codigo" "text", "p_motivo_detalle" "text", "p_turno_id" "uuid", "p_reintegro_metodo_id" "uuid", "p_reintegro_a_cuenta" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_evento_negocio"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_evento_negocio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_evento_negocio"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_evento_pago"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_evento_pago"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_evento_pago"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_evento_solicitud_plan"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_evento_solicitud_plan"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_evento_solicitud_plan"() TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_factura_de_venta"("p_venta_id" "uuid", "p_comprobante" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_factura_de_venta"("p_venta_id" "uuid", "p_comprobante" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_factura_de_venta"("p_venta_id" "uuid", "p_comprobante" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_ingreso_financiero"("p_monto" numeric, "p_tipo" "text", "p_concepto" "text", "p_cuenta_id" "uuid", "p_turno_caja_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_ingreso_financiero"("p_monto" numeric, "p_tipo" "text", "p_concepto" "text", "p_cuenta_id" "uuid", "p_turno_caja_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_ingreso_financiero"("p_monto" numeric, "p_tipo" "text", "p_concepto" "text", "p_cuenta_id" "uuid", "p_turno_caja_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_movimiento_stock"() TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_movimiento_stock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_movimiento_stock"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_paso_onboarding"("p_paso" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_paso_onboarding"("p_paso" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_paso_onboarding"("p_paso" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_saldo_inicial_cuenta"("p_cuenta_id" "uuid", "p_monto" numeric, "p_detalle" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_saldo_inicial_cuenta"("p_cuenta_id" "uuid", "p_monto" numeric, "p_detalle" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_saldo_inicial_cuenta"("p_cuenta_id" "uuid", "p_monto" numeric, "p_detalle" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_transferencia_financiera"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_transferencia_financiera"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_transferencia_financiera"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_transferencia_financiera_impl"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid", "p_revierte_a" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_transferencia_financiera_impl"("p_cuenta_origen_id" "uuid", "p_cuenta_destino_id" "uuid", "p_monto" numeric, "p_concepto" "text", "p_turno_caja_id" "uuid", "p_revierte_a" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_venta"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_venta"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_venta"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_venta"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."registrar_venta_facturada"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[], "p_comprobante" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."registrar_venta_facturada"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[], "p_comprobante" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_venta_facturada"("p_venta" "jsonb", "p_pagos" "jsonb", "p_items" "jsonb", "p_stock_legacy" "jsonb", "p_descuento" "jsonb", "p_cc" "jsonb", "p_reserva_ids" "uuid"[], "p_comprobante" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."reglas_negocio"("p_negocio" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reglas_negocio"("p_negocio" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reglas_negocio"("p_negocio" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reglas_plan"() TO "anon";
GRANT ALL ON FUNCTION "public"."reglas_plan"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reglas_plan"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rentabilidad_por_metodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rentabilidad_por_metodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rentabilidad_por_metodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rentabilidad_por_metodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolver_medio_reintegro"("p_metodo_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolver_medio_reintegro"("p_metodo_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolver_medio_reintegro"("p_metodo_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."resumen_cuenta_por_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resumen_cuenta_por_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resumen_cuenta_por_token"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resumen_financiero_periodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resumen_financiero_periodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resumen_financiero_periodo"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resumen_gerencial_caja"("p_fecha" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resumen_gerencial_caja"("p_fecha" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resumen_gerencial_caja"("p_fecha" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resumen_remitos_financiero"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resumen_remitos_financiero"() TO "anon";
GRANT ALL ON FUNCTION "public"."resumen_remitos_financiero"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."resumen_remitos_financiero"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."revertir_transferencia_financiera"("p_transferencia_id" "uuid", "p_motivo" "text", "p_turno_caja_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revertir_transferencia_financiera"("p_transferencia_id" "uuid", "p_motivo" "text", "p_turno_caja_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."revertir_transferencia_financiera"("p_transferencia_id" "uuid", "p_motivo" "text", "p_turno_caja_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revertir_transferencia_financiera"("p_transferencia_id" "uuid", "p_motivo" "text", "p_turno_caja_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revertir_unidades_serie"("p_venta_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revertir_unidades_serie"("p_venta_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."revertir_unidades_serie"("p_venta_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revertir_unidades_serie"("p_venta_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rol_actual"() TO "anon";
GRANT ALL ON FUNCTION "public"."rol_actual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rol_actual"() TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_catalogo_electro"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_catalogo_electro"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_catalogo_electro"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sembrar_categorias_egreso"("p_negocio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sembrar_categorias_egreso"("p_negocio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sembrar_categorias_egreso"("p_negocio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sembrar_categorias_egreso"("p_negocio_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sembrar_categorias_egreso_nuevo_negocio"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sembrar_categorias_egreso_nuevo_negocio"() TO "anon";
GRANT ALL ON FUNCTION "public"."sembrar_categorias_egreso_nuevo_negocio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sembrar_categorias_egreso_nuevo_negocio"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sembrar_cuentas_financieras_nuevo_negocio"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sembrar_cuentas_financieras_nuevo_negocio"() TO "anon";
GRANT ALL ON FUNCTION "public"."sembrar_cuentas_financieras_nuevo_negocio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sembrar_cuentas_financieras_nuevo_negocio"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sembrar_cuentas_financieras_sistema"("p_negocio_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sembrar_cuentas_financieras_sistema"("p_negocio_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sembrar_cuentas_financieras_sistema"("p_negocio_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sembrar_cuentas_financieras_sistema"("p_negocio_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."siguiente_fecha_programada"("p_fecha" "date", "p_frecuencia" "text", "p_dia_ancla" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."siguiente_fecha_programada"("p_fecha" "date", "p_frecuencia" "text", "p_dia_ancla" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."siguiente_fecha_programada"("p_fecha" "date", "p_frecuencia" "text", "p_dia_ancla" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."siguiente_numero_comprobante"("p_punto_venta" integer, "p_tipo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."siguiente_numero_comprobante"("p_punto_venta" integer, "p_tipo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."siguiente_numero_comprobante"("p_punto_venta" integer, "p_tipo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "security"."current_negocio_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."current_negocio_id"() TO "authenticated";



GRANT ALL ON TABLE "public"."egresos" TO "authenticated";
GRANT ALL ON TABLE "public"."egresos" TO "service_role";



REVOKE ALL ON FUNCTION "public"."snapshot_financiero_egreso"("e" "public"."egresos") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snapshot_financiero_egreso"("e" "public"."egresos") TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_financiero_egreso"("e" "public"."egresos") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_financiero_egreso"("e" "public"."egresos") TO "service_role";



GRANT ALL ON TABLE "public"."venta_pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."venta_pagos" TO "service_role";



REVOKE ALL ON FUNCTION "public"."snapshot_financiero_venta_pago"("p" "public"."venta_pagos") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snapshot_financiero_venta_pago"("p" "public"."venta_pagos") TO "anon";
GRANT ALL ON FUNCTION "public"."snapshot_financiero_venta_pago"("p" "public"."venta_pagos") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snapshot_financiero_venta_pago"("p" "public"."venta_pagos") TO "service_role";



GRANT ALL ON FUNCTION "public"."sugerencias_valores_atributo"("p_nombre" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sugerencias_valores_atributo"("p_nombre" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sugerencias_valores_atributo"("p_nombre" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sugerir_productos_similares"("p_raw_nombres" "text"[], "p_umbral" real, "p_max_por_nombre" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sugerir_productos_similares"("p_raw_nombres" "text"[], "p_umbral" real, "p_max_por_nombre" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sugerir_productos_similares"("p_raw_nombres" "text"[], "p_umbral" real, "p_max_por_nombre" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."tiene_feature"("clave" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tiene_feature"("clave" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tiene_feature"("clave" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tiene_permiso"("clave" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."tiene_permiso"("clave" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tiene_permiso"("clave" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."totales_ventas_por_turno"("p_turno_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."totales_ventas_por_turno"("p_turno_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."totales_ventas_por_turno"("p_turno_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."transferencias_caja_turno"("p_turno_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transferencias_caja_turno"("p_turno_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transferencias_caja_turno"("p_turno_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ultimo_movimiento_turno"("p_turno_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ultimo_movimiento_turno"("p_turno_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ultimo_movimiento_turno"("p_turno_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_immutable"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_immutable"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_immutable"("text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validar_cuenta_origen_egreso"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validar_cuenta_origen_egreso"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_cuenta_origen_egreso"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_cuenta_origen_egreso"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_limite_cc_manual"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_limite_cc_manual"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_limite_cc_manual"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_limite_productos"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_limite_productos"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_limite_productos"() TO "service_role";



GRANT ALL ON FUNCTION "public"."validar_limite_usuarios"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_limite_usuarios"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_limite_usuarios"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validar_saldo_caja_arqueada"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validar_saldo_caja_arqueada"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."validar_turno_egreso_arqueado"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validar_turno_egreso_arqueado"() TO "anon";
GRANT ALL ON FUNCTION "public"."validar_turno_egreso_arqueado"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validar_turno_egreso_arqueado"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."vender_unidades_serie"("p_venta_id" "uuid", "p_unidades" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."vender_unidades_serie"("p_venta_id" "uuid", "p_unidades" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."vender_unidades_serie"("p_venta_id" "uuid", "p_unidades" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vender_unidades_serie"("p_venta_id" "uuid", "p_unidades" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."ventas_facturadas"("p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ventas_facturadas"("p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ventas_facturadas"("p_periodo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ventas_por_momento"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ventas_por_momento"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ventas_por_momento"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ventas_por_momento"("p_desde" "date", "p_hasta" "date", "p_periodo" "text") TO "service_role";



GRANT ALL ON FUNCTION "security"."comparte_negocio"("p_usuario" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "security"."current_user_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."current_user_id"() TO "authenticated";



REVOKE ALL ON FUNCTION "security"."es_super_admin"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."es_super_admin"("p_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "security"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."is_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "security"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."is_super_admin"() TO "authenticated";



GRANT ALL ON FUNCTION "security"."negocio_publico"() TO "anon";



REVOKE ALL ON FUNCTION "security"."same_negocio"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "security"."same_negocio"("target" "uuid") TO "authenticated";












GRANT ALL ON TABLE "archivo"."_backup_broderie_20260731_alias" TO "service_role";



GRANT ALL ON TABLE "archivo"."_backup_broderie_20260731_stock" TO "service_role";



GRANT ALL ON TABLE "archivo"."_backup_broderie_20260731_variantes" TO "service_role";



GRANT ALL ON TABLE "archivo"."solicitudes_comercio" TO "authenticated";
GRANT ALL ON TABLE "archivo"."solicitudes_comercio" TO "service_role";



GRANT INSERT("nombre_contacto") ON TABLE "archivo"."solicitudes_comercio" TO "anon";



GRANT INSERT("whatsapp") ON TABLE "archivo"."solicitudes_comercio" TO "anon";



GRANT INSERT("nombre_comercio") ON TABLE "archivo"."solicitudes_comercio" TO "anon";



GRANT INSERT("rubro") ON TABLE "archivo"."solicitudes_comercio" TO "anon";



GRANT INSERT("rubro_otro") ON TABLE "archivo"."solicitudes_comercio" TO "anon";



GRANT INSERT("notas") ON TABLE "archivo"."solicitudes_comercio" TO "anon";









GRANT ALL ON TABLE "public"."acreditaciones_financieras" TO "authenticated";
GRANT ALL ON TABLE "public"."acreditaciones_financieras" TO "service_role";



GRANT ALL ON TABLE "public"."acreditaciones_financieras_pagos" TO "authenticated";
GRANT ALL ON TABLE "public"."acreditaciones_financieras_pagos" TO "service_role";



GRANT ALL ON TABLE "public"."actualizaciones_precio" TO "authenticated";
GRANT ALL ON TABLE "public"."actualizaciones_precio" TO "service_role";



GRANT ALL ON TABLE "public"."actualizaciones_precio_items" TO "authenticated";
GRANT ALL ON TABLE "public"."actualizaciones_precio_items" TO "service_role";



GRANT ALL ON TABLE "public"."alertas_caja_revisadas" TO "authenticated";
GRANT ALL ON TABLE "public"."alertas_caja_revisadas" TO "service_role";



GRANT ALL ON TABLE "public"."arca_credenciales" TO "service_role";



GRANT ALL ON TABLE "public"."atributo_valores" TO "authenticated";
GRANT ALL ON TABLE "public"."atributo_valores" TO "service_role";



GRANT ALL ON TABLE "public"."atributos" TO "authenticated";
GRANT ALL ON TABLE "public"."atributos" TO "service_role";



GRANT ALL ON TABLE "public"."backfill_variante_id_20260903" TO "authenticated";
GRANT ALL ON TABLE "public"."backfill_variante_id_20260903" TO "service_role";



GRANT ALL ON TABLE "public"."bajas" TO "authenticated";
GRANT ALL ON TABLE "public"."bajas" TO "service_role";



GRANT ALL ON TABLE "public"."catalogo_borrados" TO "authenticated";
GRANT ALL ON TABLE "public"."catalogo_borrados" TO "service_role";



GRANT ALL ON SEQUENCE "public"."catalogo_borrados_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."catalogo_borrados_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."catalogo_borrados_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."categoria_atributos" TO "authenticated";
GRANT ALL ON TABLE "public"."categoria_atributos" TO "service_role";



GRANT ALL ON TABLE "public"."categorias" TO "authenticated";
GRANT ALL ON TABLE "public"."categorias" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("nombre") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("slug") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("parent_id") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("descripcion") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("imagen_url") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("orden") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("activa") ON TABLE "public"."categorias" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."categorias" TO "anon";



GRANT ALL ON TABLE "public"."categorias_egreso" TO "authenticated";
GRANT ALL ON TABLE "public"."categorias_egreso" TO "service_role";



GRANT ALL ON TABLE "public"."clientes" TO "authenticated";
GRANT ALL ON TABLE "public"."clientes" TO "service_role";



GRANT ALL ON TABLE "public"."cobros_cc_correcciones" TO "authenticated";
GRANT ALL ON TABLE "public"."cobros_cc_correcciones" TO "service_role";



GRANT ALL ON TABLE "public"."comprobante_numeracion" TO "authenticated";
GRANT ALL ON TABLE "public"."comprobante_numeracion" TO "service_role";



GRANT ALL ON TABLE "public"."comprobantes" TO "authenticated";
GRANT ALL ON TABLE "public"."comprobantes" TO "service_role";



GRANT ALL ON TABLE "public"."comprobantes_iva" TO "authenticated";
GRANT ALL ON TABLE "public"."comprobantes_iva" TO "service_role";



GRANT ALL ON TABLE "public"."configuracion_pos" TO "authenticated";
GRANT ALL ON TABLE "public"."configuracion_pos" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("posName") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("whatsapp") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("direccion") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("posLogo") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("catalogo_activo") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("mostrar_precios") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("mostrar_sin_stock") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("pedidos_whatsapp") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("direccion_visible") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("horario_visible") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("banner_activo") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("instagram") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("facebook") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("horario_texto") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("banner_imagen") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("banner_titulo") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("banner_subtitulo") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("banner_boton_texto") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("banner_link") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("marquee_activo") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("marquee_texto") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("envio_costo_local") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("envio_mensaje_lejos") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("localidad_negocio") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("permitir_venta_sin_stock") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("entrega_minima_bloqueante") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("rubro") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("provincia") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("localidad") ON TABLE "public"."configuracion_pos" TO "anon";



GRANT SELECT("banner_imagen_desktop") ON TABLE "public"."configuracion_pos" TO "anon";
GRANT SELECT("banner_imagen_desktop"),INSERT("banner_imagen_desktop"),UPDATE("banner_imagen_desktop") ON TABLE "public"."configuracion_pos" TO "authenticated";



GRANT SELECT("banner_focal_x") ON TABLE "public"."configuracion_pos" TO "anon";
GRANT SELECT("banner_focal_x"),INSERT("banner_focal_x"),UPDATE("banner_focal_x") ON TABLE "public"."configuracion_pos" TO "authenticated";



GRANT SELECT("banner_focal_y") ON TABLE "public"."configuracion_pos" TO "anon";
GRANT SELECT("banner_focal_y"),INSERT("banner_focal_y"),UPDATE("banner_focal_y") ON TABLE "public"."configuracion_pos" TO "authenticated";



GRANT SELECT("banner_focal_desktop_x") ON TABLE "public"."configuracion_pos" TO "anon";
GRANT SELECT("banner_focal_desktop_x"),INSERT("banner_focal_desktop_x"),UPDATE("banner_focal_desktop_x") ON TABLE "public"."configuracion_pos" TO "authenticated";



GRANT SELECT("banner_focal_desktop_y") ON TABLE "public"."configuracion_pos" TO "anon";
GRANT SELECT("banner_focal_desktop_y"),INSERT("banner_focal_desktop_y"),UPDATE("banner_focal_desktop_y") ON TABLE "public"."configuracion_pos" TO "authenticated";



GRANT ALL ON TABLE "public"."cuenta_corriente_movimientos" TO "authenticated";
GRANT ALL ON TABLE "public"."cuenta_corriente_movimientos" TO "service_role";



GRANT ALL ON TABLE "public"."cuentas_financieras" TO "authenticated";
GRANT ALL ON TABLE "public"."cuentas_financieras" TO "service_role";



GRANT ALL ON TABLE "public"."devoluciones" TO "authenticated";
GRANT ALL ON TABLE "public"."devoluciones" TO "service_role";



GRANT ALL ON TABLE "public"."devoluciones_items" TO "authenticated";
GRANT ALL ON TABLE "public"."devoluciones_items" TO "service_role";



GRANT ALL ON TABLE "public"."diccionario_alias" TO "authenticated";
GRANT ALL ON TABLE "public"."diccionario_alias" TO "service_role";



GRANT ALL ON TABLE "public"."egresos_programados" TO "authenticated";
GRANT ALL ON TABLE "public"."egresos_programados" TO "service_role";



GRANT ALL ON TABLE "public"."email_bajas" TO "service_role";
GRANT SELECT ON TABLE "public"."email_bajas" TO "authenticated";



GRANT ALL ON TABLE "public"."envios_email" TO "authenticated";
GRANT ALL ON TABLE "public"."envios_email" TO "service_role";



GRANT ALL ON TABLE "public"."eventos_comerz" TO "authenticated";
GRANT ALL ON TABLE "public"."eventos_comerz" TO "service_role";



GRANT ALL ON TABLE "public"."eventos_uso" TO "authenticated";
GRANT ALL ON TABLE "public"."eventos_uso" TO "service_role";



GRANT ALL ON TABLE "public"."gastos_comerz" TO "authenticated";
GRANT ALL ON TABLE "public"."gastos_comerz" TO "service_role";



GRANT ALL ON TABLE "public"."importaciones_productos" TO "authenticated";
GRANT ALL ON TABLE "public"."importaciones_productos" TO "service_role";



GRANT ALL ON TABLE "public"."ingresos_financieros" TO "authenticated";
GRANT ALL ON TABLE "public"."ingresos_financieros" TO "service_role";



GRANT ALL ON TABLE "public"."invitaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."invitaciones" TO "service_role";



GRANT ALL ON TABLE "public"."listas_precios" TO "authenticated";
GRANT ALL ON TABLE "public"."listas_precios" TO "service_role";



GRANT ALL ON TABLE "public"."metodos_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."metodos_pago" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."metodos_pago" TO "anon";



GRANT SELECT("nombre") ON TABLE "public"."metodos_pago" TO "anon";



GRANT SELECT("tipo") ON TABLE "public"."metodos_pago" TO "anon";



GRANT SELECT("activo") ON TABLE "public"."metodos_pago" TO "anon";



GRANT SELECT("recargo_porcentaje") ON TABLE "public"."metodos_pago" TO "anon";



GRANT ALL ON TABLE "public"."movimientos_financieros" TO "authenticated";
GRANT ALL ON TABLE "public"."movimientos_financieros" TO "service_role";



GRANT ALL ON SEQUENCE "public"."movimientos_financieros_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."movimientos_financieros_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."movimientos_financieros_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."movimientos_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."movimientos_stock" TO "service_role";



GRANT ALL ON TABLE "public"."negocios" TO "authenticated";
GRANT ALL ON TABLE "public"."negocios" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."negocios" TO "anon";



GRANT SELECT("nombre") ON TABLE "public"."negocios" TO "anon";



GRANT SELECT("logo_url") ON TABLE "public"."negocios" TO "anon";



GRANT SELECT("estado") ON TABLE "public"."negocios" TO "anon";



GRANT SELECT("slug") ON TABLE "public"."negocios" TO "anon";



GRANT UPDATE("rubro_comercial") ON TABLE "public"."negocios" TO "authenticated";



GRANT UPDATE("tamano_equipo") ON TABLE "public"."negocios" TO "authenticated";



GRANT UPDATE("modulo_presupuestos") ON TABLE "public"."negocios" TO "authenticated";



GRANT ALL ON TABLE "public"."onboarding_pasos_vistos" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_pasos_vistos" TO "service_role";



GRANT ALL ON TABLE "public"."ordenes_borradores" TO "authenticated";
GRANT ALL ON TABLE "public"."ordenes_borradores" TO "service_role";



GRANT ALL ON TABLE "public"."ordenes_compra" TO "authenticated";
GRANT ALL ON TABLE "public"."ordenes_compra" TO "service_role";



GRANT ALL ON TABLE "public"."ordenes_items" TO "authenticated";
GRANT ALL ON TABLE "public"."ordenes_items" TO "service_role";



GRANT ALL ON TABLE "public"."pagos_suscripcion" TO "authenticated";
GRANT ALL ON TABLE "public"."pagos_suscripcion" TO "service_role";



GRANT ALL ON TABLE "public"."pedidos" TO "authenticated";
GRANT ALL ON TABLE "public"."pedidos" TO "service_role";



GRANT ALL ON TABLE "public"."pedidos_numeracion" TO "authenticated";
GRANT ALL ON TABLE "public"."pedidos_numeracion" TO "service_role";



GRANT ALL ON TABLE "public"."perfiles" TO "authenticated";
GRANT ALL ON TABLE "public"."perfiles" TO "service_role";



GRANT ALL ON TABLE "public"."permisos" TO "authenticated";
GRANT ALL ON TABLE "public"."permisos" TO "service_role";



GRANT ALL ON TABLE "public"."planes" TO "authenticated";
GRANT ALL ON TABLE "public"."planes" TO "service_role";



GRANT ALL ON TABLE "public"."producto_precios" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_precios" TO "service_role";



GRANT ALL ON TABLE "public"."producto_presentaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_presentaciones" TO "service_role";



GRANT ALL ON TABLE "public"."producto_variante_valores" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_variante_valores" TO "service_role";



GRANT ALL ON TABLE "public"."producto_variantes" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_variantes" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("producto_id") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("sku") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("nombre_display") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("precio") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("stock") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("activa") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("atributos") ON TABLE "public"."producto_variantes" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."producto_variantes" TO "anon";



GRANT ALL ON TABLE "public"."producto_variantes_auditoria" TO "authenticated";
GRANT ALL ON TABLE "public"."producto_variantes_auditoria" TO "service_role";



GRANT ALL ON TABLE "public"."productos" TO "authenticated";
GRANT ALL ON TABLE "public"."productos" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("nombre") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("tipo") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("precio") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("imagen_url") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("creado_en") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("publicado") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("slug") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("descripcion") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("categoria_id") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("atributos_globales") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("thumbnail_url") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("grid_url") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("marca") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("modelo") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("unidad_medida") ON TABLE "public"."productos" TO "anon";



GRANT SELECT("genero") ON TABLE "public"."productos" TO "anon";



GRANT UPDATE("master_url") ON TABLE "public"."productos" TO "authenticated";



GRANT SELECT("destacado_en") ON TABLE "public"."productos" TO "anon";



GRANT ALL ON TABLE "public"."productos_precio_efectivo" TO "authenticated";
GRANT ALL ON TABLE "public"."productos_precio_efectivo" TO "service_role";



GRANT ALL ON TABLE "public"."productos_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."productos_stock" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."productos_stock" TO "anon";



GRANT SELECT("producto_id") ON TABLE "public"."productos_stock" TO "anon";



GRANT SELECT("variante") ON TABLE "public"."productos_stock" TO "anon";



GRANT SELECT("cantidad") ON TABLE "public"."productos_stock" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."productos_stock" TO "anon";



GRANT ALL ON TABLE "public"."promociones" TO "authenticated";
GRANT ALL ON TABLE "public"."promociones" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("nombre") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("descripcion") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("tipo_regla") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("tipo_descuento") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("valor_descuento") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("monto_minimo") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("fecha_inicio") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("fecha_fin") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("activa") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("acumulable") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("prioridad") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("mostrar_en_catalogo") ON TABLE "public"."promociones" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."promociones" TO "anon";



GRANT ALL ON TABLE "public"."promociones_categorias" TO "authenticated";
GRANT ALL ON TABLE "public"."promociones_categorias" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."promociones_categorias" TO "anon";



GRANT SELECT("promocion_id") ON TABLE "public"."promociones_categorias" TO "anon";



GRANT SELECT("categoria_nombre") ON TABLE "public"."promociones_categorias" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."promociones_categorias" TO "anon";



GRANT ALL ON TABLE "public"."promociones_metodos_pago" TO "authenticated";
GRANT ALL ON TABLE "public"."promociones_metodos_pago" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."promociones_metodos_pago" TO "anon";



GRANT SELECT("promocion_id") ON TABLE "public"."promociones_metodos_pago" TO "anon";



GRANT SELECT("metodo_pago") ON TABLE "public"."promociones_metodos_pago" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."promociones_metodos_pago" TO "anon";



GRANT ALL ON TABLE "public"."promociones_productos" TO "authenticated";
GRANT ALL ON TABLE "public"."promociones_productos" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."promociones_productos" TO "anon";



GRANT SELECT("promocion_id") ON TABLE "public"."promociones_productos" TO "anon";



GRANT SELECT("producto_id") ON TABLE "public"."promociones_productos" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."promociones_productos" TO "anon";



GRANT ALL ON TABLE "public"."ventas" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas" TO "service_role";



GRANT ALL ON TABLE "public"."reintegros_al_cliente" TO "authenticated";
GRANT ALL ON TABLE "public"."reintegros_al_cliente" TO "service_role";



GRANT ALL ON TABLE "public"."reservas" TO "authenticated";
GRANT ALL ON TABLE "public"."reservas" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."reservas" TO "anon";



GRANT SELECT("variante_id") ON TABLE "public"."reservas" TO "anon";



GRANT SELECT("estado") ON TABLE "public"."reservas" TO "anon";



GRANT SELECT("negocio_id") ON TABLE "public"."reservas" TO "anon";



GRANT ALL ON TABLE "public"."rol_permisos" TO "authenticated";
GRANT ALL ON TABLE "public"."rol_permisos" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."slugs_historicos" TO "authenticated";
GRANT ALL ON TABLE "public"."slugs_historicos" TO "service_role";
GRANT SELECT ON TABLE "public"."slugs_historicos" TO "anon";



GRANT ALL ON TABLE "public"."solicitudes_plan" TO "authenticated";
GRANT ALL ON TABLE "public"."solicitudes_plan" TO "service_role";



GRANT ALL ON TABLE "public"."transferencias_financieras" TO "authenticated";
GRANT ALL ON TABLE "public"."transferencias_financieras" TO "service_role";



GRANT ALL ON TABLE "public"."turnos_caja" TO "authenticated";
GRANT ALL ON TABLE "public"."turnos_caja" TO "service_role";



GRANT ALL ON TABLE "public"."unidades_serie" TO "authenticated";
GRANT ALL ON TABLE "public"."unidades_serie" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios_negocios" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios_negocios" TO "service_role";



GRANT ALL ON TABLE "public"."usuarios_prueba" TO "authenticated";
GRANT ALL ON TABLE "public"."usuarios_prueba" TO "service_role";



GRANT ALL ON TABLE "public"."variantes_fusionadas" TO "authenticated";
GRANT ALL ON TABLE "public"."variantes_fusionadas" TO "service_role";



GRANT ALL ON TABLE "public"."variantes_remapeo" TO "authenticated";
GRANT ALL ON TABLE "public"."variantes_remapeo" TO "service_role";



GRANT ALL ON TABLE "public"."variantes_remapeo_aplicado" TO "authenticated";
GRANT ALL ON TABLE "public"."variantes_remapeo_aplicado" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_correcciones" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_correcciones" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_descuentos" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_descuentos" TO "service_role";



GRANT ALL ON TABLE "public"."ventas_items" TO "authenticated";
GRANT ALL ON TABLE "public"."ventas_items" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































