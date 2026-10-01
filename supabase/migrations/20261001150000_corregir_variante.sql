-- corregir_variante: cambiarle las propiedades a UNA variante conservando su id
-- (y con él sus IMEI, sus ventas y su historia), o fusionarla con otra que ya
-- tiene esas propiedades.
--
-- POR QUÉ. La grilla de edición arma todas las combinaciones de los valores y
-- guardar_variantes_producto reconoce cada variante por sus atributos: cambiar
-- "12/257" por "12/256" se lee como "borrar una y crear otra". Una variante con
-- IMEI no se puede borrar (FK RESTRICT de unidades_serie, que protege la
-- garantía), así que un error de tipeo en un celular no tenía arreglo desde la
-- pantalla. Caso real: Samsung A56 de ClickTostado, 30/9/2026, corregido a mano
-- en 20261001130000. Esta función hace lo mismo para cualquier variante.
--
-- DOS CASOS:
--   - Nadie más tiene esas propiedades → se RENOMBRA en el lugar: mismo id,
--     mismo stock, mismos IMEI. Se reescribe el espejo productos_stock (su
--     texto es el nombre) y las relaciones producto_variante_valores.
--   - Otra variante del producto ya las tiene → es la MISMA mercadería cargada
--     dos veces. Sin p_fusionar devuelve {requiere_fusion} para que la
--     pantalla pregunte. Con p_fusionar: IMEI, ventas, devoluciones,
--     presupuestos y reservas se reapuntan a la que queda (ANTES de borrar:
--     ventas_items no tiene FK y la anulación dependería del nombre; reservas
--     es CASCADE y se borraría), el stock se suma con origen EDICION_VARIANTES
--     y la variante corregida se borra (catalogo_borrados la anota por
--     trigger; los celulares la sacan por delta).
--
-- FRENOS de la fusión: precio o costo propio distinto (no se elige uno en
-- silencio: el usuario los iguala primero) y presentaciones colgadas de la
-- variante corregida (no hay caso real; mejor parar que inventar).
--
-- SEGURIDAD. SECURITY DEFINER porque reapuntar ventas_items, devoluciones_items
-- y presupuestos_items no tiene policy de UPDATE (y no debe tenerla). Por eso:
-- exige stock.editar_producto y filtra negocio_id a mano en CADA consulta.
-- EXECUTE solo para authenticated.

create or replace function public.corregir_variante(
  p_variante_id    uuid,
  p_atributos      jsonb,
  p_nombre_display text,
  p_relaciones     jsonb default '[]'::jsonb,
  p_fusionar       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_neg   uuid := security.current_negocio_id();
  v_user  uuid := auth.uid();
  s       public.producto_variantes%rowtype;
  d       public.producto_variantes%rowtype;
  v_clave text;
  v_filas integer;
  v_stock_destino numeric;
begin
  if v_neg is null then
    raise exception 'SIN_NEGOCIO: no hay un comercio activo' using errcode = 'P0001';
  end if;
  if not public.tiene_permiso('stock.editar_producto') then
    raise exception 'SIN_PERMISO: hace falta el permiso para editar productos' using errcode = '42501';
  end if;

  if p_atributos is null or jsonb_typeof(p_atributos) <> 'object' then
    raise exception 'ATRIBUTOS_VACIOS: la variante tiene que tener propiedades' using errcode = 'P0001';
  end if;
  v_clave := public.atributos_comparables(p_atributos);
  if v_clave = '' or nullif(trim(coalesce(p_nombre_display, '')), '') is null then
    raise exception 'ATRIBUTOS_VACIOS: la variante tiene que tener propiedades' using errcode = 'P0001';
  end if;

  select * into s
    from public.producto_variantes
   where id = p_variante_id and negocio_id = v_neg
   for update;
  if s.id is null then
    raise exception 'VARIANTE_NO_EXISTE: la variante no existe en este comercio' using errcode = 'P0001';
  end if;

  -- La otra variante del mismo producto que ya tiene esas propiedades.
  select * into d
    from public.producto_variantes
   where producto_id = s.producto_id
     and negocio_id = v_neg
     and id <> s.id
     and public.atributos_comparables(atributos) = v_clave
   for update;

  ---------------------------------------------------------------------------
  -- RENOMBRE EN EL LUGAR
  ---------------------------------------------------------------------------
  if d.id is null then
    if v_clave = public.atributos_comparables(s.atributos)
       and p_nombre_display = s.nombre_display then
      return jsonb_build_object('ok', true, 'accion', 'SIN_CAMBIOS');
    end if;

    update public.producto_variantes
       set atributos = p_atributos,
           nombre_display = p_nombre_display,
           updated_at = now()
     where id = s.id and negocio_id = v_neg;

    delete from public.producto_variante_valores
     where variante_id = s.id and negocio_id = v_neg;

    insert into public.producto_variante_valores (negocio_id, variante_id, atributo_id, atributo_valor_id)
    select v_neg, s.id, (r->>'atributo_id')::uuid, (r->>'atributo_valor_id')::uuid
      from jsonb_array_elements(coalesce(p_relaciones, '[]'::jsonb)) as r
     where nullif(r->>'atributo_id', '') is not null
       and nullif(r->>'atributo_valor_id', '') is not null;

    -- El espejo legacy se identifica por el NOMBRE: si no se reescribe, la
    -- venta descuenta de una fila que ya no corresponde a nada.
    update public.productos_stock
       set variante = p_nombre_display
     where producto_id = s.producto_id and negocio_id = v_neg
       and variante = s.nombre_display;

    insert into public.producto_variantes_auditoria (
      negocio_id, producto_id, variante_id_anterior, variante_id_nueva,
      atributos, nombre_display, accion, stock_anterior, stock_nuevo,
      precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, editado_por
    ) values (
      v_neg, s.producto_id, s.id, s.id, p_atributos, p_nombre_display, 'ACTUALIZADA',
      s.stock, s.stock, s.precio, s.precio, s.costo, s.costo, v_user
    );

    return jsonb_build_object('ok', true, 'accion', 'RENOMBRADA');
  end if;

  ---------------------------------------------------------------------------
  -- FUSIÓN
  ---------------------------------------------------------------------------
  if not coalesce(p_fusionar, false) then
    return jsonb_build_object(
      'ok', false,
      'requiere_fusion', true,
      'destino', d.nombre_display,
      'stock_origen', s.stock,
      'stock_destino', d.stock
    );
  end if;

  if s.precio is distinct from d.precio or s.costo is distinct from d.costo then
    raise exception 'FUSION_PRECIOS_DISTINTOS: "%" y "%" tienen precio o costo distinto; igualalos antes de juntarlas',
      s.nombre_display, d.nombre_display
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.producto_presentaciones
     where variante_id = s.id and negocio_id = v_neg
  ) then
    raise exception 'FUSION_CON_PRESENTACIONES: "%" tiene presentaciones propias', s.nombre_display
      using errcode = 'P0001';
  end if;

  -- Todo lo que apunta a la corregida pasa a la que queda, ANTES de borrar.
  update public.unidades_serie set producto_variante_id = d.id
   where producto_variante_id = s.id and negocio_id = v_neg;
  update public.ventas_items set variante_id = d.id
   where variante_id = s.id and negocio_id = v_neg;
  update public.devoluciones_items set variante_id = d.id
   where variante_id = s.id and negocio_id = v_neg;
  update public.presupuestos_items set variante_id = d.id
   where variante_id = s.id and negocio_id = v_neg;
  update public.reservas set variante_id = d.id
   where variante_id = s.id and negocio_id = v_neg;

  -- Stock: el trigger deja las dos patas con este origen.
  perform set_config('comerz.origen_movimiento', 'EDICION_VARIANTES', true);
  perform set_config('comerz.referencia_movimiento', s.producto_id::text, true);

  update public.producto_variantes set stock = 0
   where id = s.id and negocio_id = v_neg;
  update public.producto_variantes set stock = stock + s.stock, updated_at = now()
   where id = d.id and negocio_id = v_neg
  returning stock into v_stock_destino;

  -- El espejo: los DOS lados. Se deja igual al stock real de la que queda.
  delete from public.productos_stock
   where producto_id = s.producto_id and negocio_id = v_neg
     and variante = s.nombre_display;
  update public.productos_stock set cantidad = v_stock_destino
   where producto_id = s.producto_id and negocio_id = v_neg
     and variante = d.nombre_display;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    insert into public.productos_stock (negocio_id, producto_id, variante, cantidad)
    values (v_neg, s.producto_id, d.nombre_display, v_stock_destino);
  end if;

  delete from public.producto_variantes where id = s.id and negocio_id = v_neg;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'FUSION_FALLO: no se pudo borrar "%"', s.nombre_display using errcode = 'P0001';
  end if;

  insert into public.producto_variantes_auditoria (
    negocio_id, producto_id, variante_id_anterior, variante_id_nueva,
    atributos, nombre_display, accion, stock_anterior, stock_nuevo,
    precio_anterior, precio_nuevo, costo_anterior, costo_nuevo, editado_por
  ) values
  (v_neg, s.producto_id, s.id, d.id, s.atributos, s.nombre_display, 'ELIMINADA',
   s.stock, null, s.precio, null, s.costo, null, v_user),
  (v_neg, s.producto_id, d.id, d.id, d.atributos, d.nombre_display, 'ACTUALIZADA',
   d.stock, v_stock_destino, d.precio, d.precio, d.costo, d.costo, v_user);

  return jsonb_build_object('ok', true, 'accion', 'FUSIONADA', 'destino', d.nombre_display);
end;
$function$;

comment on function public.corregir_variante(uuid, jsonb, text, jsonb, boolean) is
  'Cambia las propiedades de una variante conservando su id (IMEI, ventas, historia) o la fusiona con la que ya tiene esas propiedades. SECURITY DEFINER: exige stock.editar_producto y filtra negocio_id a mano. Ver 20261001150000.';

revoke all on function public.corregir_variante(uuid, jsonb, text, jsonb, boolean) from public, anon;
grant execute on function public.corregir_variante(uuid, jsonb, text, jsonb, boolean) to authenticated;

do $$
begin
  if (select count(*) from pg_proc where proname = 'corregir_variante'
        and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'corregir_variante: tiene que haber exactamente una';
  end if;
  if has_function_privilege('anon', 'public.corregir_variante(uuid, jsonb, text, jsonb, boolean)', 'execute') then
    raise exception 'corregir_variante: anon no puede ejecutarla';
  end if;
end $$;
