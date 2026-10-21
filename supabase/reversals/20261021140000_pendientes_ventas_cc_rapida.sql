-- Reversión de 20261021140000_pendientes_ventas_cc_rapida.sql.
-- Vuelve al cuerpo de 20261021130000 (una llamada por cliente con lateral).
-- Mismo resultado, más lento. Usar solo si la versión en una pasada da problemas.

begin;

create or replace function public.pendientes_ventas_cc(p_venta_ids uuid[])
returns table (venta_id uuid, pendiente numeric)
language sql
stable
set search_path = ''
as $$
  with ventas_c as (
    select v.id, v.cliente_id
      from public.ventas v
     where v.id = any(p_venta_ids)
       and v.cliente_id is not null
  ),
  clientes as (
    select distinct cliente_id from ventas_c
  ),
  vivos as (
    select d.venta_id, sum(d.vivo) as pendiente
      from clientes c
     cross join lateral public.cc_deudas_vivas_detalle(c.cliente_id) d
     where d.venta_id is not null
     group by d.venta_id
  )
  select vc.id, coalesce(vv.pendiente, 0)
    from ventas_c vc
    left join vivos vv on vv.venta_id = vc.id;
$$;

commit;
