-- Fase 0 de la tienda online: MEDIR cuántos pedidos salen del catálogo
-- (7/10/2026). Ver docs/tienda-online.md.
--
-- Hoy el carrito público arma un mensaje y abre WhatsApp: el pedido no deja
-- rastro en Comerz y no se sabe si alguien lo usa. Antes de construir órdenes,
-- push y Mercado Pago, esto cuenta cada "Enviar pedido" por comercio.
--
-- 1. `registrar_pedido_catalogo`: la llama el CATÁLOGO (anon) justo antes de
--    abrir WhatsApp. SECURITY DEFINER porque anon no tiene nada sobre
--    `eventos_uso` (y no se le da: con la tabla abierta podría leer o escribir
--    eventos de cualquier negocio). El negocio sale de
--    `security.negocio_publico()` (el header del catálogo), nunca de un
--    parámetro. Sin negocio, no hace nada. Nunca tira error: un contador que
--    rompe el pedido es peor que no tener el contador.
--    NO guarda datos de la clienta (nombre, dirección, teléfono): solo montos,
--    cantidades, modalidad y el método elegido.
--    Anti-ráfaga: más de 20 en un minuto para el mismo negocio se ignoran
--    (anon puede llamarla con un curl; inflar el número es lo único que logra).
-- 2. `metricas_pedidos_catalogo`: lo que lee /admincomerz/metricas. Solo super
--    admin, mismo patrón que `metricas_globales_comerz`.
--
-- Aditiva: no toca tablas ni funciones existentes.
-- Reversión: supabase/reversals/20261007150000_pedidos_catalogo_medicion.sql

create or replace function public.registrar_pedido_catalogo(
  p_total numeric,
  p_renglones integer,
  p_unidades numeric,
  p_modalidad text,
  p_pago text,
  p_envio_a_coordinar boolean default false
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_negocio_id uuid := security.negocio_publico();
  v_recientes integer;
begin
  if v_negocio_id is null then
    return;
  end if;

  -- Valores fuera de rango no son un pedido real: se ignoran sin error.
  if p_total is null or p_total < 0 or p_total > 1000000000
     or p_renglones is null or p_renglones < 1 or p_renglones > 500
     or p_unidades is null or p_unidades <= 0 or p_unidades > 100000 then
    return;
  end if;

  select count(*) into v_recientes
  from public.eventos_uso e
  where e.negocio_id = v_negocio_id
    and e.tipo = 'PEDIDO_CATALOGO'
    and e.creado_en > now() - interval '1 minute';

  if v_recientes >= 20 then
    return;
  end if;

  insert into public.eventos_uso (negocio_id, tipo, detalle, creado_por)
  values (
    v_negocio_id,
    'PEDIDO_CATALOGO',
    jsonb_build_object(
      'total', round(p_total, 2),
      'renglones', p_renglones,
      'unidades', p_unidades,
      'modalidad', case when p_modalidad in ('RETIRO', 'ENVIO') then p_modalidad else 'OTRA' end,
      'pago', left(coalesce(nullif(trim(p_pago), ''), 'A coordinar'), 60),
      'envio_a_coordinar', coalesce(p_envio_a_coordinar, false)
    ),
    null
  );
exception when others then
  -- A propósito: la medición nunca rompe el pedido.
  return;
end;
$function$;

revoke all on function public.registrar_pedido_catalogo(numeric, integer, numeric, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.registrar_pedido_catalogo(numeric, integer, numeric, text, text, boolean)
  to anon, authenticated;

create or replace function public.metricas_pedidos_catalogo()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_resultado jsonb;
begin
  if not security.is_super_admin() then
    raise exception 'SOLO_SUPER_ADMIN';
  end if;

  with pedidos as (
    select e.negocio_id, e.creado_en,
           coalesce((e.detalle->>'total')::numeric, 0) as total,
           e.detalle->>'modalidad' as modalidad,
           e.detalle->>'pago' as pago
    from public.eventos_uso e
    where e.tipo = 'PEDIDO_CATALOGO'
  )
  select jsonb_build_object(
    'medicion_desde', (select min(creado_en) from pedidos),
    'negocios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id,
        'nombre', n.nombre,
        'estado', n.estado,
        'rubro', n.rubro_comercial,
        'catalogo_activo', coalesce(cp.catalogo_activo, true),
        'pedidos_whatsapp', coalesce(cp.pedidos_whatsapp, true),
        'publicados', (select count(*) from public.productos p where p.negocio_id = n.id and p.publicado),
        'pedidos', (select count(*) from pedidos x where x.negocio_id = n.id),
        'pedidos_7d', (select count(*) from pedidos x where x.negocio_id = n.id and x.creado_en >= now() - interval '7 days'),
        'pedidos_30d', (select count(*) from pedidos x where x.negocio_id = n.id and x.creado_en >= now() - interval '30 days'),
        'monto_30d', (select coalesce(sum(x.total), 0) from pedidos x where x.negocio_id = n.id and x.creado_en >= now() - interval '30 days'),
        'ultimo_pedido', (select max(x.creado_en) from pedidos x where x.negocio_id = n.id),
        'ventas_30d', (select count(*) from public.ventas v where v.negocio_id = n.id and v.estado_operacion <> 'ANULADA' and v.fecha_venta >= now() - interval '30 days')
      ) order by n.created_at), '[]'::jsonb)
      from public.negocios n
      left join public.configuracion_pos cp on cp.negocio_id = n.id
    ),
    'por_dia', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'pedidos', cantidad, 'monto', monto) order by dia), '[]'::jsonb)
      from (
        select (x.creado_en at time zone 'America/Argentina/Buenos_Aires')::date as dia,
               count(*) as cantidad,
               coalesce(sum(x.total), 0) as monto
        from pedidos x
        where x.creado_en >= now() - interval '30 days'
        group by 1
      ) d
    ),
    'por_modalidad', (
      select coalesce(jsonb_object_agg(modalidad, cantidad), '{}'::jsonb)
      from (select coalesce(x.modalidad, 'OTRA') modalidad, count(*) cantidad
            from pedidos x where x.creado_en >= now() - interval '30 days' group by 1) m
    ),
    'por_pago', (
      select coalesce(jsonb_object_agg(pago, cantidad), '{}'::jsonb)
      from (select coalesce(x.pago, 'A coordinar') pago, count(*) cantidad
            from pedidos x where x.creado_en >= now() - interval '30 days' group by 1) p
    ),
    'generado_en', now()
  ) into v_resultado;

  return v_resultado;
end;
$function$;

revoke all on function public.metricas_pedidos_catalogo() from public, anon, authenticated;
grant execute on function public.metricas_pedidos_catalogo() to authenticated;

do $$
begin
  if not has_function_privilege('anon',
       'public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean)', 'execute') then
    raise exception 'anon tiene que poder registrar el pedido del catalogo';
  end if;
  if has_function_privilege('anon', 'public.metricas_pedidos_catalogo()', 'execute') then
    raise exception 'anon no deberia leer las metricas de pedidos';
  end if;
  if has_table_privilege('anon', 'public.eventos_uso', 'insert')
     or has_table_privilege('anon', 'public.eventos_uso', 'select') then
    raise exception 'anon no deberia tener acceso directo a eventos_uso';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = 'public.registrar_pedido_catalogo(numeric,integer,numeric,text,text,boolean)'::regprocedure
      and prosecdef
  ) then
    raise exception 'registrar_pedido_catalogo tiene que ser SECURITY DEFINER';
  end if;
end $$;
