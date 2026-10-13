-- Reversión de 20261012194147_tienda_imei_al_entregar.sql.
-- 1. _registrar_venta_orden_tienda vuelve a un renglón por línea de la orden.
-- 2. marcar_orden_entregada vuelve a la firma (uuid, boolean), sin IMEI.
-- Los IMEI ya atados y los renglones ya partidos quedan como están.
do $$
declare
  v_def text := pg_get_functiondef('public._registrar_venta_orden_tienda(uuid,uuid,text,uuid,jsonb)'::regprocedure);
begin
  v_def := replace(v_def,
    E'  select p_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id,\n'
    || E'         -- Un renglón por aparato en lo que lleva IMEI (20261012220000).\n'
    || E'         case when s.variante_id is not null and i.cantidad = trunc(i.cantidad) then 1 else i.cantidad end,\n',
    E'  select p_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.cantidad,\n');
  v_def := replace(v_def,
    E'         case when s.variante_id is not null or coalesce(p.lleva_serie, false)\n',
    E'         case when coalesce(p.lleva_serie, false)\n');
  v_def := replace(v_def,
    E'    left join public.variantes_llevan_serie(array(\n'
    || E'      select x.variante_id from public.ordenes_tienda_items x\n'
    || E'       where x.negocio_id = p_negocio and x.orden_id = p_orden and x.variante_id is not null)) s\n'
    || E'      on s.variante_id = i.variante_id\n'
    || E'    cross join lateral generate_series(1,\n'
    || E'      case when s.variante_id is not null and i.cantidad = trunc(i.cantidad) then i.cantidad::int else 1 end) as aparato(n)\n', '');
  if position('generate_series' in v_def) > 0 then raise exception 'REVERSION_INCOMPLETA'; end if;
  execute v_def;
end $$;

drop function if exists public.marcar_orden_entregada(uuid, boolean, jsonb);
create function public.marcar_orden_entregada(p_orden uuid, p_entregada boolean default true)
returns boolean language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_id uuid;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not coalesce(public.tiene_permiso('ventas.cobrar'), false) then raise exception 'SIN_PERMISO'; end if;
  if p_entregada then
    update public.ordenes_tienda
       set estado = 'ENTREGADA', entregada_en = now(), entregada_por = auth.uid(), actualizado_en = now()
     where id = p_orden and negocio_id = v_negocio and estado = 'PAGADA' returning id into v_id;
  else
    update public.ordenes_tienda
       set estado = 'PAGADA', entregada_en = null, entregada_por = null, actualizado_en = now()
     where id = p_orden and negocio_id = v_negocio and estado = 'ENTREGADA' returning id into v_id;
  end if;
  return v_id is not null;
end $$;
revoke all on function public.marcar_orden_entregada(uuid, boolean) from public, anon;
grant execute on function public.marcar_orden_entregada(uuid, boolean) to authenticated;
