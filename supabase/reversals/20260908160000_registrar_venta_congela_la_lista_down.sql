-- Reversa de 20260908160000_registrar_venta_congela_la_lista.
--
-- Saca las dos columnas del INSERT, con la misma técnica que la ida: se lee el
-- cuerpo VIVO y se le quita el texto, sin retipear nada. Así la reversa no
-- pisa lo que otras migraciones le hayan agregado a `registrar_venta` después.
--
-- Las columnas de `ventas` NO se tocan: las creó 20260908150000 y su propio
-- `_down` es el que las saca. Bajar solo esta migración deja la venta sin
-- registrar con qué lista se cobró, que era el estado anterior.

do $$
declare
  v_def   text;
  v_nuevo text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'registrar_venta';

  if v_def is null or position('lista_precio_id' in v_def) = 0 then
    raise notice 'registrar_venta no congela la lista: nada que revertir.';
    return;
  end if;

  v_nuevo := replace(
    v_def,
    E'desfasaje_precio,\n    lista_precio_id, lista_precio_nombre\n  )\n  values (',
    E'desfasaje_precio\n  )\n  values ('
  );

  v_nuevo := replace(
    v_nuevo,
    E'(p_venta->>''desfasaje_precio'')::numeric,\n    nullif(p_venta->>''lista_precio_id'', '''')::uuid,\n    nullif(p_venta->>''lista_precio_nombre'', '''')',
    '(p_venta->>''desfasaje_precio'')::numeric'
  );

  if position('lista_precio_id' in v_nuevo) > 0 then
    raise exception 'La reversa no pudo sacar las columnas: el cuerpo cambio de forma.';
  end if;

  execute v_nuevo;
end;
$$;
