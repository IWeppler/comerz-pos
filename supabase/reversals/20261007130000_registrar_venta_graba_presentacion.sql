-- Reversión de 20261007130000_registrar_venta_graba_presentacion.sql. A MANO.
-- Los renglones ya grabados con presentación quedan como están.

do $registrar$
declare
  v_firma constant text := 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])';
  v_nuevo text;
  v_pares text[][] := array[
    [$v$    promocion_id, promocion_nombre, es_venta_libre, motivo_sin_imei,
    presentacion_id, presentacion_nombre, factor, cantidad_presentacion, precio_presentacion
  )$v$,
     $v$    promocion_id, promocion_nombre, es_venta_libre, motivo_sin_imei
  )$v$],
    [$v$    nullif(trim(i.motivo_sin_imei), ''),
    i.presentacion_id, i.presentacion_nombre, coalesce(i.factor, 1),
    i.cantidad_presentacion, i.precio_presentacion
  from jsonb_to_recordset(p_items) as i($v$,
     $v$    nullif(trim(i.motivo_sin_imei), '')
  from jsonb_to_recordset(p_items) as i($v$],
    [$v$    es_venta_libre boolean, motivo_sin_imei text,
    presentacion_id uuid, presentacion_nombre text, factor numeric,
    cantidad_presentacion numeric, precio_presentacion numeric
  );$v$,
     $v$    es_venta_libre boolean, motivo_sin_imei text
  );$v$]
  ];
  i int;
  v_ocurrencias int;
begin
  v_nuevo := pg_get_functiondef(v_firma::regprocedure);
  for i in 1 .. array_length(v_pares, 1) loop
    v_ocurrencias :=
      (length(v_nuevo) - length(replace(v_nuevo, v_pares[i][1], ''))) / length(v_pares[i][1]);
    if v_ocurrencias <> 1 then
      raise exception 'reversion: el reemplazo % matchea % veces', i, v_ocurrencias;
    end if;
    v_nuevo := replace(v_nuevo, v_pares[i][1], v_pares[i][2]);
  end loop;
  execute v_nuevo;
  if position('i.presentacion_id' in pg_get_functiondef(v_firma::regprocedure)) > 0 then
    raise exception 'reversion: registrar_venta sigue grabando la presentacion';
  end if;
end;
$registrar$;
