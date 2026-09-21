-- Rollback de 20260902160000_stock_marca_updated_at.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- Saca el `updated_at = now()` de las dos RPC de stock, dejándolas como estaban
-- en 20260823182539 (la de a una) y 20260831140000 (la de lote).
--
-- OJO: desde 20260902170000 hay un TRIGGER sobre `producto_variantes` que
-- mantiene `updated_at` igual, así que revertir esto NO devuelve el
-- comportamiento viejo — la marca de tiempo se va a seguir escribiendo. Para
-- volver de verdad al estado anterior hay que revertir también aquella
-- migración. Este archivo existe para poder aislar un problema que se sospeche
-- de estas dos funciones, no para deshacer la marca de tiempo.

create or replace function public.ajustar_stock_variante(
  p_variante_id       uuid,
  p_delta             numeric,
  p_permitir_negativo boolean default false,
  p_origen            text    default null,
  p_referencia_id     uuid    default null
)
returns table (id uuid, stock numeric)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_origen is not null then
    perform public.marcar_origen_movimiento(p_origen, p_referencia_id);
  end if;

  return query
  update public.producto_variantes
     set stock = producto_variantes.stock + p_delta
   where producto_variantes.id = p_variante_id
     and (p_permitir_negativo or producto_variantes.stock + p_delta >= 0)
  returning producto_variantes.id, producto_variantes.stock;
end;
$$;

revoke all on function public.ajustar_stock_variante(uuid, numeric, boolean, text, uuid) from public;
grant execute on function public.ajustar_stock_variante(uuid, numeric, boolean, text, uuid) to authenticated;

create or replace function public.ajustar_stock_variantes(
  p_movimientos       jsonb,
  p_permitir_negativo boolean default false,
  p_origen            text    default null,
  p_referencia_id     uuid    default null
)
returns table (id uuid, stock numeric)
language plpgsql
set search_path to ''
as $function$
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
     set stock = v.stock + p.delta
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
$function$;
