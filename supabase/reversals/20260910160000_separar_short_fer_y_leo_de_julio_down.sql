-- Revierte 20260910160000: devuelve las 4 variantes a SHORT JULIO DEPORTIVO
-- y borra los dos productos creados.
--
-- Ojo: NO restaura el precio propio de $12.000 / $6.000 que tenían las dos
-- variantes de LEO. Eso es a propósito — volver a escribirles el número sería
-- volver a fabricar la copia que se desincroniza. Si se revierte esto, las de
-- LEO pasan a valer los $9.000 de la cabecera de JULIO, que es lo que hay que
-- mirar antes de correrlo.
do $$
declare
  v_julio uuid := 'fb64931d-db1b-469e-96d7-39a46c78ca24';
  v_fer   uuid;
  v_leo   uuid;
begin
  select id into v_fer from public.productos where slug = 'short-fer-deportivo-fb64';
  select id into v_leo from public.productos where slug = 'short-leo-deportivo-fb64';

  if v_fer is null and v_leo is null then
    raise notice 'No están los productos separados: nada que revertir.';
    return;
  end if;

  perform set_config('comerz.origen_movimiento', 'EDICION_VARIANTES', true);

  update public.ordenes_items set producto_id = v_julio
   where producto_id in (v_fer, v_leo);

  update public.productos_stock set producto_id = v_julio
   where producto_id in (v_fer, v_leo);

  update public.producto_variantes set producto_id = v_julio
   where producto_id in (v_fer, v_leo);

  delete from public.productos where id in (v_fer, v_leo);
end $$;
