-- Compra de mercadería, etapa 1 (docs/asistente-ia.md, C1): la lectura de
-- "cuánto le debo a quién", con el estado de pago de 20261022150000.
--
-- `resumen_remitos_financiero()` (la que usaba el modal de gasto) calcula el
-- saldo de TODOS los remitos como si se debieran: con la carga inicial, los
-- 152 remitos "anteriores al registro" aparecerían como deuda. Esta función es
-- el criterio único de "a pagar":
--
--   valor            Σ cantidad recibida × costo (lo que entró: un renglón
--                    "no vino" no se paga; NULL en cantidad_recibida = igual
--                    a lo facturado, ver features/purchases/lib/recepcion.ts)
--   total_pagado     Σ egresos COMPRA_MERCADERIA atados al remito
--   saldo_pendiente  greatest(valor - pagado, 0), redondeado a pesos
--   situacion        A_PAGAR       aprobado, se paga desde Comerz, saldo > 0
--                    SIN_RESPONDER aprobado sin respuesta a "¿Lo pagaste?"
--                    PAGADO        aprobado y saldado (en Comerz o por fuera)
--                    ANTERIOR      aprobado antes del registro de pagos
--                    SIN_INGRESAR  PENDIENTE
--                    DESCARTADO
--
-- SECURITY INVOKER: RLS de ordenes_compra, ordenes_items, egresos y
-- proveedores. `resumen_remitos_financiero` queda hasta que el código nuevo
-- esté en producción; se borra en una migración aparte.
-- Reversión: drop function public.resumen_pagos_remitos();

begin;

do $pre$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'resumen_pagos_remitos') then
    raise exception 'resumen_pagos_remitos ya existe';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ordenes_compra'
                    and column_name = 'pago_modo') then
    raise exception 'falta 20261022150000 (pago_modo)';
  end if;
end
$pre$;

create function public.resumen_pagos_remitos()
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
           when b.pago_modo is null then 'SIN_RESPONDER'
           when round(b.valor) - b.total_pagado > 0 then 'A_PAGAR'
           else 'PAGADO'
         end
    from base b
   order by b.creado_en desc;
$$;

revoke all on function public.resumen_pagos_remitos() from public, anon;
grant execute on function public.resumen_pagos_remitos() to authenticated, service_role;

do $guard$
begin
  if has_function_privilege('anon', 'public.resumen_pagos_remitos()', 'EXECUTE') then
    raise exception 'anon no debe ejecutar resumen_pagos_remitos';
  end if;
  if exists (select 1 from public.resumen_pagos_remitos() r
              where r.situacion in ('A_PAGAR', 'SIN_RESPONDER')) then
    raise exception 'recién migrado no debería haber remitos a pagar ni sin responder';
  end if;
end
$guard$;

commit;
