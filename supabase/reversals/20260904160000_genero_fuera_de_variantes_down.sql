-- ---------------------------------------------------------------------------
-- Deshace `20260904160000_genero_fuera_de_variantes`.
--
-- Reconstruye desde `respaldos.genero_en_variantes`, que guardó el
-- `nombre_display` y el `atributos` originales de cada variante tocada, el
-- nombre original de cada fila del espejo legacy, y las relaciones
-- normalizadas que se borraron.
--
-- El orden es el inverso del de ida: primero la variante vuelve a su nombre
-- viejo, después el espejo — al revés, el UPDATE del espejo no encontraría
-- contra qué emparejar.
--
-- Solo restaura el ÚLTIMO respaldo (`tomado_en` más reciente): si la
-- migración se corrió más de una vez, cada corrida dejó su propia tanda y
-- mezclarlas escribiría nombres de dos momentos distintos.
--
-- LO QUE NO PUEDE DESHACER: si después de la limpieza alguien vendió, ajustó
-- stock o editó una de estas variantes, esto le devuelve el nombre y los
-- atributos viejos pero no revierte esa venta ni ese ajuste — no los tocó al
-- ir, tampoco al volver.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tanda      timestamptz;
  v_variantes  int;
  v_espejo     int;
  v_relaciones int;
begin
  if to_regclass('respaldos.genero_en_variantes') is null then
    raise notice 'No hay respaldo: nada que restaurar.';
    return;
  end if;

  select max(tomado_en) into v_tanda from respaldos.genero_en_variantes;
  if v_tanda is null then
    raise notice 'El respaldo está vacío: nada que restaurar.';
    return;
  end if;

  -- 1. La variante vuelve a su nombre y sus atributos originales.
  update public.producto_variantes v
     set nombre_display = (r.fila ->> 'nombre_display'),
         atributos      = (r.fila -> 'atributos'),
         updated_at     = now()
    from respaldos.genero_en_variantes r
   where r.tipo = 'variante'
     and r.tomado_en = v_tanda
     and v.id = (r.fila ->> 'id')::uuid;
  get diagnostics v_variantes = row_count;

  -- 2. El espejo legacy, emparejando por el nombre NUEVO (el que quedó tras
  --    la limpieza) para devolverle el viejo.
  update public.productos_stock ps
     set variante = (r.fila ->> 'variante')
    from respaldos.genero_en_variantes r
   where r.tipo = 'espejo_legacy'
     and r.tomado_en = v_tanda
     and ps.id = (r.fila ->> 'id')::uuid;
  get diagnostics v_espejo = row_count;

  -- 3. Las relaciones normalizadas borradas.
  insert into public.producto_variante_valores
  select (jsonb_populate_record(
            null::public.producto_variante_valores, r.fila)).*
    from respaldos.genero_en_variantes r
   where r.tipo = 'relacion'
     and r.tomado_en = v_tanda
  on conflict do nothing;
  get diagnostics v_relaciones = row_count;

  raise notice 'Restaurado: % variantes, % filas del espejo, % relaciones.',
    v_variantes, v_espejo, v_relaciones;

  delete from respaldos.genero_en_variantes where tomado_en = v_tanda;
end $$;
