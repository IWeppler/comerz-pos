-- ═══════════════════════════════════════════════════════════════════════════
-- LA TABLA DE MOVIMIENTOS TIENE DOS VISTAS, PORQUE SON DOS PREGUNTAS
--
-- En Hoy, "Movimientos de mi turno" lista cada venta y cada gasto del cajón:
-- es lo que la cajera reconstruye cuando cuenta la plata, y su unidad es el
-- TICKET.
--
-- En Dinero, la pregunta es "qué movió el saldo de mis cuentas". Ahí la caja
-- chica entra como UN número —lo que se abrió, lo que se cerró, la diferencia
-- de arqueo— y no como las 1.596 ventas que la llenaron.
--
-- Hasta ahora la segunda no existía: `movimientos_financieros_negocio`
-- devuelve el ledger crudo y la pantalla intentaba recortarlo desde Node. Eso
-- no se puede hacer bien desde afuera por dos motivos que esta migración
-- resuelve: el `total` de la paginación tiene que contar lo que se muestra, y
-- la consolidación tiene que conservar el SALDO POSTERIOR real de la cuenta,
-- que se calcula sobre el ledger entero antes de filtrar nada.
--
-- ───────────────────────────────────────────────────────────────────────────
-- EL CASO QUE FIJÓ LA REGLA (Evens, 21/9/2026)
--
--   Efectivo  9 cobros → Caja diaria +$305.650, y el CIERRE_TURNO lo pasa a
--             Caja general. DOS filas, misma operación: el cierre YA es la
--             consolidación del cajón.
--   Digital   9 cobros → "TRANSFERENCIA MERCADO PAGO" +$282.175. NUEVE filas
--             sueltas, ninguna consolidación — la plata digital nunca pasa
--             por el cajón, va directo a la cuenta del método en el momento
--             de cada venta.
--
-- Por eso "esconder los cobros de venta" era una respuesta equivocada: en el
-- cajón sobran (el cierre los representa) y en el banco hacen falta (sin
-- ellos, Mercado Pago sube $282.175 sin una sola fila que lo explique). Son
-- 1.111 cobros directos a banco y billetera en el SaaS.
--
-- La regla que queda, y que vale para toda vista nueva de este ledger:
-- **una fila por cuenta y por día para lo que se genera de a muchos; una fila
-- por evento para lo que se decide de a uno.** Un gasto, un ingreso, una
-- transferencia y una acreditación son decisiones de alguien y se muestran
-- enteras; un cobro es el subproducto de vender y se muestra sumado.
-- ───────────────────────────────────────────────────────────────────────────
--
-- POR QUÉ UN PARÁMETRO Y NO UNA RPC NUEVA: el enriquecido (siete joins,
-- comprobante por lateral, categoría viva de `egresos`) es el mismo, y
-- duplicarlo garantiza que dentro de tres meses las dos digan cosas distintas
-- sobre la misma fila. Es el mismo criterio que `aprobar_orden_compra` con su
-- `_impl`.
--
-- `p_vista` es FAIL-CLOSED: un valor que esta función no conoce aborta en vez
-- de caer en la vista completa. Caer en la completa sería mostrar las 1.596
-- ventas del cajón en la pantalla que existe justamente para no mostrarlas, y
-- un typo en el cliente no puede tener ese efecto.
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
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else min(f.origen_id) end as origen_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else min(f.operacion_id) end as operacion_id,
      sum(f.importe) as importe,
      sum(f.impacto_resultado) as impacto_resultado,
      (array_agg(f.saldo_posterior order by f.fecha_movimiento desc, f.id desc))[1] as saldo_posterior,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' and count(*) > 1
           then null else min(f.descripcion) end as descripcion,
      f.cuenta_financiera_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else min(f.turno_caja_id) end as turno_caja_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else min(f.orden_compra_id) end as orden_compra_id,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else (array_agg(f.datos order by f.id))[1] end as datos,
      case when v_cuentas and f.origen_tipo = 'VENTA_PAGO' then null else min(f.registrado_por) end as registrado_por,
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

-- ───────────────────────────────────────────────────────────────────────────
-- LA FIRMA VIEJA SE BORRA, Y NO ES PROLIJIDAD
--
-- `create or replace` con un parámetro más NO reemplaza la función anterior:
-- crea una SEGUNDA con otra aridad. Con las dos vivas, el código que está hoy
-- en producción —que manda 11 argumentos— deja de resolver: las dos son
-- candidatas (la nueva tiene DEFAULT en `p_vista`) y PostgREST devuelve
-- "Could not choose the best candidate function". O sea que la pestaña de
-- movimientos se cae entre que se aplica la migración y se despliega la app.
--
-- Va en la misma transacción que el `create`, así que no hay ventana en la
-- que no exista ninguna. Y después del drop, el código viejo sigue andando:
-- con una sola candidata, el parámetro que no manda toma su default
-- ('COMPLETA'), que es exactamente el comportamiento de antes.
-- ───────────────────────────────────────────────────────────────────────────
drop function if exists public.movimientos_financieros_negocio(
  timestamp with time zone, timestamp with time zone, uuid, text[], uuid,
  boolean, uuid, uuid, text, integer, integer
);

do $$
begin
  if (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'movimientos_financieros_negocio') <> 1 then
    raise exception 'GUARD: quedó más de una versión de la función; PostgREST no va a poder elegir';
  end if;
end $$;

comment on function public.movimientos_financieros_negocio is
  'Movimientos del ledger. p_vista COMPLETA = una fila por movimiento (la tabla general). p_vista CUENTAS = la vista de Dinero: los cobros de venta se consolidan por cuenta y por día, y el detalle del cajón (gastos e ingresos contra una CAJA_DIARIA) queda afuera porque ya se ve en el turno. El saldo posterior sale del ledger completo en las dos.';

-- ───────────────────────────────────────────────────────────────────────────
-- GUARDS. Se verifica lo que la función PROMETE, no que el texto compile.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_def text := pg_get_functiondef('public.movimientos_financieros_negocio(timestamptz,timestamptz,uuid,text[],uuid,boolean,uuid,uuid,text,integer,integer,text)'::regprocedure);
begin
  -- 1. El orden que sostiene los números: la ventana del saldo va sobre el
  --    ledger ENTERO, antes de filtrar; recién después se agrupa, se cuenta,
  --    se pagina y se enriquece. Invertir dos de estos pasos da un número que
  --    parece bien y no lo es.
  if position('ledger as (' in v_def) = 0
     or position('filtrado as (' in v_def) <= position('ledger as (' in v_def)
     or position('agrupado as (' in v_def) <= position('filtrado as (' in v_def)
     or position('contado as (' in v_def) <= position('agrupado as (' in v_def)
     or position('pagina as (' in v_def) <= position('contado as (' in v_def)
     or position('enriquecido as (' in v_def) <= position('pagina as (' in v_def) then
    raise exception 'GUARD: el orden ventana -> filtro -> grupo -> conteo -> pagina -> enriquecer se rompió';
  end if;

  -- 2. El total tiene que contar lo que se MUESTRA. Si el count(*) over ()
  --    vuelve a `filtrado`, la paginación cuenta cobros sueltos y la vista de
  --    cuentas promete páginas que no existen.
  if position('count(*) over () as total' in v_def) < position('agrupado as (' in v_def) then
    raise exception 'GUARD: el total se cuenta antes de consolidar';
  end if;

  -- 3. Fail-closed sobre la vista.
  if position('VISTA_DESCONOCIDA' in v_def) = 0 then
    raise exception 'GUARD: p_vista dejó de ser fail-closed';
  end if;

  -- 4. Sigue siendo SECURITY DEFINER, así que cada consulta a otra tabla
  --    filtra negocio_id a mano. Se cuentan las apariciones: si alguien
  --    agrega un join sin el filtro, este número baja respecto de los joins.
  if (length(v_def) - length(replace(v_def, 'negocio_id = v_negocio', ''))) / length('negocio_id = v_negocio') < 12 then
    raise exception 'GUARD: hay consultas sin filtrar por negocio_id';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN CONTRA DATOS REALES
--
-- La vista CUENTAS no puede cambiar cuánta plata entró: consolidar es sumar,
-- no reinterpretar. Se comprueba que, por cuenta, la suma de los importes de
-- la vista consolidada sea EXACTAMENTE la del ledger para los mismos
-- orígenes — al peso, sin tolerancia.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_importes integer;
  v_conteos integer;
  v_crudos bigint;
  v_filas bigint;
begin
  with crudo as (
    select m.negocio_id, m.cuenta_financiera_id, sum(m.importe) s, count(*) n
      from public.movimientos_financieros m
     where m.origen_tipo = 'VENTA_PAGO'
     group by 1, 2
  ),
  consolidado as (
    select g.negocio_id, g.cuenta_financiera_id, sum(g.s) s, sum(g.n) n
      from (
        select m.negocio_id, m.cuenta_financiera_id,
               (m.fecha_movimiento at time zone 'America/Argentina/Buenos_Aires')::date d,
               sum(m.importe) s, count(*) n
          from public.movimientos_financieros m
         where m.origen_tipo = 'VENTA_PAGO'
         group by 1, 2, 3
      ) g
     group by 1, 2
  )
  select count(*) filter (where c.s is distinct from k.s),
         count(*) filter (where c.n is distinct from k.n),
         sum(k.n)
    into v_importes, v_conteos, v_crudos
    from crudo k join consolidado c using (negocio_id, cuenta_financiera_id);

  -- Consolidar es SUMAR, no reinterpretar: por cuenta, la vista agrupada
  -- tiene que dar exactamente lo mismo que el ledger crudo. Al peso, sin
  -- tolerancia — una diferencia de un centavo acá es plata que se perdió
  -- entre dos formas de mostrar el mismo hecho.
  if v_importes > 0 then raise exception 'GUARD: consolidar cambia los importes en % cuentas', v_importes; end if;
  if v_conteos > 0 then raise exception 'GUARD: consolidar pierde cobros en % cuentas', v_conteos; end if;

  select count(*) into v_filas from (
    select 1 from public.movimientos_financieros m
     where m.origen_tipo = 'VENTA_PAGO'
     group by m.negocio_id, m.cuenta_financiera_id,
              (m.fecha_movimiento at time zone 'America/Argentina/Buenos_Aires')::date) x;

  raise notice 'Vista CUENTAS lista: % cobros entran como % filas.', v_crudos, v_filas;
end $$;
