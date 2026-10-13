-- Notificaciones, N3: estados derivados (docs/notificaciones.md). No se guardan:
-- se calculan al leer y se van solos cuando se resuelven. Su clave lleva lo que
-- los origina, así "leído" vale para ESE caso y el siguiente vuelve a avisar.
--
--   1. `_estados_notificaciones(negocio)`: los estados del negocio, con la misma
--      forma que un hecho guardado. Todos baratos (índice por negocio): el
--      contador corre en cada navegación.
--        CAJA_OTRO_DIA ........... un turno ABIERTO desde un día anterior (no se
--                                  puede vender hasta cerrarlo). Uno por turno.
--        ORDEN_TRANSFERENCIAS .... órdenes por transferencia esperando que alguien
--                                  confirme el pago (sin vencer). Agrupado; la
--                                  clave es la más nueva: una nueva vuelve a avisar.
--        REMITO_PENDIENTES ....... remitos sin conciliar. Agrupado, mismo criterio.
--        PRUEBA_VENCE / PRUEBA_TERMINADA, PLAN_VENCE / PLAN_VENCIDO: la prueba en
--                                  sus últimos 3 días o terminada; el plan a 5
--                                  días de vencer o vencido, salvo que tenga
--                                  débito automático autorizado. Clave = fecha.
--      La DEUDA VENCIDA no está: la cuenta exacta (`deuda_cc_vencida`, FIFO) tarda
--      ~290 ms en Evens (108 clientes con saldo, medido 13/10/2026), demasiado
--      para cada navegación; y ya es el primer aviso de "Requiere tu atención"
--      en el panel.
--   2. `mis_notificaciones()` y `notificaciones_sin_leer()` suman los estados a los
--      hechos (reescritas desde el cuerpo VIVO de N1, con guard de md5).
--   3. `categoria_notificacion`: REMITO_* va a STOCK.
--   (Que los triggers de N2 usen `pesos_ar` va aparte, en la migración siguiente.)
-- Reversión: supabase/reversals/20261013142607_notificaciones_estados.sql

-- ─── Guard: se reescribe exactamente lo que dejó N1 ──────────────────────
do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.mis_notificaciones()'::regprocedure) <> '8aac710ae9173ddda56d88f8c6a0e3dc'
     or (select md5(prosrc) from pg_proc where oid = 'public.notificaciones_sin_leer()'::regprocedure) <> 'f07c64aee8b46714aceab64888dde2c4'
     or (select md5(prosrc) from pg_proc where oid = 'public.categoria_notificacion(text)'::regprocedure) <> '32cd890005e7f3c6837bcfba7962f683' then
    raise exception 'NOTIFICACIONES_N3_CUERPO_VIVO_DISTINTO';
  end if;
end $$;

create or replace function public.categoria_notificacion(p_tipo text)
returns text language sql immutable set search_path to 'public', 'pg_temp' as $$
  select case
    when p_tipo like 'STOCK_%' or p_tipo like 'REMITO_%' then 'STOCK'
    when p_tipo like 'ORDEN_%' then 'TIENDA'
    when p_tipo like 'DEBITO_%' or p_tipo like 'PLAN_%' or p_tipo like 'PRUEBA_%' then 'PLAN'
    else 'PLATA'
  end
$$;

-- ─── Estados ─────────────────────────────────────────────────────────────
create or replace function public._estados_notificaciones(p_negocio uuid)
returns table (clave text, tipo text, titulo text, detalle text, href text, fecha timestamptz)
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  with hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d)

  -- Caja abierta desde otro día.
  select 'caja_otro_dia:' || t.id, 'CAJA_OTRO_DIA', 'Caja abierta desde otro día',
         'Se abrió el ' || to_char(t.fecha_apertura at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI')
           || ' y sigue abierta. No se puede vender hasta cerrarla contando el efectivo.',
         '/caja', t.fecha_apertura
    from public.turnos_caja t, hoy
   where t.negocio_id = p_negocio and t.estado = 'ABIERTO'
     and (t.fecha_apertura at time zone 'America/Argentina/Buenos_Aires')::date < hoy.d

  union all
  -- Transferencias por confirmar.
  select 'transferencias:' || (array_agg(o.id order by o.creado_en desc))[1], 'ORDEN_TRANSFERENCIAS',
         case when count(*) = 1 then 'Una transferencia por confirmar'
              else count(*) || ' transferencias por confirmar' end,
         case when count(*) = 1
              then 'Orden #' || min(o.numero) || ' · ' || public.pesos_ar(min(o.total))
                   || '. Fijate si entró la plata y confirmala.'
              else public.pesos_ar(sum(o.total)) || ' en órdenes de la tienda online. Fijate si entró la plata y confirmalas.' end,
         '/ordenes', max(o.creado_en)
    from public.ordenes_tienda o
   where o.negocio_id = p_negocio and o.estado = 'PENDIENTE_PAGO' and o.medio = 'TRANSFERENCIA'
     and (o.vence_en is null or o.vence_en > now())
  having count(*) > 0

  union all
  -- Remitos sin conciliar.
  select 'remitos:' || (array_agg(r.id order by r.creado_en desc))[1], 'REMITO_PENDIENTES',
         case when count(*) = 1 then 'Un remito sin conciliar' else count(*) || ' remitos sin conciliar' end,
         'El más antiguo es de hace ' || ((select d from hoy) - (min(r.creado_en) at time zone 'America/Argentina/Buenos_Aires')::date)
           || ' días. Hasta conciliarlo no se actualizan el stock ni el costo de esos productos.',
         '/compras', max(r.creado_en)
    from public.ordenes_compra r
   where r.negocio_id = p_negocio and r.estado = 'PENDIENTE'
  having count(*) > 0

  union all
  -- Plan y prueba.
  select x.clave, x.tipo, x.titulo, x.detalle, '/perfil?tab=plan', x.fecha
    from (
      select ng.estado,
             (ng.plan_vencimiento at time zone 'America/Argentina/Buenos_Aires')::date as vence,
             (ng.plan_vencimiento at time zone 'America/Argentina/Buenos_Aires')::date - hoy.d as dias,
             exists (select 1 from public.suscripciones_mp s
                      where s.negocio_id = ng.id and s.estado = 'authorized') as con_debito,
             ng.plan_vencimiento
        from public.negocios ng, hoy
       where ng.id = p_negocio and ng.plan_vencimiento is not null and ng.estado in ('prueba', 'activo')
    ) v
    cross join lateral (
      select case
               when v.estado = 'prueba' and v.dias between 0 and 3 then 'prueba_vence:' || v.vence
               when v.estado = 'prueba' and v.dias < 0 then 'prueba_terminada:' || v.vence
               when v.estado = 'activo' and not v.con_debito and v.dias between 0 and 5 then 'plan_vence:' || v.vence
               when v.estado = 'activo' and not v.con_debito and v.dias < 0 then 'plan_vencido:' || v.vence
             end as clave,
             case
               when v.estado = 'prueba' and v.dias >= 0 then 'PRUEBA_VENCE'
               when v.estado = 'prueba' then 'PRUEBA_TERMINADA'
               when v.dias >= 0 then 'PLAN_VENCE'
               else 'PLAN_VENCIDO'
             end as tipo,
             case
               when v.estado = 'prueba' and v.dias = 0 then 'Tu prueba termina hoy'
               when v.estado = 'prueba' and v.dias = 1 then 'Tu prueba termina mañana'
               when v.estado = 'prueba' and v.dias > 1 then 'Tu prueba termina en ' || v.dias || ' días'
               when v.estado = 'prueba' then 'Tu prueba terminó'
               when v.dias = 0 then 'Tu plan vence hoy'
               when v.dias > 0 then 'Tu plan vence el ' || to_char(v.vence, 'DD/MM')
               else 'Tu plan venció el ' || to_char(v.vence, 'DD/MM')
             end as titulo,
             case
               when v.estado = 'prueba' then 'Elegí un plan para seguir vendiendo sin cortes.'
               else 'Pagalo o activá el débito automático para no perder el acceso.'
             end as detalle,
             -- La fecha queda FIJA por vencimiento (leído vale para este ciclo):
             -- el aviso arranca con la ventana, o al vencer.
             case when v.dias >= 0
                  then (v.vence - case when v.estado = 'prueba' then 3 else 5 end)::timestamp at time zone 'America/Argentina/Buenos_Aires'
                  else v.plan_vencimiento end as fecha
    ) x
   where x.clave is not null
$$;
revoke all on function public._estados_notificaciones(uuid) from public, anon, authenticated;

-- ─── Lectura: hechos + estados ───────────────────────────────────────────
create or replace function public.mis_notificaciones()
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_usuario uuid := auth.uid();
  v_rol text := public.rol_actual();
  v_lista jsonb;
begin
  if v_negocio is null or v_usuario is null then
    return jsonb_build_object('tu_negocio', '[]'::jsonb, 'sin_leer', 0);
  end if;

  -- Retención perezosa (sin cron).
  delete from public.notificaciones where negocio_id = v_negocio and actualizado_en < now() - interval '60 days';

  with avisos as (
    select n.clave, n.tipo, n.titulo, n.detalle, n.href, n.actualizado_en as fecha
      from public.notificaciones n
     where n.negocio_id = v_negocio
    union all
    select e.clave, e.tipo, e.titulo, e.detalle, e.href, e.fecha
      from public._estados_notificaciones(v_negocio) e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', a.clave, 'tipo', a.tipo, 'categoria', public.categoria_notificacion(a.tipo),
           'titulo', a.titulo, 'detalle', a.detalle, 'href', a.href, 'fecha', a.fecha,
           'leida', l.leida_en is not null and l.leida_en >= a.fecha)
         order by a.fecha desc), '[]'::jsonb)
    into v_lista
    from avisos a
    left join public.notificaciones_leidas l
      on l.usuario_id = v_usuario and l.negocio_id = v_negocio and l.clave = a.clave
   where public._rol_recibe_notificacion(v_negocio, v_rol, public.categoria_notificacion(a.tipo))
     -- Oculta ("limpiar leídas") salvo que haya cambiado después.
     and not (coalesce(l.oculta, false) and l.leida_en >= a.fecha);

  return jsonb_build_object(
    'tu_negocio', v_lista,
    'sin_leer', (select count(*) from jsonb_array_elements(v_lista) e where not (e->>'leida')::boolean));
end $$;

create or replace function public.notificaciones_sin_leer()
returns integer language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  with ctx as (
    select security.current_negocio_id() as negocio, auth.uid() as usuario, public.rol_actual() as rol
  ),
  avisos as (
    select n.clave, n.tipo, n.actualizado_en as fecha
      from public.notificaciones n, ctx
     where n.negocio_id = ctx.negocio
    union all
    -- Las vendedoras no reciben avisos del negocio: ni se calculan (el filtro
    -- dentro del lateral se evalúa antes de llamar a la función).
    select e.clave, e.tipo, e.fecha
      from ctx cross join lateral (
        select * from public._estados_notificaciones(ctx.negocio)
         where ctx.rol in ('ADMIN', 'ENCARGADO')
      ) e
  )
  select count(*)::int
    from avisos a
    cross join ctx
    left join public.notificaciones_leidas l
      on l.usuario_id = ctx.usuario and l.negocio_id = ctx.negocio and l.clave = a.clave
   where ctx.usuario is not null
     and public._rol_recibe_notificacion(ctx.negocio, ctx.rol, public.categoria_notificacion(a.tipo))
     and (l.leida_en is null or l.leida_en < a.fecha)
$$;

-- Sin revoke/grant: `create or replace` conserva los permisos de N1 (el guard
-- de abajo lo verifica).

do $$
begin
  if has_function_privilege('authenticated', 'public._estados_notificaciones(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.mis_notificaciones()', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.notificaciones_sin_leer()', 'EXECUTE')
    or public.categoria_notificacion('REMITO_PENDIENTES') <> 'STOCK'
    or public.categoria_notificacion('CAJA_OTRO_DIA') <> 'PLATA' then
    raise exception 'NOTIFICACIONES_N3_GUARD';
  end if;
end $$;
