-- Cuenta corriente, etapa 1: el recibo dice QUÉ compras cancela cada cobro y
-- cuánto queda pendiente por mes de vencimiento.
--
-- EL PROBLEMA. Un cobro de CC entra como un CREDITO suelto: la base sabe cuánto
-- debe la clienta, no qué debe. El recibo impreso decía "saldo anterior, pago,
-- saldo" y la cajera no tenía cómo contestar "¿qué estoy pagando?" ni "¿qué
-- mes me toca?". Además el papel se armaba con la respuesta del cobro y no se
-- guardaba: no se podía reimprimir.
--
-- LO QUE HACE ESTA MIGRACIÓN (todo aditivo salvo el punto 2):
--
--  1. `cc_deudas_vivas`: la deuda viva POR TICKET (recargo de mora adentro de
--     su ticket), con su vencimiento. Es la regla que ya usaba
--     `recalcular_vencimiento_cc`, sacada a una función para que el
--     vencimiento, el desglose por mes y el recibo salgan de UN solo lugar.
--
--  2. `recalcular_vencimiento_cc` pasa a ser `min(vence_el)` de esa función, y
--     el día de un movimiento sin `fecha_origen` pasa de UTC al día comercial
--     argentino (también en `deuda_cc_vencida`, junto con su "hoy"). Una compra
--     del 31/10 a las 22 h era del 1/11 para la base: 26 movimientos vivos
--     caían en otro día. Se re-cachea `clientes.fecha_vencimiento_deuda`.
--
--  3. `cc_imputaciones` y `cc_recibos`: lo que cancela cada cobro y la foto del
--     recibo, GUARDADOS al cobrar. Solo se agregan filas (sin INSERT/UPDATE/
--     DELETE para `authenticated`): las escribe únicamente
--     `registrar_recibo_cobro_cc`, SECURITY DEFINER, que solo acepta un cobro
--     creado en la MISMA transacción. Así nadie fabrica un recibo desde la
--     consola.
--
--  4. `registrar_cobro_cc` llama a ese registro antes de devolver, y devuelve
--     el recibo completo. `recibo_cobro_cc` lo relee para reimprimir.
--
-- LO QUE NO CAMBIA EN ESTA ETAPA: la imputación sigue siendo la automática
-- (lo más viejo primero, la misma que decide vencimiento y mora). Lo guardado
-- es lo que el cobro canceló EN ESE MOMENTO: si después se anula una compra
-- vieja, el recibo impreso sigue diciendo lo que dijo. Vencimiento y mora
-- todavía no leen `cc_imputaciones` (etapa 2), y la imputación manual es la
-- etapa 3 (por eso `origen` ya admite MANUAL).

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Foto de cómo estaba todo, para los guards del final.
-- ─────────────────────────────────────────────────────────────────────────────
create temp table _cc_antes on commit drop as
select c.id as cliente_id,
       c.fecha_vencimiento_deuda as cacheado,
       public.recalcular_vencimiento_cc(c.id) as calculado
  from public.clientes c;

-- Clientes con algún movimiento vivo cuyo día cambia al pasar de UTC al día
-- argentino: son los ÚNICOS a los que se les puede mover el vencimiento.
create temp table _cc_dia_cambia on commit drop as
select distinct m.cliente_id
  from public.cuenta_corriente_movimientos m
 where m.anulado = false
   and m.fecha_origen is null
   and (m.creado_en at time zone 'UTC')::date
       <> (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date;

-- Medido el 1/10/2026: 58 clientes YA tenían el cache distinto de la regla
-- antes de esta migración (48 sin deuda con una fecha vieja colgada, 7 del
-- Kiosco Demo sin vencimiento, y 3 con deuda real en Librería Colores, Evens y
-- Estilo Bonito). Esta migración NO los toca: corregirlos cambia quién paga
-- mora y es una decisión aparte. Solo se re-cachea a quien estaba al día con
-- la regla y se mueve por el cambio de día.
do $$
declare
  v_desfasados int;
begin
  select count(*) into v_desfasados
    from _cc_antes
   where cacheado is distinct from calculado;
  raise notice 'Clientes con el vencimiento desfasado ANTES de migrar (no se tocan): %', v_desfasados;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La deuda viva por ticket.
-- ─────────────────────────────────────────────────────────────────────────────
-- Unidad = un DEBITO de capital con los recargos de mora que apuntan a él
-- (`debito_origen_id`). Un recargo cuyo ticket no está vivo (sin origen, o con
-- el origen anulado) es una unidad propia que vence el día que nació: ese día
-- la cuenta ya estaba vencida. Hoy son 0 filas; antes, la versión vieja de
-- `recalcular_vencimiento_cc` perdía en silencio la mora de un ticket anulado.
--
-- Lo pagado se aplica a lo más viejo primero (fecha, creado_en, id). Con
-- `p_excluir_pago_id` se calcula como si ese cobro no existiera: es lo que usa
-- el recibo para saber qué canceló.
--
-- INVOKER: con la RLS de quien llama. Igual filtra por el negocio del cliente,
-- porque también la llama `registrar_recibo_cobro_cc` (DEFINER).
create or replace function public.cc_deudas_vivas(
  p_cliente_id uuid,
  p_excluir_pago_id uuid default null
)
returns table (
  debito_id uuid,
  venta_id uuid,
  fecha date,
  creado_en timestamptz,
  descripcion text,
  monto numeric,
  monto_mora numeric,
  vivo numeric,
  vence_el date,
  es_mora_huerfana boolean
)
language sql
stable
set search_path to 'public', 'security', 'pg_temp'
as $function$
  with cliente as (
    select c.negocio_id, coalesce(cp.cc_plazo_mora, 30) as dias
      from public.clientes c
      left join public.configuracion_pos cp on cp.negocio_id = c.negocio_id
     where c.id = p_cliente_id
  ),
  movs as (
    select m.*,
           coalesce(
             m.fecha_origen,
             (m.creado_en at time zone 'America/Argentina/Buenos_Aires')::date
           ) as dia
      from public.cuenta_corriente_movimientos m
     where m.cliente_id = p_cliente_id
       and m.negocio_id = (select negocio_id from cliente)
       and m.anulado = false
  ),
  tickets as (
    select d.* from movs d where d.tipo = 'DEBITO' and d.pago_id is null
  ),
  mora_por_ticket as (
    select m.debito_origen_id as ticket_id, sum(m.monto) as mora
      from movs m
     where m.tipo = 'DEBITO'
       and m.pago_id is not null
       and m.debito_origen_id in (select t.id from tickets t)
     group by m.debito_origen_id
  ),
  unidades as (
    select t.id, t.venta_id, t.dia as fecha, t.creado_en, t.descripcion,
           t.monto + coalesce(mt.mora, 0) as total,
           coalesce(mt.mora, 0) as mora,
           false as es_mora_huerfana
      from tickets t
      left join mora_por_ticket mt on mt.ticket_id = t.id

    union all

    select m.id, null::uuid, m.dia, m.creado_en, m.descripcion,
           m.monto, m.monto, true
      from movs m
     where m.tipo = 'DEBITO'
       and m.pago_id is not null
       and (m.debito_origen_id is null
            or m.debito_origen_id not in (select t.id from tickets t))
  ),
  ordenadas as (
    select u.*,
           sum(u.total) over (
             order by u.fecha, u.creado_en, u.id
             rows unbounded preceding
           ) as acumulado
      from unidades u
  ),
  pagado as (
    select coalesce(sum(m.monto), 0) as total
      from movs m
     where m.tipo = 'CREDITO'
       and (p_excluir_pago_id is null
            or m.pago_id is distinct from p_excluir_pago_id)
  )
  select o.id, o.venta_id, o.fecha, o.creado_en, o.descripcion,
         o.total, o.mora,
         greatest(0, least(o.total, o.acumulado - pg.total)),
         case when o.es_mora_huerfana then o.fecha else o.fecha + cl.dias end,
         o.es_mora_huerfana
    from ordenadas o
   cross join pagado pg
   cross join cliente cl
   order by o.fecha, o.creado_en, o.id;
$function$;

revoke all on function public.cc_deudas_vivas(uuid, uuid) from public, anon;
grant execute on function public.cc_deudas_vivas(uuid, uuid) to authenticated;

-- Lo mismo con el número del ticket que tiene la clienta en la mano: el del
-- comprobante de emisión (el primero que no anula a otro), igual que
-- `numeroTicketVenta`. Aparte para que `recalcular_vencimiento_cc` —que corre
-- en cada venta fiada y cada cobro— no pague el join.
create or replace function public.cc_deudas_vivas_detalle(
  p_cliente_id uuid,
  p_excluir_pago_id uuid default null
)
returns table (
  debito_id uuid,
  venta_id uuid,
  fecha date,
  creado_en timestamptz,
  descripcion text,
  monto numeric,
  monto_mora numeric,
  vivo numeric,
  vence_el date,
  es_mora_huerfana boolean,
  comprobante_punto_venta integer,
  comprobante_numero bigint
)
language sql
stable
set search_path to 'public', 'security', 'pg_temp'
as $function$
  select d.debito_id, d.venta_id, d.fecha, d.creado_en, d.descripcion,
         d.monto, d.monto_mora, d.vivo, d.vence_el, d.es_mora_huerfana,
         cb.punto_venta, cb.numero
    from public.cc_deudas_vivas(p_cliente_id, p_excluir_pago_id) d
    left join lateral (
      select c.punto_venta, c.numero
        from public.comprobantes c
       where c.venta_id = d.venta_id
         and c.anula_comprobante_id is null
       order by c.emitido_en
       limit 1
    ) cb on d.venta_id is not null
   order by d.fecha, d.creado_en, d.debito_id;
$function$;

revoke all on function public.cc_deudas_vivas_detalle(uuid, uuid) from public, anon;
grant execute on function public.cc_deudas_vivas_detalle(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El vencimiento sale de la misma función (y del día argentino).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.recalcular_vencimiento_cc(p_cliente_id uuid)
returns date
language sql
stable
set search_path to 'public', 'security', 'pg_temp'
as $function$
  select min(d.vence_el)
    from public.cc_deudas_vivas(p_cliente_id) d
   where d.vivo > 0;
$function$;

-- `deuda_cc_vencida` (base de la mora) todavía tiene su propia cuenta: se
-- unifica en la etapa 2. Acá solo se le cambia el día, para que no diga
-- "vencido" un día distinto que el vencimiento. Parche sobre el cuerpo VIVO.
do $$
declare
  v_def   text;
  v_utc   constant text := '(m.creado_en at time zone ''UTC'')::date';
  v_ar    constant text := '(m.creado_en at time zone ''America/Argentina/Buenos_Aires'')::date';
  v_hoy   constant text := 'v.fecha + v.dias < current_date';
  v_hoy_ar constant text := 'v.fecha + v.dias < (now() at time zone ''America/Argentina/Buenos_Aires'')::date';
begin
  select pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure) into v_def;

  if (length(v_def) - length(replace(v_def, v_utc, ''))) / length(v_utc) <> 2 then
    raise exception 'deuda_cc_vencida: el día UTC no aparece exactamente 2 veces, el cuerpo vivo cambió';
  end if;
  if (length(v_def) - length(replace(v_def, v_hoy, ''))) / length(v_hoy) <> 1 then
    raise exception 'deuda_cc_vencida: el "hoy" no aparece exactamente 1 vez, el cuerpo vivo cambió';
  end if;

  execute replace(replace(v_def, v_utc, v_ar), v_hoy, v_hoy_ar);

  select pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure) into v_def;
  if position('UTC' in v_def) > 0 or position('current_date' in v_def) > 0
     or position('debito_capital_mas_antiguo_id' in v_def) = 0 then
    raise exception 'deuda_cc_vencida: el parche no quedó como se esperaba';
  end if;
end $$;

-- Re-cacheo del vencimiento. Solo puede moverse en clientes con un movimiento
-- cuyo día cambió; cualquier otro cambio es que la regla nueva no es la vieja.
do $$
declare
  v_inesperados int;
  v_movidos int;
begin
  select count(*) into v_inesperados
    from _cc_antes a
   where a.calculado is distinct from public.recalcular_vencimiento_cc(a.cliente_id)
     and a.cliente_id not in (select cliente_id from _cc_dia_cambia);
  if v_inesperados > 0 then
    raise exception 'La regla nueva de vencimiento cambia % clientes sin movimientos de día distinto: no es la misma regla', v_inesperados;
  end if;

  update public.clientes c
     set fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(c.id)
    from _cc_antes a
   where a.cliente_id = c.id
     and a.cacheado is not distinct from a.calculado
     and c.fecha_vencimiento_deuda
         is distinct from public.recalcular_vencimiento_cc(c.id);
  get diagnostics v_movidos = row_count;
  raise notice 'Vencimientos re-cacheados por el día argentino: %', v_movidos;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lo que cancela cada cobro, y la foto del recibo.
-- ─────────────────────────────────────────────────────────────────────────────
-- Sin FK duras: es historia y tiene que sobrevivir al cobro, al ticket y al
-- cliente (borrar un cliente borra sus `venta_pagos` en cascada).
create table if not exists public.cc_recibos (
  pago_id uuid primary key,
  negocio_id uuid not null default security.current_negocio_id(),
  cliente_id uuid not null,
  -- Lo que debía al entrar, SIN la mora de este cobro.
  saldo_anterior numeric not null,
  mora_monto numeric not null default 0 check (mora_monto >= 0),
  -- Lo que se descontó de la deuda (base, sin recargo por método).
  monto_aplicado numeric not null check (monto_aplicado > 0),
  saldo_nuevo numeric not null,
  fecha_vencimiento date,
  -- Las deudas que quedaron vivas después del cobro, con su vencimiento: de
  -- acá sale "pendiente por mes" en el papel, igual al reimprimir.
  pendientes jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now()
);

create index if not exists cc_recibos_negocio_cliente_idx
  on public.cc_recibos (negocio_id, cliente_id, creado_en desc);

create table if not exists public.cc_imputaciones (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id(),
  cliente_id uuid not null,
  pago_id uuid not null,
  debito_id uuid not null,
  venta_id uuid,
  comprobante_punto_venta integer,
  comprobante_numero bigint,
  fecha_deuda date not null,
  vence_el date not null,
  descripcion text,
  -- Lo que valía la deuda al cobrar, recargos incluidos.
  monto_deuda numeric not null,
  aplicado numeric not null check (aplicado > 0),
  saldo_restante numeric not null check (saldo_restante >= 0),
  es_mora_huerfana boolean not null default false,
  origen text not null default 'AUTOMATICA'
    check (origen in ('AUTOMATICA', 'MANUAL', 'RECONSTRUIDA')),
  creado_en timestamptz not null default now()
);

create index if not exists cc_imputaciones_negocio_pago_idx
  on public.cc_imputaciones (negocio_id, pago_id);
create index if not exists cc_imputaciones_negocio_debito_idx
  on public.cc_imputaciones (negocio_id, debito_id);
create index if not exists cc_imputaciones_negocio_cliente_idx
  on public.cc_imputaciones (negocio_id, cliente_id);

alter table public.cc_recibos enable row level security;
alter table public.cc_imputaciones enable row level security;

create policy aislamiento_negocio on public.cc_recibos
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
create policy aislamiento_negocio on public.cc_imputaciones
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

-- Lectura: la misma que el libro de CC (todo el negocio lo ve).
create policy cc_recibos_select on public.cc_recibos
  for select to authenticated using (true);
create policy cc_imputaciones_select on public.cc_imputaciones
  for select to authenticated using (true);

revoke all on table public.cc_recibos from anon;
revoke all on table public.cc_imputaciones from anon;
revoke insert, update, delete, truncate on table public.cc_recibos from authenticated;
revoke insert, update, delete, truncate on table public.cc_imputaciones from authenticated;

-- El recibo de un cobro, listo para imprimir: un solo viaje.
-- INVOKER, pero filtra el negocio a mano porque también lo llama
-- `registrar_recibo_cobro_cc` (DEFINER). null = ese cobro no tiene recibo
-- guardado (cobros anteriores a esta migración).
create or replace function public.recibo_cobro_cc(p_pago_id uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'security', 'pg_temp'
as $function$
  select jsonb_build_object(
    'pago_id', r.pago_id,
    'cliente_id', r.cliente_id,
    'cliente_nombre', c.nombre,
    'fecha', vp.creado_en,
    'metodo_nombre', vp.metodo_nombre,
    'monto_base', vp.monto_base,
    'recargo_porcentaje', vp.recargo_porcentaje,
    'recargo_monto', vp.recargo_monto,
    'monto_bruto', vp.monto_bruto,
    'saldo_anterior', r.saldo_anterior,
    'mora_monto', r.mora_monto,
    'monto_aplicado', r.monto_aplicado,
    'saldo_nuevo', r.saldo_nuevo,
    'fecha_vencimiento', r.fecha_vencimiento,
    'pendientes', r.pendientes,
    'imputaciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'debito_id', i.debito_id,
               'venta_id', i.venta_id,
               'comprobante_punto_venta', i.comprobante_punto_venta,
               'comprobante_numero', i.comprobante_numero,
               'fecha', i.fecha_deuda,
               'vence_el', i.vence_el,
               'descripcion', i.descripcion,
               'monto', i.monto_deuda,
               'aplicado', i.aplicado,
               'saldo_restante', i.saldo_restante,
               'es_mora_huerfana', i.es_mora_huerfana
             ) order by i.vence_el, i.fecha_deuda, i.creado_en)
        from public.cc_imputaciones i
       where i.pago_id = r.pago_id
         and i.negocio_id = r.negocio_id
    ), '[]'::jsonb),
    'comercio', jsonb_build_object(
      'nombre', cp."posName",
      'direccion', cp.direccion,
      'whatsapp', cp.whatsapp,
      'ancho_ticket_mm', cp.ancho_ticket_mm
    )
  )
    from public.cc_recibos r
    left join public.venta_pagos vp
      on vp.id = r.pago_id and vp.negocio_id = r.negocio_id
    left join public.clientes c
      on c.id = r.cliente_id and c.negocio_id = r.negocio_id
    left join public.configuracion_pos cp
      on cp.negocio_id = r.negocio_id
   where r.pago_id = p_pago_id
     and r.negocio_id = security.current_negocio_id();
$function$;

revoke all on function public.recibo_cobro_cc(uuid) from public, anon;
grant execute on function public.recibo_cobro_cc(uuid) to authenticated;

-- La ÚNICA puerta de escritura de las dos tablas. DEFINER porque
-- `authenticated` no tiene INSERT; por eso solo acepta un cobro de CC del
-- negocio activo creado en la transacción en curso (`xmin`): llamarla desde la
-- consola con un cobro viejo falla. Todo lo que escribe lo deduce de la base,
-- nada viaja por parámetro. Idempotente: un segundo llamado devuelve el mismo.
create or replace function public.registrar_recibo_cobro_cc(p_pago_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio  uuid := security.current_negocio_id();
  v_pago     record;
  v_saldo    numeric;
  v_vence    date;
  v_credito  numeric;
  v_mora     numeric;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;

  select vp.id, vp.cliente_id, vp.xmin as xmin_pago
    into v_pago
    from public.venta_pagos vp
   where vp.id = p_pago_id
     and vp.negocio_id = v_negocio
     and vp.tipo_movimiento = 'PAGO_CUENTA_CORRIENTE'
     and vp.cliente_id is not null;

  if not found then
    raise exception 'RECIBO_CC_PAGO_INVALIDO';
  end if;

  if exists (
    select 1 from public.cc_recibos r
     where r.pago_id = p_pago_id and r.negocio_id = v_negocio
  ) then
    return public.recibo_cobro_cc(p_pago_id);
  end if;

  if not (v_pago.xmin_pago = pg_current_xact_id()::xid) then
    raise exception 'RECIBO_CC_FUERA_DEL_COBRO';
  end if;

  select coalesce(c.saldo_pendiente, 0), c.fecha_vencimiento_deuda
    into v_saldo, v_vence
    from public.clientes c
   where c.id = v_pago.cliente_id
     and c.negocio_id = v_negocio;

  select coalesce(sum(m.monto) filter (where m.tipo = 'CREDITO'), 0),
         coalesce(sum(m.monto) filter (where m.tipo = 'DEBITO'), 0)
    into v_credito, v_mora
    from public.cuenta_corriente_movimientos m
   where m.pago_id = p_pago_id
     and m.negocio_id = v_negocio
     and m.anulado = false;

  if v_credito <= 0 then
    raise exception 'RECIBO_CC_SIN_CREDITO';
  end if;

  -- Lo que canceló = lo vivo sin este cobro − lo vivo con este cobro, por
  -- deuda. La mora de este cobro ya está en las dos fotos (solo se excluye el
  -- crédito), así que el recargo cobrado aparece aplicado a su ticket.
  insert into public.cc_imputaciones (
    negocio_id, cliente_id, pago_id, debito_id, venta_id,
    comprobante_punto_venta, comprobante_numero,
    fecha_deuda, vence_el, descripcion, monto_deuda,
    aplicado, saldo_restante, es_mora_huerfana, origen
  )
  select v_negocio, v_pago.cliente_id, p_pago_id, a.debito_id, a.venta_id,
         a.comprobante_punto_venta, a.comprobante_numero,
         a.fecha, a.vence_el, a.descripcion, a.monto,
         a.vivo - coalesce(d.vivo, 0), coalesce(d.vivo, 0),
         a.es_mora_huerfana, 'AUTOMATICA'
    from public.cc_deudas_vivas_detalle(v_pago.cliente_id, p_pago_id) a
    left join public.cc_deudas_vivas(v_pago.cliente_id) d
      on d.debito_id = a.debito_id
   where a.vivo - coalesce(d.vivo, 0) > 0;

  insert into public.cc_recibos (
    pago_id, negocio_id, cliente_id, saldo_anterior, mora_monto,
    monto_aplicado, saldo_nuevo, fecha_vencimiento, pendientes
  ) values (
    p_pago_id, v_negocio, v_pago.cliente_id,
    v_saldo + v_credito - v_mora, v_mora, v_credito, v_saldo, v_vence,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'debito_id', p.debito_id,
               'venta_id', p.venta_id,
               'comprobante_punto_venta', p.comprobante_punto_venta,
               'comprobante_numero', p.comprobante_numero,
               'fecha', p.fecha,
               'vence_el', p.vence_el,
               'descripcion', p.descripcion,
               'monto', p.monto,
               'vivo', p.vivo,
               'es_mora_huerfana', p.es_mora_huerfana
             ) order by p.vence_el, p.fecha, p.creado_en)
        from public.cc_deudas_vivas_detalle(v_pago.cliente_id) p
       where p.vivo > 0
    ), '[]'::jsonb)
  );

  return public.recibo_cobro_cc(p_pago_id);
end;
$function$;

revoke all on function public.registrar_recibo_cobro_cc(uuid) from public, anon;
grant execute on function public.registrar_recibo_cobro_cc(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. `registrar_cobro_cc` guarda el recibo en su misma transacción.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_decl_viejo constant text := E'  v_vencimiento  date;\nbegin';
  v_decl_nuevo constant text := E'  v_vencimiento  date;\n  v_recibo       jsonb;\nbegin';
  v_ret_viejo constant text := E'  return jsonb_build_object(\n    ''ya_registrado'', false,';
  v_ret_nuevo constant text :=
    E'  -- 8. El recibo: qué canceló este cobro y qué queda por mes. Misma\n'
    || E'  -- transacción: si no se puede guardar, el cobro no entra.\n'
    || E'  v_recibo := public.registrar_recibo_cobro_cc(v_pago_id);\n\n'
    || E'  return jsonb_build_object(\n    ''ya_registrado'', false,\n    ''recibo'', v_recibo,';
begin
  select pg_get_functiondef('public.registrar_cobro_cc(jsonb,jsonb)'::regprocedure)
    into v_def;

  if (length(v_def) - length(replace(v_def, v_decl_viejo, ''))) / length(v_decl_viejo) <> 1 then
    raise exception 'registrar_cobro_cc: la declaración no aparece exactamente una vez, el cuerpo vivo cambió';
  end if;
  if (length(v_def) - length(replace(v_def, v_ret_viejo, ''))) / length(v_ret_viejo) <> 1 then
    raise exception 'registrar_cobro_cc: el return no aparece exactamente una vez, el cuerpo vivo cambió';
  end if;

  execute replace(replace(v_def, v_decl_viejo, v_decl_nuevo), v_ret_viejo, v_ret_nuevo);

  select pg_get_functiondef('public.registrar_cobro_cc(jsonb,jsonb)'::regprocedure)
    into v_def;
  if position('registrar_recibo_cobro_cc(v_pago_id)' in v_def) = 0
     or position('COBRO_SUPERA_DEUDA' in v_def) = 0
     or position('for update' in v_def) = 0
     or position('ya_registrado'', true' in v_def) = 0
     or position('SECURITY DEFINER' in v_def) > 0 then
    raise exception 'registrar_cobro_cc: el parche no quedó como se esperaba';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Guards finales.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n int;
begin
  -- Lo vivo por ticket suma exactamente la deuda de cada cliente que no esté
  -- descuadrado contra su libro (esos se reportan aparte, no se esconden).
  select count(*) into v_n
    from public.clientes c
   where coalesce(c.saldo_pendiente, 0) > 0
     and round(coalesce(c.saldo_pendiente, 0), 2) = round((
           select coalesce(sum(case when m.tipo = 'DEBITO' then m.monto else -m.monto end), 0)
             from public.cuenta_corriente_movimientos m
            where m.cliente_id = c.id and m.anulado = false), 2)
     and round(coalesce(c.saldo_pendiente, 0), 2)
         <> round((select coalesce(sum(d.vivo), 0) from public.cc_deudas_vivas(c.id) d), 2);
  if v_n > 0 then
    raise exception 'cc_deudas_vivas no suma el saldo de % clientes cuadrados', v_n;
  end if;

  -- Quien estaba al día con la regla sigue al día; los desfasados de antes
  -- siguen exactamente como estaban.
  select count(*) into v_n
    from public.clientes c
    join _cc_antes a on a.cliente_id = c.id
   where (a.cacheado is not distinct from a.calculado
          and c.fecha_vencimiento_deuda is distinct from public.recalcular_vencimiento_cc(c.id))
      or (a.cacheado is distinct from a.calculado
          and c.fecha_vencimiento_deuda is distinct from a.cacheado);
  if v_n > 0 then
    raise exception 'Quedaron % clientes con el vencimiento fuera de lo esperado', v_n;
  end if;

  -- Una sola versión de cada función (sin sobrecargas).
  select count(*) into v_n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('cc_deudas_vivas', 'cc_deudas_vivas_detalle',
                       'recibo_cobro_cc', 'registrar_recibo_cobro_cc',
                       'registrar_cobro_cc', 'recalcular_vencimiento_cc',
                       'deuda_cc_vencida');
  if v_n <> 7 then
    raise exception 'Se esperaban 7 funciones sin sobrecarga y hay %', v_n;
  end if;

  -- `anon` no ejecuta nada de esto.
  if has_function_privilege('anon', 'public.registrar_recibo_cobro_cc(uuid)', 'execute')
     or has_function_privilege('anon', 'public.recibo_cobro_cc(uuid)', 'execute')
     or has_function_privilege('anon', 'public.cc_deudas_vivas(uuid, uuid)', 'execute')
     or has_table_privilege('authenticated', 'public.cc_imputaciones', 'insert')
     or has_table_privilege('authenticated', 'public.cc_recibos', 'insert') then
    raise exception 'Los privilegios no quedaron cerrados';
  end if;
end $$;
