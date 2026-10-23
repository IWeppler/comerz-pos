-- Permiso en la base para RPC que escriben plata o catálogo y no validaban nada
-- adentro (auditoría de seguridad del 22/10/2026). Desde 20261022220000 la
-- escritura DENTRO de una RPC no pide permiso de tabla: manda la RPC, así que
-- cada una tiene que validar el suyo. Hasta acá lo hacía solo Node, y un server
-- action no es control de acceso: `/rpc/anular_venta` se llama con la anon key y
-- la sesión de cualquier vendedora.
--
-- Mismo permiso que ya exige Node, medido contra el uso real de 90 días:
--  - anular_venta              → ventas.anular          (49 anulaciones, 0 sin permiso)
--  - registrar_cobro_cc        → clientes.cobrar_cc     (0 cobros sin permiso). Pasa
--      service_role: la llama `aplicar_pago_mp_cobro_cc` desde el webhook de MP,
--      sin sesión.
--  - importar_productos_planilla → stock.importar_planilla (0 sin permiso)
--  - fusionar_productos        → stock.eliminar_producto. Node no chequeaba nada;
--      la fusión borra el producto origen y ese DELETE ya lo frenaba la RLS de
--      `productos` a mitad de camino. Ahora corta antes de tocar nada.
--
-- NO entran (decisión pendiente): guardar_variantes_producto y ajustar_stock_*.
-- En Librería Colores las vendedoras editan variantes y cargan stock sin
-- `stock.editar_producto` (y el alta de `productos` está abierta a cualquier
-- rol): cerrarlas les rompe el trabajo diario.
--
-- Reescritura desde el cuerpo VIVO: el chequeo se inserta después del `begin`
-- del bloque principal (columna 0), que tiene que aparecer una sola vez.
-- Reversión: supabase/reversals/20261022230000_permiso_en_rpc_de_escritura.sql

begin;

do $$
declare
  r record;
  d text;
  v_ancla text := E'\nbegin\n';
  v_veces int;
  v_chequeo text;
begin
  for r in
    select * from (values
      ('public.anular_venta(uuid, text, uuid, text, text, uuid, boolean)'::regprocedure, 'ventas.anular',           false),
      ('public.registrar_cobro_cc(jsonb, jsonb)'::regprocedure,                         'clientes.cobrar_cc',      true),
      ('public.importar_productos_planilla(uuid, jsonb, text, text, boolean)'::regprocedure, 'stock.importar_planilla', false),
      ('public.fusionar_productos(uuid, uuid)'::regprocedure,                            'stock.eliminar_producto', false)
    ) as t(fn, permiso, permite_servicio)
  loop
    d := pg_get_functiondef(r.fn);
    v_veces := (length(d) - length(replace(d, v_ancla, ''))) / length(v_ancla);
    if v_veces <> 1 then
      raise exception '%: el begin principal aparece % veces', r.fn, v_veces;
    end if;

    v_chequeo := E'\n  -- Permiso en la base (20261022230000): un server action no es control de acceso.\n'
      || case when r.permite_servicio
           then E'  -- service_role pasa: el cobro de Mercado Pago llega sin sesión.\n'
                || format(E'  if coalesce(auth.role(), '''') <> ''service_role''\n     and not public.tiene_permiso(%L) then\n', r.permiso)
           else format(E'  if not public.tiene_permiso(%L) then\n', r.permiso)
         end
      || E'    raise exception ''SIN_PERMISO'' using errcode = ''42501'';\n'
      || E'  end if;\n';

    execute replace(d, v_ancla, v_ancla || v_chequeo);
  end loop;
end $$;

do $guard$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('anular_venta',                'public.anular_venta(uuid, text, uuid, text, text, uuid, boolean)', 'ventas.anular'),
      ('registrar_cobro_cc',          'public.registrar_cobro_cc(jsonb, jsonb)',                         'clientes.cobrar_cc'),
      ('importar_productos_planilla', 'public.importar_productos_planilla(uuid, jsonb, text, text, boolean)', 'stock.importar_planilla'),
      ('fusionar_productos',          'public.fusionar_productos(uuid, uuid)',                            'stock.eliminar_producto')
    ) as t(nombre, firma, permiso)
  loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = r.nombre) <> 1 then
      raise exception '%: se esperaba una sola versión', r.nombre;
    end if;
    v_def := pg_get_functiondef(r.firma::regprocedure);
    if position(format('tiene_permiso(%L)', r.permiso) in v_def) = 0 then
      raise exception '%: no quedó el permiso %', r.nombre, r.permiso;
    end if;
    -- Siguen INVOKER: la RLS de quien llama sigue aplicando adentro.
    if (select prosecdef from pg_proc where oid = r.firma::regprocedure) then
      raise exception '%: no debía volverse DEFINER', r.nombre;
    end if;
  end loop;
  if position('service_role' in pg_get_functiondef('public.registrar_cobro_cc(jsonb, jsonb)'::regprocedure)) = 0 then
    raise exception 'registrar_cobro_cc: falta el paso de service_role';
  end if;
end $guard$;

commit;
