-- IMEI que no depende de que alguien se acuerde (7/10/2026).
--
-- Caso: ClickTostado, venta 1-18 del 6/10 (Redmi Note 14 Pro+). El POS no pidió
-- el IMEI y el ticket salió sin número: el producto entró sin IMEI (carga
-- masiva / a mano) y `productos.lleva_serie` solo se prende al cargar la primera
-- unidad. 8 de los 17 celulares/tablets del comercio estaban sin marca y ya se
-- habían vendido 5 aparatos sin número.
--
-- Qué hace:
--   1. `categorias.lleva_serie`: la marca vive en la CATEGORÍA (Celulares,
--      Tablets). Un producto lleva IMEI si lo dice él, su categoría o la
--      categoría padre (árbol de 2 niveles). Así un celular nuevo, venga de
--      donde venga, ya lo pide.
--   2. `productos_llevan_serie(uuid[])` (el criterio, UNA vez, en SQL), más
--      `variantes_llevan_serie(uuid[])` y `categorias_llevan_serie()` que se
--      apoyan en él. Los usan el POS, create-sale y la conciliación; nadie lo
--      reescribe en TS.
--   3. `ventas_items.motivo_sin_imei`: por qué un aparato salió sin número
--      ("sin conexión", "caja sellada"...). NULL = no aplica o tiene IMEI.
--      `registrar_venta` lo graba (3b).
--   4. `completar_imei_venta_item`: atar después el IMEI a un renglón vendido
--      sin número. Crea la unidad ya VENDIDA, no mueve stock.
--   5. `aprobar_orden_compra_impl` acepta `imeis` (array) por renglón además
--      del `imei` de siempre: un renglón "Samsung A17 x3" sin IMEI en el Excel
--      se completa en la conciliación con tres números. Guard nuevo
--      `REMITO_IMEIS_DE_MAS`.
--   6. Datos: Celulares y Tablets de ClickTostado marcadas.
--
-- `normalizar_imei` es el ESPEJO de `entities/ventas/imei.ts` (normalizarImei):
-- sin espacios y en mayúsculas. Los dos dicen lo mismo.
--
-- Aditiva salvo (3b) y (5), que se reescriben desde el cuerpo VIVO con replace() y
-- guards de que cada reemplazo matchea una sola vez. Reversión:
-- supabase/reversals/20261007120000_imei_por_categoria.sql

-- 1. Marca por categoría ----------------------------------------------------

alter table public.categorias
  add column if not exists lleva_serie boolean not null default false;

comment on column public.categorias.lleva_serie is
  'Los productos de esta categoria (y de sus hijas) se venden con IMEI / numero de serie. Ver variantes_llevan_serie.';

-- 2. El criterio ------------------------------------------------------------

create or replace function public.normalizar_imei(p_valor text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select nullif(upper(regexp_replace(coalesce(p_valor, ''), '\s+', '', 'g')), '');
$function$;

comment on function public.normalizar_imei(text) is
  'Espejo de entities/ventas/imei.ts (normalizarImei): sin espacios, mayusculas. NULL si queda vacio.';

-- Devuelven TABLE (no setof uuid) para que PostgREST mande filas con nombre
-- de columna ({ variante_id }) y el código no dependa de cómo serializa un
-- escalar.
--
-- Categorías del negocio actual que llevan IMEI: marcadas ellas o su padre.
-- INVOKER: la RLS de categorias ya aísla por negocio.
create or replace function public.categorias_llevan_serie()
returns table (categoria_id uuid)
language sql
stable
set search_path to ''
as $function$
  select c.id
  from public.categorias c
  left join public.categorias padre on padre.id = c.parent_id
  where c.lleva_serie or coalesce(padre.lleva_serie, false);
$function$;

-- Productos (de los pedidos) que llevan IMEI: marcados ellos o su categoría.
-- ES el criterio; las variantes lo heredan de acá.
create or replace function public.productos_llevan_serie(p_producto_ids uuid[])
returns table (producto_id uuid)
language sql
stable
set search_path to ''
as $function$
  select p.id
  from public.productos p
  where p.id = any (p_producto_ids)
    and (
      p.lleva_serie
      or p.categoria_id in (select c.categoria_id from public.categorias_llevan_serie() c)
    );
$function$;

create or replace function public.variantes_llevan_serie(p_variante_ids uuid[])
returns table (variante_id uuid)
language sql
stable
set search_path to ''
as $function$
  select v.id
  from public.producto_variantes v
  where v.id = any (p_variante_ids)
    and v.producto_id in (
      select l.producto_id
      from public.productos_llevan_serie(
        array(
          select v2.producto_id
          from public.producto_variantes v2
          where v2.id = any (p_variante_ids)
        )
      ) l
    );
$function$;

revoke all on function public.normalizar_imei(text) from public, anon;
revoke all on function public.categorias_llevan_serie() from public, anon;
revoke all on function public.productos_llevan_serie(uuid[]) from public, anon;
revoke all on function public.variantes_llevan_serie(uuid[]) from public, anon;
grant execute on function public.normalizar_imei(text) to authenticated;
grant execute on function public.categorias_llevan_serie() to authenticated;
grant execute on function public.productos_llevan_serie(uuid[]) to authenticated;
grant execute on function public.variantes_llevan_serie(uuid[]) to authenticated;

-- 3. Motivo de venta sin IMEI ----------------------------------------------

alter table public.ventas_items
  add column if not exists motivo_sin_imei text;

alter table public.ventas_items
  drop constraint if exists ventas_items_motivo_sin_imei_no_vacio;
alter table public.ventas_items
  add constraint ventas_items_motivo_sin_imei_no_vacio
  check (motivo_sin_imei is null or length(trim(motivo_sin_imei)) between 1 and 200);

comment on column public.ventas_items.motivo_sin_imei is
  'Por que el aparato salio sin IMEI, elegido en el POS. NULL = no aplica o tiene IMEI. Se conserva aunque despues se complete el numero (historia).';

-- 3b. registrar_venta graba el motivo. Inserta ventas_items con una lista de
-- columnas FIJA (jsonb_to_recordset): sin esto el motivo que manda
-- create-sale se descartaría en silencio. Reemplazos sobre el cuerpo VIVO.
do $registrar$
declare
  v_firma constant text := 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])';
  v_def text;
  v_nuevo text;
  v_overloads int;
  v_pares text[][] := array[
    [$v$    precio_unitario, precio_costo, descuento_monto, precio_final,
    promocion_id, promocion_nombre, es_venta_libre
  )$v$,
     $v$    precio_unitario, precio_costo, descuento_monto, precio_final,
    promocion_id, promocion_nombre, es_venta_libre, motivo_sin_imei
  )$v$],
    [$v$    coalesce(i.es_venta_libre, false)
  from jsonb_to_recordset(p_items) as i($v$,
     $v$    coalesce(i.es_venta_libre, false),
    nullif(trim(i.motivo_sin_imei), '')
  from jsonb_to_recordset(p_items) as i($v$],
    [$v$    precio_final numeric, promocion_id uuid, promocion_nombre text,
    es_venta_libre boolean
  );$v$,
     $v$    precio_final numeric, promocion_id uuid, promocion_nombre text,
    es_venta_libre boolean, motivo_sin_imei text
  );$v$]
  ];
  i int;
  v_ocurrencias int;
begin
  select count(*) into v_overloads
  from pg_proc where proname = 'registrar_venta'
    and pronamespace = 'public'::regnamespace;
  if v_overloads <> 1 then
    raise exception 'registrar_venta: se esperaba 1 version y hay %', v_overloads;
  end if;

  v_def := pg_get_functiondef(v_firma::regprocedure);
  v_nuevo := v_def;
  for i in 1 .. array_length(v_pares, 1) loop
    v_ocurrencias :=
      (length(v_nuevo) - length(replace(v_nuevo, v_pares[i][1], ''))) / length(v_pares[i][1]);
    if v_ocurrencias <> 1 then
      raise exception 'registrar_venta: el reemplazo % matchea % veces (se esperaba 1)',
        i, v_ocurrencias;
    end if;
    v_nuevo := replace(v_nuevo, v_pares[i][1], v_pares[i][2]);
  end loop;

  execute v_nuevo;

  v_def := pg_get_functiondef(v_firma::regprocedure);
  if position('VENTA_SIN_RENGLONES' in v_def) = 0
     or position('security.current_negocio_id()' in v_def) = 0
     or position('es_venta_libre, motivo_sin_imei' in v_def) = 0
     or position('es_venta_libre boolean, motivo_sin_imei text' in v_def) = 0
     or length(v_def) - length(v_nuevo) <> 0 then
    raise exception 'registrar_venta: el cuerpo nuevo no tiene la forma esperada';
  end if;

  select count(*) into v_overloads
  from pg_proc where proname = 'registrar_venta'
    and pronamespace = 'public'::regnamespace;
  if v_overloads <> 1 then
    raise exception 'registrar_venta: quedaron % versiones', v_overloads;
  end if;
end;
$registrar$;

-- 4. Completar el IMEI de un renglón ya vendido ----------------------------
--
-- SECURITY DEFINER porque ventas_items no tiene policy de UPDATE (nadie edita
-- renglones por PostgREST). Por eso filtra negocio_id a mano en cada consulta
-- y exige permiso + visibilidad de la venta (misma regla que la policy de
-- UPDATE de ventas: propia o ventas.ver_todas).
--
-- Solo renglones de 1 aparato: con cantidad 2 harían falta dos renglones (uno
-- por IMEI) y partir una fila vendida toca devoluciones y totales. Hoy no hay
-- ninguno así sin IMEI.
create or replace function public.completar_imei_venta_item(
  p_item_id uuid,
  p_imei text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_negocio_id uuid := security.current_negocio_id();
  v_imei text := public.normalizar_imei(p_imei);
  v_item record;
  v_existente record;
  v_unidad_id uuid;
  v_filas integer;
begin
  if v_negocio_id is null then
    raise exception 'SIN_NEGOCIO: no hay negocio activo' using errcode = '42501';
  end if;

  if not (select public.tiene_permiso('ventas.cobrar')) then
    raise exception 'SIN_PERMISO: hace falta el permiso ventas.cobrar'
      using errcode = '42501';
  end if;

  if v_imei is null then
    raise exception 'IMEI_VACIO: escribí el IMEI' using errcode = 'P0001';
  end if;

  -- Row lock sobre el renglón: dos llamadas a la vez se serializan acá y la
  -- segunda ve el IMEI ya puesto.
  select vi.id, vi.cantidad, vi.cantidad_devuelta, vi.variante_id,
         vi.unidad_serie_id, vi.presentacion_id, vi.venta_id,
         v.vendedor_id, v.estado_operacion, v.fecha_venta
    into v_item
  from public.ventas_items vi
  join public.ventas v on v.id = vi.venta_id and v.negocio_id = v_negocio_id
  where vi.id = p_item_id
    and vi.negocio_id = v_negocio_id
  for update of vi;

  if not found then
    raise exception 'ITEM_NO_ENCONTRADO: el renglón no existe en este negocio'
      using errcode = 'P0001';
  end if;

  if not (
    v_item.vendedor_id = auth.uid()
    or (select public.tiene_permiso('ventas.ver_todas'))
  ) then
    raise exception 'SIN_PERMISO: la venta es de otro vendedor'
      using errcode = '42501';
  end if;

  -- Ya tiene unidad: si es el mismo número, es un reintento (resultado
  -- normal); si es otro, se frena.
  if v_item.unidad_serie_id is not null then
    select u.id, u.imei into v_existente
    from public.unidades_serie u
    where u.id = v_item.unidad_serie_id
      and u.negocio_id = v_negocio_id;

    if v_existente.imei = v_imei then
      return jsonb_build_object(
        'ya_cargado', true,
        'unidad_id', v_existente.id,
        'imei', v_existente.imei
      );
    end if;

    raise exception 'ITEM_YA_TIENE_IMEI: el renglón ya tiene el IMEI %', v_existente.imei
      using errcode = 'P0001';
  end if;

  if v_item.estado_operacion = 'ANULADA' then
    raise exception 'VENTA_ANULADA: la venta está anulada' using errcode = 'P0001';
  end if;

  if v_item.variante_id is null then
    raise exception 'ITEM_SIN_VARIANTE: el renglón no es un producto del catálogo'
      using errcode = 'P0001';
  end if;

  if v_item.presentacion_id is not null then
    raise exception 'ITEM_CON_PRESENTACION: un renglón por presentación no lleva IMEI'
      using errcode = 'P0001';
  end if;

  if v_item.cantidad <> 1 then
    raise exception 'ITEM_CANTIDAD_NO_UNITARIA: el renglón tiene % unidades; solo se completa el IMEI de un aparato por renglón',
      v_item.cantidad
      using errcode = 'P0001';
  end if;

  if v_item.cantidad_devuelta > 0 then
    raise exception 'ITEM_DEVUELTO: el aparato ya fue devuelto' using errcode = 'P0001';
  end if;

  select u.imei, u.estado into v_existente
  from public.unidades_serie u
  where u.negocio_id = v_negocio_id
    and u.imei = v_imei;

  if found then
    raise exception 'IMEI_YA_CARGADO: el IMEI % ya está cargado (%)', v_imei, v_existente.estado
      using errcode = 'P0001';
  end if;

  -- Nace VENDIDA y atada a la venta: el stock ya se descontó al vender. El
  -- trigger unidades_serie_marca_producto prende productos.lleva_serie.
  insert into public.unidades_serie (
    negocio_id, producto_variante_id, imei, estado, fecha_venta, venta_id
  )
  values (
    v_negocio_id, v_item.variante_id, v_imei, 'vendido',
    coalesce(v_item.fecha_venta, now()), v_item.venta_id
  )
  returning id into v_unidad_id;

  update public.ventas_items
     set unidad_serie_id = v_unidad_id
   where id = p_item_id
     and negocio_id = v_negocio_id
     and unidad_serie_id is null;

  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'ITEM_NO_ACTUALIZADO: se esperaba 1 renglón y se actualizaron %', v_filas;
  end if;

  return jsonb_build_object(
    'ya_cargado', false,
    'unidad_id', v_unidad_id,
    'imei', v_imei
  );
end;
$function$;

revoke all on function public.completar_imei_venta_item(uuid, text) from public, anon, authenticated;
grant execute on function public.completar_imei_venta_item(uuid, text) to authenticated;

-- 5. Varios IMEI por renglón del remito ------------------------------------
--
-- Los IMEI de una línea del payload: el `imei` de siempre (el que vino en el
-- Excel) más los `imeis` completados en la conciliación. Sin DISTINCT a
-- propósito: el mismo número dos veces es un error de tipeo y lo tiene que
-- ver el guard de repetidos, no esconderlo.
create or replace function public.imeis_linea_remito(p_linea jsonb)
returns setof text
language sql
immutable
set search_path to ''
as $function$
  select im.imei
  from (
    select public.normalizar_imei(p_linea->>'imei') as imei
    union all
    select public.normalizar_imei(x)
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_linea->'imeis') = 'array'
           then p_linea->'imeis'
           else '[]'::jsonb
      end
    ) as x
  ) im
  where im.imei is not null;
$function$;

revoke all on function public.imeis_linea_remito(jsonb) from public, anon;
grant execute on function public.imeis_linea_remito(jsonb) to authenticated;

do $migracion$
declare
  v_def text;
  v_nuevo text;
  v_overloads int;

  -- Cada par (viejo, nuevo) tiene que matchear EXACTAMENTE una vez.
  v_viejo_1 text := $v$    select trim(it->>'imei') || ' (dos veces en el remito)' as imei
    from jsonb_array_elements(p_items) as it
    where nullif(it->>'producto_id', '') is not null
      and (it->>'cantidad')::numeric > 0
      and nullif(trim(coalesce(it->>'imei', '')), '') is not null
    group by trim(it->>'imei')$v$;
  v_nuevo_1 text := $v$    select im.imei || ' (dos veces en el remito)' as imei
    from jsonb_array_elements(p_items) as it
    cross join lateral public.imeis_linea_remito(it) as im(imei)
    where nullif(it->>'producto_id', '') is not null
      and (it->>'cantidad')::numeric > 0
    group by im.imei$v$;

  v_viejo_2 text := $v$    from jsonb_array_elements(p_items) as it
    join unidades_serie u
      on u.negocio_id = v_negocio_id
     and u.imei = trim(it->>'imei')$v$;
  v_nuevo_2 text := $v$    from jsonb_array_elements(p_items) as it
    cross join lateral public.imeis_linea_remito(it) as im(imei)
    join unidades_serie u
      on u.negocio_id = v_negocio_id
     and u.imei = im.imei$v$;

  v_viejo_3 text := $v$  for v_item in select * from jsonb_array_elements(p_items)
  loop$v$;
  v_nuevo_3 text := $v$  -- GUARD DE IMEI DE MAS (20261007120000): no puede haber mas aparatos con
  -- numero que unidades recibidas. Solo renglones que entran (cantidad > 0):
  -- uno "no vino" con su IMEI del Excel no crea nada, como siempre.
  select string_agg(
           coalesce(nullif(it->>'raw_nombre', ''), '(sin nombre)')
             || ' (' || c.n || ' IMEI para ' || (it->>'cantidad') || ' unidades)',
           '; '
         )
    into v_colisiones
  from jsonb_array_elements(p_items) as it
  cross join lateral (
    select count(*) as n from public.imeis_linea_remito(it)
  ) c
  where nullif(it->>'producto_id', '') is not null
    and (it->>'cantidad')::numeric > 0
    and c.n > floor((it->>'cantidad')::numeric);

  if v_colisiones is not null then
    raise exception
      'REMITO_IMEIS_DE_MAS: hay renglones con mas IMEI que unidades: %',
      v_colisiones
      using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop$v$;

  v_viejo_4 text := $v$    if v_imei is not null and v_variante_id is not null then
      insert into unidades_serie (negocio_id, producto_variante_id, imei, estado)
      values (
        coalesce(v_negocio_id, security.current_negocio_id()),
        v_variante_id,
        v_imei,
        'disponible'
      );

      if found then
        v_imeis_creados := v_imeis_creados + 1;
      end if;
    end if;$v$;
  v_nuevo_4 text := $v$    -- Una unidad por IMEI de la línea (el del Excel + los completados en la
    -- conciliación). Nacen disponibles: el stock ya lo suma la variante.
    if v_variante_id is not null then
      insert into unidades_serie (negocio_id, producto_variante_id, imei, estado)
      select
        coalesce(v_negocio_id, security.current_negocio_id()),
        v_variante_id,
        im.imei,
        'disponible'
      from public.imeis_linea_remito(v_item) as im(imei);

      get diagnostics v_imeis_linea = row_count;
      v_imeis_creados := v_imeis_creados + v_imeis_linea;
    end if;$v$;

  v_viejo_5 text := $v$  v_imeis_creados integer := 0;
begin$v$;
  v_nuevo_5 text := $v$  v_imeis_creados integer := 0;
  v_imeis_linea integer := 0;
begin$v$;

  v_pares text[][] := array[
    [v_viejo_1, v_nuevo_1],
    [v_viejo_2, v_nuevo_2],
    [v_viejo_3, v_nuevo_3],
    [v_viejo_4, v_nuevo_4],
    [v_viejo_5, v_nuevo_5]
  ];
  i int;
  v_ocurrencias int;
begin
  select count(*) into v_overloads
  from pg_proc where proname = 'aprobar_orden_compra_impl'
    and pronamespace = 'public'::regnamespace;
  if v_overloads <> 1 then
    raise exception 'aprobar_orden_compra_impl: se esperaba 1 version y hay %', v_overloads;
  end if;

  v_def := pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure);
  v_nuevo := v_def;

  for i in 1 .. array_length(v_pares, 1) loop
    v_ocurrencias :=
      (length(v_nuevo) - length(replace(v_nuevo, v_pares[i][1], ''))) / length(v_pares[i][1]);
    if v_ocurrencias <> 1 then
      raise exception 'aprobar_orden_compra_impl: el reemplazo % matchea % veces (se esperaba 1)',
        i, v_ocurrencias;
    end if;
    v_nuevo := replace(v_nuevo, v_pares[i][1], v_pares[i][2]);
  end loop;

  execute v_nuevo;

  -- Lo crítico sigue ahí.
  v_def := pg_get_functiondef('public.aprobar_orden_compra_impl(uuid,text,jsonb)'::regprocedure);
  if position('tiene_permiso(''stock.ingresar_remito'')' in v_def) = 0
     or position('REMITO_LINEAS_SIN_PRODUCTO' in v_def) = 0
     or position('REMITO_IMEI_REPETIDO' in v_def) = 0
     or position('REMITO_IMEIS_DE_MAS' in v_def) = 0
     or position('imeis_linea_remito(v_item)' in v_def) = 0
     or position('and u.imei = trim(it->>''imei'')' in v_def) > 0 then
    raise exception 'aprobar_orden_compra_impl: el cuerpo nuevo no tiene la forma esperada';
  end if;

  select count(*) into v_overloads
  from pg_proc where proname = 'aprobar_orden_compra_impl'
    and pronamespace = 'public'::regnamespace;
  if v_overloads <> 1 then
    raise exception 'aprobar_orden_compra_impl: quedaron % versiones', v_overloads;
  end if;
end;
$migracion$;

-- 6. Datos: ClickTostado ---------------------------------------------------

do $$
declare
  v_marcadas int;
  v_productos int;
begin
  update public.categorias
     set lleva_serie = true
   where negocio_id = '1844badf-1a9a-457c-bfee-4d10122337e8'
     and nombre in ('Celulares', 'Tablets')
     and not lleva_serie;

  get diagnostics v_marcadas = row_count;
  if v_marcadas <> 2 then
    raise exception 'ClickTostado: se esperaban 2 categorias marcadas y fueron %', v_marcadas;
  end if;

  -- Los 17 productos de Celulares + Tablets quedan cubiertos (antes 9).
  select count(*) into v_productos
  from public.productos p
  join public.categorias c on c.id = p.categoria_id
  where p.negocio_id = '1844badf-1a9a-457c-bfee-4d10122337e8'
    and c.lleva_serie;
  if v_productos <> 17 then
    raise exception 'ClickTostado: se esperaban 17 productos cubiertos y son %', v_productos;
  end if;
end $$;

-- Guards finales -----------------------------------------------------------

do $$
begin
  if has_column_privilege('anon', 'public.categorias', 'lleva_serie', 'select') then
    raise exception 'anon no deberia leer categorias.lleva_serie';
  end if;

  if has_function_privilege('anon', 'public.completar_imei_venta_item(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.variantes_llevan_serie(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.productos_llevan_serie(uuid[])', 'execute') then
    raise exception 'anon no deberia ejecutar las funciones de IMEI';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.completar_imei_venta_item(uuid,text)'::regprocedure
      and prosecdef
  ) then
    raise exception 'completar_imei_venta_item tiene que ser SECURITY DEFINER';
  end if;

  if public.normalizar_imei(' 35 539737 742308 3 ') <> '355397377423083'
     or public.normalizar_imei('  ') is not null then
    raise exception 'normalizar_imei no coincide con normalizarImei de TS';
  end if;
end $$;
