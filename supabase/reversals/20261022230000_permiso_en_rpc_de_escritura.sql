-- Reversión de 20261022230000_permiso_en_rpc_de_escritura.sql: saca el chequeo
-- de permiso insertado al principio de las cuatro RPC (vuelven a depender solo
-- de Node). Reemplazo exacto sobre el cuerpo vivo, una vez por función.

begin;

do $$
declare
  r record;
  d text;
  v_bloque text;
begin
  for r in
    select * from (values
      ('public.anular_venta(uuid, text, uuid, text, text, uuid, boolean)'::regprocedure, 'ventas.anular',           false),
      ('public.registrar_cobro_cc(jsonb, jsonb)'::regprocedure,                         'clientes.cobrar_cc',      true),
      ('public.importar_productos_planilla(uuid, jsonb, text, text, boolean)'::regprocedure, 'stock.importar_planilla', false),
      ('public.fusionar_productos(uuid, uuid)'::regprocedure,                            'stock.eliminar_producto', false)
    ) as t(fn, permiso, permite_servicio)
  loop
    v_bloque := E'\n  -- Permiso en la base (20261022230000): un server action no es control de acceso.\n'
      || case when r.permite_servicio
           then E'  -- service_role pasa: el cobro de Mercado Pago llega sin sesión.\n'
                || format(E'  if coalesce(auth.role(), '''') <> ''service_role''\n     and not public.tiene_permiso(%L) then\n', r.permiso)
           else format(E'  if not public.tiene_permiso(%L) then\n', r.permiso)
         end
      || E'    raise exception ''SIN_PERMISO'' using errcode = ''42501'';\n'
      || E'  end if;\n';
    d := pg_get_functiondef(r.fn);
    if (length(d) - length(replace(d, v_bloque, ''))) / length(v_bloque) <> 1 then
      raise exception '%: el bloque del permiso no aparece una vez', r.fn;
    end if;
    execute replace(d, v_bloque, '');
  end loop;
end $$;

commit;
