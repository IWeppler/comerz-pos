-- La tabla general de movimientos: RPC `movimientos_financieros_negocio`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- QUÉ ES
--
-- La fuente única para responder "qué pasó con la plata": una fila por
-- movimiento del ledger (`movimientos_financieros`), de TODAS las cuentas del
-- negocio, con lo que hace falta para leerla sin abrir otra pantalla —
-- cuenta, categoría, método de pago, quién, la venta o el remito de donde
-- salió, y el SALDO POSTERIOR de la cuenta después de ese movimiento. Con
-- filtros por período, cuenta, tipo, categoría, método, usuario y texto.
--
-- Es la generalización de `movimientos_de_cuenta` (`20260921150000`), que
-- sigue existiendo para el detalle de UNA cuenta.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DECISIONES
--
-- * **El saldo posterior se calcula sobre TODOS los movimientos de la cuenta,
--   ANTES de filtrar.** Un `sum() over (partition by cuenta order by fecha,
--   id)` sobre la lista ya filtrada daría el saldo "de lo que se ve", que no
--   es ningún saldo. La ventana corre en un CTE sobre el ledger entero del
--   negocio y recién después se aplican filtros y paginado. Hoy son ~5.000
--   filas en todo el SaaS y el índice `(negocio, cuenta, fecha desc, id
--   desc)` ya existe; el día que sea caro se materializa, pero no se cambia
--   la definición.
--
-- * **Ordena por `(fecha_movimiento, id)`, no por `registrado_en`.** La fecha
--   económica es la que define el saldo: una corrección de un gasto de julio
--   registrada en septiembre va en julio (`20260921180000`), y el saldo
--   posterior de las filas de agosto tiene que incluirla. `registrado_en` se
--   devuelve igual, para la auditoría.
--
-- * **La categoría se lee VIVA de `egresos`**, no del snapshot: recategorizar
--   mueve el gasto de columna en toda la historia, que es lo que se espera de
--   una etiqueta. Para un egreso anulado (la fila ya no está) queda null; su
--   snapshot sigue en `datos.anterior`.
--
-- * **El método de pago sale del snapshot `datos`** del cobro, que quedó
--   congelado al registrarse: si mañana renombran el método, la fila dice lo
--   que decía. `metodo_pago_id` también viaja, para el filtro.
--
-- * **Una fila es un movimiento, no una operación.** Una transferencia son
--   dos filas (salida y entrada) con la misma `operacion_id`, y se devuelven
--   las dos: cada una es un movimiento real de SU cuenta. Filtrar por cuenta
--   deja una sola, que es lo correcto. `operacion_id` y
--   `cuenta_contraparte_nombre` viajan para que la pantalla pueda agruparlas
--   o mostrar "→ Mercado Pago".
--
-- * **El número de comprobante va crudo** (`punto_venta`, `numero`, `tipo`) y
--   lo formatea `formatearNumeroComprobante` en TS, que ya es la única forma
--   de escribirlo. Sin comprobante, la pantalla cae al prefijo del UUID de la
--   venta, igual que el ticket.
--
-- * **Se pagina ANTES de enriquecer.** Los joins (cuenta, usuario, egreso,
--   categoría, cliente, comprobante, remito) corren sobre la página, no sobre
--   la historia; los filtros que necesitan otra tabla van con EXISTS. Medido:
--   731 ms enriqueciendo las 2.595 filas de Evens antes de paginar.
--
-- * Tope de 200 por página recortado en la BASE. `total` viaja para el
--   paginado y se cuenta sobre el conjunto filtrado con `count(*) over ()`.
--
-- * Permiso `caja.ver_movimientos` (`20260921160000`). DEFINER: filtra
--   `negocio_id` en cada consulta; guard que lo cuenta.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.movimientos_financieros_negocio(
  p_desde timestamptz default null,
  p_hasta timestamptz default null,
  p_cuenta_id uuid default null,
  p_origen_tipos text[] default null,
  p_categoria_id uuid default null,
  p_sin_categoria boolean default false,
  p_metodo_pago_id uuid default null,
  p_usuario_id uuid default null,
  p_busqueda text default null,
  p_limite integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_limite integer := greatest(1, least(coalesce(p_limite, 100), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_busqueda text := nullif(btrim(p_busqueda), '');
  v_out jsonb;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.tiene_permiso('caja.ver_movimientos') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_cuenta_id is not null and not exists (
    select 1 from public.cuentas_financieras c
     where c.id = p_cuenta_id and c.negocio_id = v_negocio
  ) then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;

  with ledger as (
    -- TODO el ledger del negocio (o de la cuenta): el saldo posterior se
    -- calcula acá, antes de cualquier otro filtro.
    select m.*,
           sum(m.importe) over (
             partition by m.cuenta_financiera_id
             order by m.fecha_movimiento, m.id
             rows between unbounded preceding and current row
           ) as saldo_posterior
      from public.movimientos_financieros m
     where m.negocio_id = v_negocio
       and (p_cuenta_id is null or m.cuenta_financiera_id = p_cuenta_id)
  ),
  filtrado as (
    -- Los filtros se aplican sobre el ledger crudo (y `datos`), con EXISTS
    -- para los que necesitan otra tabla: así se pagina ANTES de enriquecer y
    -- los siete joins corren sobre una página, no sobre la historia entera.
    -- Medido sobre las 2.595 filas de Evens: 731 ms enriqueciendo todo.
    select l.*, count(*) over () as total
      from ledger l
     where (p_desde is null or l.fecha_movimiento >= p_desde)
       and (p_hasta is null or l.fecha_movimiento <  p_hasta)
       and (p_origen_tipos is null or l.origen_tipo = any (p_origen_tipos))
       and (p_usuario_id is null or l.registrado_por = p_usuario_id)
       and (p_metodo_pago_id is null
            or nullif(l.datos->>'metodo_pago_id', '')::uuid = p_metodo_pago_id)
       and (p_categoria_id is null
            or (l.origen_tipo = 'EGRESO' and exists (
                  select 1 from public.egresos e
                   where e.id = l.origen_id and e.negocio_id = v_negocio
                     and e.categoria_id = p_categoria_id)))
       and (not coalesce(p_sin_categoria, false)
            or (l.origen_tipo = 'EGRESO' and exists (
                  select 1 from public.egresos e
                   where e.id = l.origen_id and e.negocio_id = v_negocio
                     and e.tipo = 'OPERATIVO' and e.categoria_id is null)))
       and (v_busqueda is null
            or l.descripcion ilike '%' || v_busqueda || '%'
            or exists (
                 select 1 from public.clientes cl
                  where cl.negocio_id = v_negocio
                    and cl.id = nullif(l.datos->>'cliente_id', '')::uuid
                    and cl.nombre ilike '%' || v_busqueda || '%')
            or exists (
                 select 1 from public.ordenes_compra oc
                  where oc.id = l.orden_compra_id and oc.negocio_id = v_negocio
                    and oc.proveedor ilike '%' || v_busqueda || '%'))
  ),
  pagina as (
    select * from filtrado
     order by fecha_movimiento desc, id desc
     limit v_limite offset v_offset
  ),
  enriquecido as (
    select l.*,
           c.nombre  as cuenta_nombre,
           c.tipo    as cuenta_tipo,
           cc.nombre as cuenta_contraparte_nombre,
           p.nombre  as usuario_nombre,
           -- Egreso: categoría y tipo VIVOS si la fila existe; si se anuló,
           -- el tipo sale del snapshot y la categoría queda null.
           e.categoria_id,
           ce.nombre as categoria_nombre,
           coalesce(e.tipo, l.datos->>'tipo',
                    l.datos->'anterior'->>'tipo') as egreso_tipo,
           -- Cobro: método y venta desde el snapshot congelado.
           nullif(l.datos->>'metodo_pago_id', '')::uuid as metodo_pago_id,
           l.datos->>'metodo_nombre' as metodo_nombre,
           l.datos->>'metodo_tipo'   as metodo_tipo,
           nullif(l.datos->>'venta_id', '')::uuid as venta_id,
           cl.nombre as cliente_nombre,
           co.tipo as comprobante_tipo,
           co.punto_venta as comprobante_punto_venta,
           co.numero as comprobante_numero,
           oc.proveedor,
           nullif(l.datos->>'revierte_a', '')::uuid as revierte_a
      from pagina l
      join public.cuentas_financieras c
        on c.id = l.cuenta_financiera_id and c.negocio_id = v_negocio
      left join public.cuentas_financieras cc
        on cc.negocio_id = v_negocio
       and cc.id = coalesce(
             nullif(l.datos->>'cuenta_contraparte_id', '')::uuid,
             case when l.importe < 0 then nullif(l.datos->>'cuenta_destino_id', '')::uuid
                  else nullif(l.datos->>'cuenta_origen_id', '')::uuid end
           )
       and cc.id <> l.cuenta_financiera_id
      left join public.perfiles p on p.id = l.registrado_por
      left join public.egresos e
        on l.origen_tipo = 'EGRESO' and e.id = l.origen_id and e.negocio_id = v_negocio
      left join public.categorias_egreso ce
        on ce.id = e.categoria_id and ce.negocio_id = v_negocio
      left join public.clientes cl
        on cl.negocio_id = v_negocio
       and cl.id = nullif(l.datos->>'cliente_id', '')::uuid
      left join lateral (
        select x.tipo, x.punto_venta, x.numero
          from public.comprobantes x
         where x.negocio_id = v_negocio
           and x.venta_id = nullif(l.datos->>'venta_id', '')::uuid
         order by x.emitido_en desc
         limit 1
      ) co on true
      left join public.ordenes_compra oc
        on oc.id = l.orden_compra_id and oc.negocio_id = v_negocio
  )
  select jsonb_build_object(
    'total', coalesce(max(f.total), 0),
    'filas', coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id,
      'fecha', f.fecha_movimiento,
      'registrado_en', f.registrado_en,
      'evento', f.evento,
      'origen_tipo', f.origen_tipo,
      'origen_id', f.origen_id,
      'operacion_id', f.operacion_id,
      'importe', f.importe,
      'impacto_resultado', f.impacto_resultado,
      'saldo_posterior', f.saldo_posterior,
      'descripcion', f.descripcion,
      'cuenta_id', f.cuenta_financiera_id,
      'cuenta_nombre', f.cuenta_nombre,
      'cuenta_tipo', f.cuenta_tipo,
      'cuenta_contraparte_nombre', f.cuenta_contraparte_nombre,
      'categoria_id', f.categoria_id,
      'categoria_nombre', f.categoria_nombre,
      'egreso_tipo', f.egreso_tipo,
      'metodo_pago_id', f.metodo_pago_id,
      'metodo_nombre', f.metodo_nombre,
      'metodo_tipo', f.metodo_tipo,
      'usuario_id', f.registrado_por,
      'usuario_nombre', f.usuario_nombre,
      'turno_caja_id', f.turno_caja_id,
      'venta_id', f.venta_id,
      'cliente_nombre', f.cliente_nombre,
      'comprobante_tipo', f.comprobante_tipo,
      'comprobante_punto_venta', f.comprobante_punto_venta,
      'comprobante_numero', f.comprobante_numero,
      'orden_compra_id', f.orden_compra_id,
      'proveedor', f.proveedor,
      'revierte_a', f.revierte_a
    ) order by f.fecha_movimiento desc, f.id desc), '[]'::jsonb)
  )
  into v_out
  from enriquecido f;

  return v_out;
end;
$$;

revoke all on function public.movimientos_financieros_negocio(
  timestamptz, timestamptz, uuid, text[], uuid, boolean, uuid, uuid, text, integer, integer
) from public, anon;
grant execute on function public.movimientos_financieros_negocio(
  timestamptz, timestamptz, uuid, text[], uuid, boolean, uuid, uuid, text, integer, integer
) to authenticated;

comment on function public.movimientos_financieros_negocio(
  timestamptz, timestamptz, uuid, text[], uuid, boolean, uuid, uuid, text, integer, integer
) is
  'Tabla general de movimientos de dinero del negocio, con saldo posterior por cuenta (calculado sobre el ledger entero, antes de filtrar) y los datos relacionados (cuenta, categoría viva, método congelado, usuario, venta/comprobante, remito/proveedor). Tope 200 recortado en la base. Gate: caja.ver_movimientos.';

-- ─────────────────────────────────────────────────────────────────────────
-- GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $guard$
declare
  v_def text := pg_get_functiondef(
    'public.movimientos_financieros_negocio(timestamptz,timestamptz,uuid,text[],uuid,boolean,uuid,uuid,text,integer,integer)'::regprocedure
  );
  v_filtros int := (select count(*) from regexp_matches(v_def, 'negocio_id = v_negocio', 'g'));
begin
  if v_def not like '%caja.ver_movimientos%' then
    raise exception 'GUARD: la tabla general no pide caja.ver_movimientos';
  end if;
  -- DEFINER: el ledger, la cuenta (y su verificación), la contraparte, el
  -- egreso, la categoría, el cliente, el comprobante y el remito filtran
  -- negocio. Nueve como mínimo.
  if v_filtros < 9 then
    raise exception 'GUARD: la tabla general tiene % filtros de negocio, se esperaban al menos 9', v_filtros;
  end if;
  -- La ventana corre ANTES del filtro: está en el primer CTE, no en `filtrado`.
  if position('saldo_posterior' in v_def) > position('filtrado as' in v_def)
     or position('filtrado as' in v_def) > position('enriquecido as' in v_def) then
    raise exception 'GUARD: el orden ventana → filtro → página → enriquecer se rompió';
  end if;
end
$guard$;

commit;
