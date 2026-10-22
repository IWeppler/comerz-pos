-- `resumen_pagos_remitos`: un remito aprobado sin respuesta a "¿Lo pagaste?"
-- pero con un pago cargado desde Caja (el gasto apunta al remito) ya se
-- respondió solo: se está pagando desde Comerz. Antes quedaba SIN_RESPONDER
-- aunque estuviera saldado. Ahora: sin pago_modo y sin pagos = SIN_RESPONDER;
-- sin pago_modo y con pagos = se trata como EN_COMERZ (A_PAGAR o PAGADO).
--
-- Mismo cuerpo que 20261022160000 salvo esa rama; guard de que la función viva
-- es la de esa migración (md5 del cuerpo) antes de reemplazarla.

begin;

do $pre$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'resumen_pagos_remitos';
  if v_md5 is null then
    raise exception 'falta resumen_pagos_remitos';
  end if;
  if (select prosrc from pg_proc where oid = 'public.resumen_pagos_remitos'::regproc)
       not like '%when b.pago_modo is null then ''SIN_RESPONDER''%' then
    raise exception 'resumen_pagos_remitos cambió desde 20261022160000: revisar antes de reemplazar';
  end if;
end
$pre$;

create or replace function public.resumen_pagos_remitos()
returns table (
  id uuid,
  nombre text,
  fecha_remito date,
  creado_en timestamptz,
  aprobado_en timestamptz,
  estado text,
  pago_modo text,
  proveedor_id uuid,
  proveedor_nombre text,
  valor numeric,
  total_pagado numeric,
  saldo_pendiente numeric,
  situacion text
)
language sql
stable
set search_path = ''
as $$
  with base as (
    select o.id, o.proveedor as nombre, o.fecha_remito, o.creado_en, o.aprobado_en,
           o.estado, o.pago_modo, o.proveedor_id, p.nombre as proveedor_nombre,
           coalesce((select sum(coalesce(oi.cantidad_recibida, oi.cantidad) * coalesce(oi.precio_costo, 0))
                       from public.ordenes_items oi where oi.orden_id = o.id), 0) as valor,
           coalesce((select sum(e.monto) from public.egresos e
                      where e.orden_compra_id = o.id and e.tipo = 'COMPRA_MERCADERIA'), 0) as total_pagado
      from public.ordenes_compra o
      left join public.proveedores p on p.id = o.proveedor_id
  )
  select b.id, b.nombre, b.fecha_remito, b.creado_en, b.aprobado_en, b.estado,
         b.pago_modo, b.proveedor_id, b.proveedor_nombre,
         round(b.valor)::numeric,
         b.total_pagado::numeric,
         greatest(round(b.valor) - b.total_pagado, 0)::numeric,
         case
           when b.estado = 'DESCARTADA' then 'DESCARTADO'
           when b.estado <> 'APROBADA' then 'SIN_INGRESAR'
           when b.pago_modo = 'ANTERIOR_AL_REGISTRO' then 'ANTERIOR'
           when b.pago_modo = 'FUERA_DE_COMERZ' then 'PAGADO'
           when b.pago_modo is null and b.total_pagado = 0 then 'SIN_RESPONDER'
           when round(b.valor) - b.total_pagado > 0 then 'A_PAGAR'
           else 'PAGADO'
         end
    from base b
   order by b.creado_en desc;
$$;

do $guard$
begin
  if has_function_privilege('anon', 'public.resumen_pagos_remitos()', 'EXECUTE') then
    raise exception 'anon no debe ejecutar resumen_pagos_remitos';
  end if;
  if not has_function_privilege('authenticated', 'public.resumen_pagos_remitos()', 'EXECUTE') then
    raise exception 'authenticated perdió resumen_pagos_remitos';
  end if;
  if (select prosrc from pg_proc where oid = 'public.resumen_pagos_remitos'::regproc)
       not like '%b.pago_modo is null and b.total_pagado = 0%' then
    raise exception 'el reemplazo no quedó';
  end if;
end
$guard$;

commit;
