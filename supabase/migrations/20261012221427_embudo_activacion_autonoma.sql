-- No cambia funnel_comerz ni descarga el historial de ventas al servidor Next.
create function public.embudo_activacion_autonoma() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare resultado jsonb;
begin
  if auth.uid() is null or not security.is_super_admin() then raise exception 'SIN_PERMISO'; end if;
  with fechas as (
    select n.id,n.nombre,n.estado,n.created_at as alta,
      (select min(v.created_at) from public.producto_variantes v where v.negocio_id=n.id) as productos,
      (select min(t.fecha_apertura) from public.turnos_caja t where t.negocio_id=n.id) as caja,
      (select min(v.fecha_venta) from public.ventas v where v.negocio_id=n.id and v.estado_operacion='CONFIRMADA') as primera_venta,
      (select min(h.creado_en) from public.hitos_activacion h where h.negocio_id=n.id and h.hito='POS_ABIERTO') as pos_abierto,
      (select h.hito from public.hitos_activacion h where h.negocio_id=n.id and h.hito like 'CAMINO\_%' escape '\' order by h.creado_en,h.hito limit 1) as camino,
      (select min(h.creado_en) from public.hitos_activacion h where h.negocio_id=n.id and h.hito like 'CAMINO\_%' escape '\') as camino_elegido
    from public.negocios n where n.estado <> 'demo'
  ), elegibles as (
    select * from fechas where primera_venta is null or primera_venta >= alta
  ), cohortes as (
    select date_trunc('week',alta at time zone 'America/Argentina/Buenos_Aires')::date as semana,
      count(*) as comercios,
      count(*) filter(where alta <= now()-interval '24 hours') as evaluables,
      count(*) filter(where alta <= now()-interval '24 hours' and primera_venta >= alta and primera_venta < alta+interval '24 hours') as vendidos_24h
    from elegibles group by 1
  )
  select jsonb_build_object(
    'comercios', coalesce((select jsonb_agg(to_jsonb(e) order by e.alta desc) from elegibles e),'[]'::jsonb),
    'cohortes', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('porcentaje_24h',round(100.0*c.vendidos_24h/nullif(c.evaluables,0),1)) order by c.semana desc) from cohortes c),'[]'::jsonb)
  ) into resultado;
  return resultado;
end $$;
revoke execute on function public.embudo_activacion_autonoma() from public,anon,authenticated;
grant execute on function public.embudo_activacion_autonoma() to authenticated;
do $$ begin
  if has_function_privilege('anon','public.embudo_activacion_autonoma()','EXECUTE')
    or not (select prosecdef from pg_proc where oid='public.embudo_activacion_autonoma()'::regprocedure)
    or position('security.is_super_admin()' in pg_get_functiondef('public.embudo_activacion_autonoma()'::regprocedure))=0
    or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='embudo_activacion_autonoma')<>1 then
    raise exception 'EMBUDO_ACTIVACION_GUARD';
  end if;
end $$;
