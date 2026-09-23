-- ═══════════════════════════════════════════════════════════════════════════
-- min(uuid) NO EXISTE, Y UN GUARD SOBRE EL TEXTO DE LA FUNCIÓN NO LO VE
--
-- `20260922225236` dejó la función ROTA en producción, para las DOS vistas.
-- Usaba `min()` sobre cinco columnas uuid (`origen_id`, `operacion_id`,
-- `turno_caja_id`, `orden_compra_id`, `registrado_por`) y Postgres no define
-- min/max para uuid — igual que no los define para jsonb, que es por lo que
-- `datos` ya venía por `array_agg`.
--
-- Y no estaba solo en la rama de la vista nueva: `min(f.origen_id)` vive en
-- el ELSE de un CASE, así que se evalúa siempre. La tabla de Movimientos, que
-- funcionaba desde el 21/9, se cayó con la migración anterior.
--
-- POR QUÉ NO LO ATAJÓ NADA DE LO QUE HABÍA:
--
--  * `create or replace function` sobre plpgsql PARSEA el cuerpo pero no
--    planifica las consultas, así que una función inexistente recién explota
--    la primera vez que alguien la ejecuta. La prueba en seco
--    (`begin … rollback`) pasó por eso.
--  * Los guards leían `pg_get_functiondef`: verifican lo que la función DICE
--    —el orden de las CTE, el fail-closed, los filtros por negocio— y nada de
--    eso se entera de que una agregación no existe.
--  * La verificación funcional que sí corrí replicaba las CTE a mano, pero
--    seleccionando un subconjunto de columnas que no incluía ningún uuid.
--
-- LA REGLA: una función nueva no está probada hasta que se la EJECUTA con
-- datos reales. Un guard sobre su texto es un complemento, nunca el reemplazo.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.movimientos_financieros_negocio(
  p_desde timestamp with time zone default null,
  p_hasta timestamp with time zone default null,
  p_cuenta_id uuid default null,
  p_origen_tipos text[] default null,
  p_categoria_id uuid default null,
  p_sin_categoria boolean default false,
  p_metodo_pago_id uuid default null,
  p_usuario_id uuid default null,
  p_busqueda text default null,
  p_limite integer default 100,
  p_offset integer default 0,
  p_vista text default 'COMPLETA'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_limite integer := greatest(1, least(coalesce(p_limite, 100), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_busqueda text := nullif(btrim(p_busqueda), '');
  v_vista text := upper(coalesce(nullif(btrim(p_vista), ''), 'COMPLETA'));
  v_cuentas boolean;
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_out jsonb;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.ver_movimientos') then raise exception 'SIN_PERMISO' using errcode = '42501'; end if;
  if v_vista not in ('COMPLETA', 'CUENTAS') then raise exception 'VISTA_DESCONOCIDA'; end if;
  v_cuentas := v_vista = 'CUENTAS';
  if p_cuenta_id is not null and not exists (select 1 from public.cuentas_financieras c where c.id = p_cuenta_id and c.negocio_id = v_negocio) then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;
  with ledger as (
    -- TODO el ledger del negocio (o de la cuenta): el saldo posterior se calcula acá, antes de cualquier otro filtro.
    select m.*, sum(m.importe) over (partition by m.cuenta_financiera_id order by m.fecha_movimiento, m.id rows between unbounded preceding and current row) as saldo_posterior
      from public.movimientos_financieros m
     where m.negocio_id = v_negocio and (p_cuenta_id is null or m.cuenta_financiera_id = p_cuenta_id)
  ),
  filtrado as (
    -- Filtros sobre el ledger crudo (y datos), con EXISTS para otras tablas: se pagina ANTES de enriquecer.
    select l.* from ledger l
     where (p_desde is null or l.fecha_movimiento >= p_desde) and (p_hasta is null or l.fecha_movimiento < p_hasta)
       and (p_origen_tipos is null or l.origen_tipo = any (p_origen_tipos))
       and (p_usuario_id is null or l.registrado_por = p_usuario_id)
       and (p_metodo_pago_id is null or nullif(l.datos->>'metodo_pago_id', '')::uuid = p_metodo_pago_id)
       and (p_categoria_id is null or (l.origen_tipo = 'EGRESO' and exists (select 1 from public.egresos e where e.id = l.origen_id and e.negocio_id = v_negocio and e.categoria_id = p_categoria_id)))
       and (not coalesce(p_sin_categoria, false) or (l.origen_tipo = 'EGRESO' and exists (select 1 from public.egresos e where e.id = l.origen_id and e.negocio_id = v_negocio and e.tipo = 'OPERATIVO' and e.categoria_id is null)))
       and (v_busqueda is null or l.descripcion ilike '%' || v_busqueda || '%'
            or exists (select 1 from public.clientes cl where cl.negocio_id = v_negocio and cl.id = nullif(l.datos->>'cliente_id', '')::uuid and cl.nombre ilike '%' || v_busqueda || '%')
            or exists (select 1 from public.ordenes_compra oc where oc.id = l.orden_compra_id and oc.negocio_id = v_negocio and oc.proveedor ilike '%' || v_busqueda || '%'))
       -- Vista CUENTAS: el gasto y el ingreso cargados contra un cajón que
       -- alguien arquea ya se ven —y se explican— en el turno. Acá llegan
       -- adentro del cierre. El resto de los gastos (los de la caja general y
       -- los del banco) son justamente los que no se veían en ninguna parte.
       and (not v_cuentas or l.origen_tipo not in ('EGRESO', 'INGRESO')
            or not exists (select 1 from public.cuentas_financieras c
                            where c.id = l.cuenta_financiera_id and c.negocio_id = v_negocio
                              and c.tipo = 'CAJA_DIARIA'))
  ),
  agrupado as (
    -- Los cobros de venta colapsan a una fila por cuenta y por día; todo lo
    -- demás queda tal cual (su grupo es él mismo).
    --
    -- La fila consolidada se queda con la fecha, el id y el SALDO POSTERIOR
    -- del ÚLTIMO cobro del día: así ordena igual que el resto y su saldo
    -- sigue siendo un saldo real de la cuenta, no una suma inventada.
    --
    -- Y se queda SIN `datos`, sin `origen_id` y sin `turno_caja_id`: un grupo
    -- abarca muchas ventas, así que method, cliente, comprobante y turno no
    -- tienen un valor verdadero. Ponerle el de una de las ventas sería
    -- elegir una al azar y presentarla como la del conjunto.
    select
      (array_agg(f.id order by f.fecha_movimiento desc, f.id desc))[1] as id,
      max(f.fecha_movimiento) as fecha_movimiento,
      max(f.registrado_en) as registrado_en,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' and count(*) > 1
           then 'CONSOLIDADO_DIA' else min(f.evento) end as evento,
      f.origen_tipo,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.origen_id order by f.id))[1] end as origen_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.operacion_id order by f.id))[1] end as operacion_id,
      sum(f.importe) as importe,
      sum(f.impacto_resultado) as impacto_resultado,
      (array_agg(f.saldo_posterior order by f.fecha_movimiento desc, f.id desc))[1] as saldo_posterior,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' and count(*) > 1
           then null else min(f.descripcion) end as descripcion,
      f.cuenta_financiera_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.turno_caja_id order by f.id))[1] end as turno_caja_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.orden_compra_id order by f.id))[1] end as orden_compra_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.datos order by f.id))[1] end as datos,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.registrado_por order by f.id))[1] end as registrado_por,
      count(*)::integer as cantidad
    from filtrado f
    group by
      f.cuenta_financiera_id,
      f.origen_tipo,
      -- La clave del grupo: el día local para los cobros consolidables, y el
      -- id propio para todo lo demás (un grupo de uno).
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO'
           then null else f.id end,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO'
           then (f.fecha_movimiento at time zone v_tz)::date else null end
  ),
  contado as (select a.*, count(*) over () as total from agrupado a),
  pagina as (select * from contado order by fecha_movimiento desc, id desc limit v_limite offset v_offset),
  enriquecido as (
    select l.*, c.nombre as cuenta_nombre, c.tipo as cuenta_tipo, cc.nombre as cuenta_contraparte_nombre, p.nombre as usuario_nombre,
           e.categoria_id, ce.nombre as categoria_nombre, coalesce(e.tipo, l.datos->>'tipo', l.datos->'anterior'->>'tipo') as egreso_tipo,
           nullif(l.datos->>'metodo_pago_id', '')::uuid as metodo_pago_id, l.datos->>'metodo_nombre' as metodo_nombre, l.datos->>'metodo_tipo' as metodo_tipo,
           nullif(l.datos->>'venta_id', '')::uuid as venta_id, cl.nombre as cliente_nombre,
           co.tipo as comprobante_tipo, co.punto_venta as comprobante_punto_venta, co.numero as comprobante_numero,
           oc.proveedor, nullif(l.datos->>'revierte_a', '')::uuid as revierte_a
      from pagina l
      join public.cuentas_financieras c on c.id = l.cuenta_financiera_id and c.negocio_id = v_negocio
      left join public.cuentas_financieras cc on cc.negocio_id = v_negocio
       and cc.id = coalesce(nullif(l.datos->>'cuenta_contraparte_id', '')::uuid, case when l.importe < 0 then nullif(l.datos->>'cuenta_destino_id', '')::uuid else nullif(l.datos->>'cuenta_origen_id', '')::uuid end)
       and cc.id <> l.cuenta_financiera_id
      left join public.perfiles p on p.id = l.registrado_por
      left join public.egresos e on l.origen_tipo = 'EGRESO' and e.id = l.origen_id and e.negocio_id = v_negocio
      left join public.categorias_egreso ce on ce.id = e.categoria_id and ce.negocio_id = v_negocio
      left join public.clientes cl on cl.negocio_id = v_negocio and cl.id = nullif(l.datos->>'cliente_id', '')::uuid
      left join lateral (select x.tipo, x.punto_venta, x.numero from public.comprobantes x where x.negocio_id = v_negocio and x.venta_id = nullif(l.datos->>'venta_id', '')::uuid order by x.emitido_en desc limit 1) co on true
      left join public.ordenes_compra oc on oc.id = l.orden_compra_id and oc.negocio_id = v_negocio
  )
  select jsonb_build_object('total', coalesce(max(f.total), 0), 'filas', coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'fecha', f.fecha_movimiento, 'registrado_en', f.registrado_en, 'evento', f.evento, 'origen_tipo', f.origen_tipo, 'origen_id', f.origen_id, 'operacion_id', f.operacion_id,
      'importe', f.importe, 'impacto_resultado', f.impacto_resultado, 'saldo_posterior', f.saldo_posterior, 'descripcion', f.descripcion,
      'cuenta_id', f.cuenta_financiera_id, 'cuenta_nombre', f.cuenta_nombre, 'cuenta_tipo', f.cuenta_tipo, 'cuenta_contraparte_nombre', f.cuenta_contraparte_nombre,
      'categoria_id', f.categoria_id, 'categoria_nombre', f.categoria_nombre, 'egreso_tipo', f.egreso_tipo,
      'metodo_pago_id', f.metodo_pago_id, 'metodo_nombre', f.metodo_nombre, 'metodo_tipo', f.metodo_tipo,
      'usuario_id', f.registrado_por, 'usuario_nombre', f.usuario_nombre, 'turno_caja_id', f.turno_caja_id,
      'venta_id', f.venta_id, 'cliente_nombre', f.cliente_nombre, 'comprobante_tipo', f.comprobante_tipo, 'comprobante_punto_venta', f.comprobante_punto_venta, 'comprobante_numero', f.comprobante_numero,
      'orden_compra_id', f.orden_compra_id, 'proveedor', f.proveedor, 'revierte_a', f.revierte_a,
      -- Cuántos movimientos reales hay detrás de la fila. 1 en todo lo que no
      -- se consolidó; la pantalla lo usa para decir "9 cobros" en vez de
      -- inventar una descripción.
      'cantidad', f.cantidad
    ) order by f.fecha_movimiento desc, f.id desc), '[]'::jsonb))
  into v_out from enriquecido f;
  return v_out;
end; $function$;
do $$
declare v_def text := pg_get_functiondef('public.movimientos_financieros_negocio(timestamptz,timestamptz,uuid,text[],uuid,boolean,uuid,uuid,text,integer,integer,text)'::regprocedure);
begin
  -- No puede volver ningún min() sobre una columna sin operador de orden.
  if v_def ~ 'min\(f\.(origen_id|operacion_id|turno_caja_id|orden_compra_id|registrado_por|datos)\)' then
    raise exception 'GUARD: volvió un min() sobre una columna sin operador de orden';
  end if;
end $$;
