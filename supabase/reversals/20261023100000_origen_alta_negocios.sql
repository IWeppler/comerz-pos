-- Reversión de 20261023100000_origen_alta_negocios.sql. A mano, nunca desde
-- migrations/. Borra el origen de los negocios creados desde entonces (queda
-- igual en `auth.users.raw_user_meta_data->'origen_alta'`).
--
-- ANTES: volver `getFunnelAction` a la versión sin `origen_alta` /
-- `referido_por`, o el panel de /admincomerz lee columnas que no existen.

begin;

drop function public.funnel_comerz();

create function public.funnel_comerz()
 returns table(id uuid, nombre text, estado text, alta timestamp with time zone, primera_venta timestamp with time zone, ultima_venta timestamp with time zone, ventas_total bigint, pagos bigint, primer_pago date)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
  where security.is_super_admin()
  order by n.created_at;
$function$;

revoke all on function public.funnel_comerz() from public, anon;
grant execute on function public.funnel_comerz() to authenticated, service_role;

drop trigger trg_codigos_referido_sin_slug on public.codigos_referido;
drop function public.codigos_referido_sin_slug();
drop table public.codigos_referido;

drop trigger trg_negocios_origen_alta on public.negocios;
drop function public.negocios_origen_alta_desde_usuario();
drop index public.negocios_origen_ref_idx;
alter table public.negocios drop column origen_alta;

commit;
