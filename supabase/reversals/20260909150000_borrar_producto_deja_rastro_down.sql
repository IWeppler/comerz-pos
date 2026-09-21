-- Vuelve el trigger a la lista blanca sin BAJA_PRODUCTO y saca la función de
-- borrado. Las filas ya escritas con ese origen NO se tocan: movimientos_stock
-- es append-only y un movimiento que pasó no deja de haber pasado porque se
-- revierta la migración.
drop function if exists public.eliminar_productos(uuid[]);

create or replace function public.registrar_movimiento_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'security', 'pg_temp'
as $function$
declare
  v_anterior numeric;
  v_nuevo    numeric;
  v_variante uuid;
  v_producto uuid;
  v_negocio  uuid;
  v_origen   text;
begin
  if coalesce(current_setting('comerz.omitir_movimiento', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_anterior := 0;
    v_nuevo    := coalesce(new.stock, 0);
    v_variante := new.id;
    v_producto := new.producto_id;
    v_negocio  := new.negocio_id;
  elsif tg_op = 'UPDATE' then
    if new.stock is not distinct from old.stock then
      return null;
    end if;
    v_anterior := coalesce(old.stock, 0);
    v_nuevo    := coalesce(new.stock, 0);
    v_variante := new.id;
    v_producto := new.producto_id;
    v_negocio  := new.negocio_id;
  else
    v_anterior := coalesce(old.stock, 0);
    v_nuevo    := 0;
    v_variante := old.id;
    v_producto := old.producto_id;
    v_negocio  := old.negocio_id;
  end if;

  if v_nuevo = v_anterior then
    return null;
  end if;

  v_origen := coalesce(nullif(current_setting('comerz.origen_movimiento', true), ''), 'DESCONOCIDO');
  if v_origen not in (
    'VENTA', 'ANULACION_VENTA', 'REVERSO_VENTA', 'REMITO', 'CARGA_RAPIDA',
    'IMPORTACION', 'EDICION_VARIANTES', 'BAJA', 'DESCONOCIDO'
  ) then
    v_origen := 'DESCONOCIDO';
  end if;

  insert into public.movimientos_stock (
    negocio_id, variante_id, producto_id,
    delta, stock_anterior, stock_nuevo,
    origen, referencia_id, usuario_id
  ) values (
    v_negocio, v_variante, v_producto,
    v_nuevo - v_anterior, v_anterior, v_nuevo,
    v_origen,
    nullif(current_setting('comerz.referencia_movimiento', true), '')::uuid,
    auth.uid()
  );

  return null;
end;
$function$;
