-- registrar_venta graba la PRESENTACIÓN de cada renglón (7/10/2026).
--
-- `20260918150000_registrar_venta_presentaciones.sql` hacía exactamente esto
-- pero NUNCA se aplicó en producción: no está en schema_migrations y el
-- baseline (dump del 29/9) tiene el INSERT sin estas columnas. create-sale
-- manda presentacion_id / presentacion_nombre / factor / cantidad_presentacion
-- / precio_presentacion desde el 18/9 y la RPC los descartaba en silencio: un
-- balde vendido quedaba como "4,7 kg a $9.574,47" y el ticket no podía decir
-- "1 Balde". Ningún renglón vendido tiene presentación (había 2 definidas).
--
-- `cantidad` sigue en UNIDAD BASE. El CHECK `ventas_items_presentacion_coherente`
-- exige cantidad = cantidad_base(cantidad_presentacion, factor); create-sale
-- calcula con `cantidadBase` (shared/lib/presentaciones.ts), el mismo redondeo
-- a 3 decimales. Ausentes (renglón sin presentación, venta offline encolada
-- antes): factor 1 y nulls, como siempre.
--
-- Reemplazos sobre el cuerpo VIVO (que ya tiene motivo_sin_imei de
-- 20261007120000), con guard de que cada uno matchea una sola vez.
-- Reversión: supabase/reversals/20261007130000_registrar_venta_graba_presentacion.sql

do $registrar$
declare
  v_firma constant text := 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])';
  v_def text;
  v_nuevo text;
  v_overloads int;
  v_pares text[][] := array[
    [$v$    promocion_id, promocion_nombre, es_venta_libre, motivo_sin_imei
  )$v$,
     $v$    promocion_id, promocion_nombre, es_venta_libre, motivo_sin_imei,
    presentacion_id, presentacion_nombre, factor, cantidad_presentacion, precio_presentacion
  )$v$],
    [$v$    nullif(trim(i.motivo_sin_imei), '')
  from jsonb_to_recordset(p_items) as i($v$,
     $v$    nullif(trim(i.motivo_sin_imei), ''),
    i.presentacion_id, i.presentacion_nombre, coalesce(i.factor, 1),
    i.cantidad_presentacion, i.precio_presentacion
  from jsonb_to_recordset(p_items) as i($v$],
    [$v$    es_venta_libre boolean, motivo_sin_imei text
  );$v$,
     $v$    es_venta_libre boolean, motivo_sin_imei text,
    presentacion_id uuid, presentacion_nombre text, factor numeric,
    cantidad_presentacion numeric, precio_presentacion numeric
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
     or position('SALDO_A_FAVOR_INSUFICIENTE' in v_def) = 0
     or position('security.current_negocio_id()' in v_def) = 0
     or position('motivo_sin_imei' in v_def) = 0
     or position('i.cantidad_presentacion, i.precio_presentacion' in v_def) = 0
     or v_def <> v_nuevo then
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
