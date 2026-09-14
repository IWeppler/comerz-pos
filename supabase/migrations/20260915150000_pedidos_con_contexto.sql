-- El pedido viaja con TODO lo que la vendedora ya cargó.
--
-- La vendedora le pide al cliente tipo de venta, cliente, medio de pago,
-- descuento, si quiere factura... y la caja lo recibía vacío y volvía a
-- preguntar todo. `contexto` guarda ese estado del paso de cobro (opaco
-- para la base: lo escribe y lo lee el POS) para que la caja abra el pedido
-- directamente en el paso de pago, con todo puesto, y solo cobre.

alter table public.pedidos
  add column if not exists contexto jsonb;

comment on column public.pedidos.contexto is
  'Estado del paso de cobro tal como lo dejo la vendedora (cliente, medio de pago, promo, lista, factura/ticket, CC). Opaco: lo interpreta el POS.';

create or replace function public.crear_pedido(
  p_items jsonb,
  p_cliente_id uuid default null,
  p_total_estimado numeric default 0,
  p_nota text default null,
  p_contexto jsonb default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
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
$function$;

-- La firma vieja (4 parámetros) queda reemplazada por la de 5 con default:
-- PostgREST resuelve la misma llamada. Se borra la vieja para que no haya
-- dos candidatas.
drop function if exists public.crear_pedido(jsonb, uuid, numeric, text);

grant execute on function public.crear_pedido(jsonb, uuid, numeric, text, jsonb) to authenticated;
