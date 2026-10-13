-- Pagos en el checkout: el IMEI se carga al entregar.
--
-- Una venta online de un celular sale sin IMEI ("el IMEI se carga al
-- entregar"): la clienta no elige el aparato. Hasta acá nadie lo pedía.
--
--   1. `_registrar_venta_orden_tienda` graba UN RENGLÓN POR APARATO en los
--      productos que llevan IMEI (criterio único: `variantes_llevan_serie`),
--      igual que create-sale con `renglonesPorAparato`. Un renglón de 2
--      aparatos no puede recibir dos IMEI. Precio, descuento y costo ya son por
--      unidad: dos filas de 1 suman lo mismo que una de 2.
--   2. `marcar_orden_entregada` recibe los IMEI (`p_unidades`:
--      [{item_id, imei}]) y, en UNA transacción, ata cada aparato y marca la
--      orden. Si el IMEI ya está en stock (unidad DISPONIBLE de esa variante)
--      la pasa a vendida, como el POS (`vender_unidades_serie`); si no estaba
--      cargado, la crea vendida (como `completar_imei_venta_item`). Nunca
--      mueve stock: se descontó al crear la orden. Falta un IMEI, sobra uno o
--      está vendido / es de otro modelo: frena sin escribir nada.
--      Cambia la firma: DROP explícito de la vieja (create or replace con
--      otra firma crea una sobrecarga) y guard de que queda una.
-- Reversión: supabase/reversals/20261012194147_tienda_imei_al_entregar.sql

-- ─── 1. Un renglón por aparato ───────────────────────────────────────────
do $$
declare
  v_def text;
  v_reemplazos text[][] := array[
    array[
      E'  select p_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id, i.cantidad,\n',
      E'  select p_negocio, v_venta_id, i.producto_id, i.variante, i.variante_id,\n'
      || E'         -- Un renglón por aparato en lo que lleva IMEI (20261012220000).\n'
      || E'         case when s.variante_id is not null and i.cantidad = trunc(i.cantidad) then 1 else i.cantidad end,\n'
    ],
    array[
      E'         case when coalesce(p.lleva_serie, false)\n'
      || E'              then ''Venta online: el IMEI se carga al entregar'' end\n'
      || E'    from public.ordenes_tienda_items i\n',
      E'         case when s.variante_id is not null or coalesce(p.lleva_serie, false)\n'
      || E'              then ''Venta online: el IMEI se carga al entregar'' end\n'
      || E'    from public.ordenes_tienda_items i\n'
      || E'    left join public.variantes_llevan_serie(array(\n'
      || E'      select x.variante_id from public.ordenes_tienda_items x\n'
      || E'       where x.negocio_id = p_negocio and x.orden_id = p_orden and x.variante_id is not null)) s\n'
      || E'      on s.variante_id = i.variante_id\n'
      || E'    cross join lateral generate_series(1,\n'
      || E'      case when s.variante_id is not null and i.cantidad = trunc(i.cantidad) then i.cantidad::int else 1 end) as aparato(n)\n'
    ]
  ];
  v_veces int;
  i int;
begin
  v_def := pg_get_functiondef('public._registrar_venta_orden_tienda(uuid,uuid,text,uuid,jsonb)'::regprocedure);
  for i in 1 .. array_length(v_reemplazos, 1) loop
    v_veces := (length(v_def) - length(replace(v_def, v_reemplazos[i][1], ''))) / length(v_reemplazos[i][1]);
    if v_veces <> 1 then
      raise exception 'REGISTRAR_ANCLA %: matchea % veces', i, v_veces;
    end if;
    v_def := replace(v_def, v_reemplazos[i][1], v_reemplazos[i][2]);
  end loop;
  execute v_def;

  v_def := pg_get_functiondef('public._registrar_venta_orden_tienda(uuid,uuid,text,uuid,jsonb)'::regprocedure);
  if position('generate_series' in v_def) = 0
    or position('SECURITY DEFINER' in v_def) = 0
    or position('for update' in v_def) = 0
    or has_function_privilege('anon', 'public._registrar_venta_orden_tienda(uuid,uuid,text,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public._registrar_venta_orden_tienda(uuid,uuid,text,uuid,jsonb)', 'EXECUTE') then
    raise exception 'REGISTRAR_GUARD';
  end if;
end $$;

-- ─── 2. Entregar con IMEI ────────────────────────────────────────────────
drop function if exists public.marcar_orden_entregada(uuid, boolean);

create function public.marcar_orden_entregada(
  p_orden uuid,
  p_entregada boolean default true,
  p_unidades jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_orden record;
  v_item record;
  v_unidad record;
  v_imei text;
  v_unidad_id uuid;
  v_filas integer;
  v_pendientes integer := 0;
  v_recibidos integer;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not coalesce(public.tiene_permiso('ventas.cobrar'), false) then raise exception 'SIN_PERMISO'; end if;

  if not p_entregada then
    update public.ordenes_tienda
       set estado = 'PAGADA', entregada_en = null, entregada_por = null, actualizado_en = now()
     where id = p_orden and negocio_id = v_negocio and estado = 'ENTREGADA'
    returning id into v_unidad_id;
    return v_unidad_id is not null;
  end if;

  select o.id, o.venta_id into v_orden
    from public.ordenes_tienda o
   where o.id = p_orden and o.negocio_id = v_negocio and o.estado = 'PAGADA'
   for update;
  if v_orden.id is null then return false; end if;

  if jsonb_typeof(coalesce(p_unidades, '[]'::jsonb)) <> 'array' then raise exception 'UNIDADES_INVALIDAS'; end if;
  v_recibidos := jsonb_array_length(coalesce(p_unidades, '[]'::jsonb));
  if (select count(distinct public.normalizar_imei(e->>'imei')) from jsonb_array_elements(p_unidades) e) <> v_recibidos
     or (select count(distinct e->>'item_id') from jsonb_array_elements(p_unidades) e) <> v_recibidos then
    raise exception 'IMEI_REPETIDO';
  end if;

  -- Los aparatos de la venta que todavía no tienen IMEI.
  for v_item in
    select vi.id, vi.variante_id
      from public.ventas_items vi
      join public.variantes_llevan_serie(array(
             select x.variante_id from public.ventas_items x
              where x.negocio_id = v_negocio and x.venta_id = v_orden.venta_id and x.variante_id is not null)) s
        on s.variante_id = vi.variante_id
     where vi.negocio_id = v_negocio and vi.venta_id = v_orden.venta_id
       and vi.unidad_serie_id is null and vi.cantidad = 1 and vi.cantidad_devuelta = 0
     order by vi.id
     for update of vi
  loop
    v_pendientes := v_pendientes + 1;
    v_imei := public.normalizar_imei(
      (select e->>'imei' from jsonb_array_elements(p_unidades) e where e->>'item_id' = v_item.id::text limit 1));
    if v_imei is null then raise exception 'IMEI_FALTANTES'; end if;

    select u.id, u.estado, u.producto_variante_id into v_unidad
      from public.unidades_serie u
     where u.negocio_id = v_negocio and u.imei = v_imei
     for update;

    if v_unidad.id is not null then
      if v_unidad.estado <> 'disponible' or v_unidad.producto_variante_id <> v_item.variante_id then
        raise exception 'IMEI_NO_DISPONIBLE' using detail = v_imei;
      end if;
      update public.unidades_serie
         set estado = 'vendido', fecha_venta = now(), venta_id = v_orden.venta_id
       where id = v_unidad.id and negocio_id = v_negocio and estado = 'disponible';
      v_unidad_id := v_unidad.id;
    else
      -- No estaba cargado: nace vendido, sin mover stock.
      insert into public.unidades_serie (negocio_id, producto_variante_id, imei, estado, fecha_venta, venta_id)
      values (v_negocio, v_item.variante_id, v_imei, 'vendido', now(), v_orden.venta_id)
      returning id into v_unidad_id;
    end if;

    update public.ventas_items
       set unidad_serie_id = v_unidad_id
     where id = v_item.id and negocio_id = v_negocio and unidad_serie_id is null;
    get diagnostics v_filas = row_count;
    if v_filas <> 1 then raise exception 'ITEM_NO_ACTUALIZADO'; end if;
  end loop;

  if v_recibidos > v_pendientes then raise exception 'IMEI_DE_MAS'; end if;

  update public.ordenes_tienda
     set estado = 'ENTREGADA', entregada_en = now(), entregada_por = auth.uid(), actualizado_en = now()
   where id = v_orden.id and negocio_id = v_negocio;
  return true;
end $$;

comment on function public.marcar_orden_entregada(uuid, boolean, jsonb) is
  'PAGADA ↔ ENTREGADA. Al entregar ata el IMEI de cada aparato de la venta (unidad disponible → vendida, o la crea vendida). No toca plata ni stock. Sesión + ventas.cobrar.';

revoke all on function public.marcar_orden_entregada(uuid, boolean, jsonb) from public, anon;
grant execute on function public.marcar_orden_entregada(uuid, boolean, jsonb) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname = 'marcar_orden_entregada') <> 1
    or has_function_privilege('anon', 'public.marcar_orden_entregada(uuid,boolean,jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.marcar_orden_entregada(uuid,boolean,jsonb)', 'EXECUTE') then
    raise exception 'ENTREGADA_IMEI_GUARD';
  end if;
end $$;
