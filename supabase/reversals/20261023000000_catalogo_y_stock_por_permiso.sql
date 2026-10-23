-- Reversión de 20261023000000_catalogo_y_stock_por_permiso.sql.
-- Vuelve a dejar el catálogo y el stock abiertos a cualquier rol. El permiso
-- que se le dio a VENDEDOR de Librería Colores NO se saca (es lo que hacían
-- antes; sacarlo es una decisión del comercio, desde Empleados y permisos).

begin;

-- Chequeos insertados al principio de las RPC: reemplazo exacto sobre el vivo.
do $$
declare
  r record;
  d text;
  v_bloque text;
begin
  for r in
    select * from (values
      ('public.guardar_variantes_producto(uuid, uuid, jsonb, uuid, jsonb)'::regprocedure,
       E'  if coalesce(auth.role(), '''') <> ''service_role''\n     and not public.tiene_permiso(''stock.editar_producto'') then\n    raise exception ''SIN_PERMISO_EDITAR_PRODUCTO'' using errcode = ''42501'';\n  end if;\n'),
      ('public.guardar_variantes_producto_impl(uuid, uuid, jsonb, uuid, jsonb)'::regprocedure,
       E'  if coalesce(auth.role(), '''') <> ''service_role''\n     and not public.tiene_permiso(''stock.editar_producto'') then\n    raise exception ''SIN_PERMISO_EDITAR_PRODUCTO'' using errcode = ''42501'';\n  end if;\n'),
      ('public.ajustar_stock_variante(uuid, numeric, boolean, text, uuid)'::regprocedure,
       E'  if not security.puede_ajustar_stock(\n       jsonb_build_array(jsonb_build_object(''variante_id'', p_variante_id, ''delta'', p_delta)),\n       p_origen, p_referencia_id) then\n    raise exception ''SIN_PERMISO_STOCK'' using errcode = ''42501'';\n  end if;\n'),
      ('public.ajustar_stock_variantes(jsonb, boolean, text, uuid)'::regprocedure,
       E'  if not security.puede_ajustar_stock(p_movimientos, p_origen, p_referencia_id) then\n    raise exception ''SIN_PERMISO_STOCK'' using errcode = ''42501'';\n  end if;\n'),
      ('public.ajustar_stock_legacy(uuid, text, numeric)'::regprocedure,
       E'  if not security.puede_ajustar_stock(\n       jsonb_build_array(jsonb_build_object(''variante_id'', null, ''delta'', p_delta)),\n       null, null) then\n    raise exception ''SIN_PERMISO_STOCK'' using errcode = ''42501'';\n  end if;\n')
    ) as t(fn, chequeo)
  loop
    v_bloque := E'  -- Permiso en la base (20261023000000).\n' || r.chequeo;
    d := pg_get_functiondef(r.fn);
    if (length(d) - length(replace(d, v_bloque, ''))) / length(v_bloque) <> 1 then
      raise exception '%: el chequeo no aparece una vez', r.fn;
    end if;
    execute replace(d, v_bloque, '');
  end loop;
end $$;

drop function if exists security.puede_ajustar_stock(jsonb, text, uuid);

drop trigger if exists trg_proteger_campos_producto on public.productos;
drop function if exists security.proteger_campos_producto();

drop policy if exists producto_variantes_alta_directa_permiso on public.producto_variantes;
drop policy if exists producto_variante_valores_alta_directa_permiso on public.producto_variante_valores;
drop policy if exists productos_stock_alta_directa_permiso on public.productos_stock;
drop policy if exists productos_stock_edicion_directa_permiso on public.productos_stock;
drop policy if exists productos_stock_baja_directa_permiso on public.productos_stock;

commit;
