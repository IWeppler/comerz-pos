-- Etapa 6: el valor del remito se calcula desde sus líneas históricas y los
-- pagos parciales salen de egresos COMPRA_MERCADERIA vinculados al remito.
begin;
create or replace function public.resumen_remitos_financiero()
returns table(
  id uuid, proveedor text, fecha_remito date, estado text, creado_en timestamptz,
  valor_historico numeric, total_pagado numeric, saldo_pendiente numeric
) language sql stable security invoker set search_path = public, pg_temp as $$
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
revoke all on function public.resumen_remitos_financiero() from public;
grant execute on function public.resumen_remitos_financiero() to authenticated;
commit;
