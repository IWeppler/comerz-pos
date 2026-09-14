-- `ventas.cobrar` se exige SIEMPRE al cobrar (create-sale.ts), no solo con
-- pedidos a caja: si el server lo ignorara según una opción de caja,
-- sacárselo a una vendedora desde la matriz no serviría de nada.
--
-- Consecuencia que hay que cubrir: un negocio NUEVO nace con ENCARGADO y
-- VENDEDOR sin ningún permiso (el dueño los reparte). Hasta hoy eso no
-- impedía vender; desde ahora sí. Dos cosas:
--
--   1. Los roles que hoy están VACÍOS (nunca configurados, sin usuarios)
--      reciben `ventas.cobrar` y `caja.operar`. Los que el dueño ya tocó no
--      se tocan: si a VENDEDOR le sacó cosas a mano, eso es una decisión.
--   2. `crear_negocio_con_owner` los da al crear ENCARGADO y VENDEDOR. Se
--      reescribe desde el cuerpo VIVO por reemplazo de texto (mismo criterio
--      que 20260908160000), anclado en el insert de permisos del ADMIN.

insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select r.id, p.id, r.negocio_id
  from public.roles r
 cross join public.permisos p
 where r.nombre in ('ENCARGADO', 'VENDEDOR')
   and p.clave in ('ventas.cobrar', 'caja.operar')
   and not exists (select 1 from public.rol_permisos rp where rp.rol_id = r.id)
on conflict (rol_id, permiso_id) do nothing;

do $$
declare
  v_def   text;
  v_ancla constant text := E'    INSERT INTO public.rol_permisos (rol_id, permiso_id, negocio_id)\n    SELECT v_rol_admin, p.id, v_negocio FROM public.permisos p;\n';
  v_veces integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'crear_negocio_con_owner'
     and pg_get_function_identity_arguments(p.oid) like 'p_nombre text, p_slug text, p_whatsapp text%';

  if v_def is null then
    raise exception 'No existe crear_negocio_con_owner(p_nombre, p_slug, p_whatsapp, ...)';
  end if;
  if position('ventas.cobrar' in v_def) > 0 then
    raise notice 'crear_negocio_con_owner ya reparte ventas.cobrar: no se toca.';
    return;
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla);
  if v_veces <> 1 then
    raise exception 'El ancla aparece % veces (se esperaba 1): el cuerpo cambio de forma.', v_veces;
  end if;

  execute replace(
    v_def,
    v_ancla,
    v_ancla ||
    E'\n    -- Lo mínimo para que una vendedora recién invitada pueda vender: cobrar\n' ||
    E'    -- y operar su caja. El resto lo reparte el dueño en Empleados y Permisos.\n' ||
    E'    INSERT INTO public.rol_permisos (rol_id, permiso_id, negocio_id)\n' ||
    E'    SELECT r.id, p.id, v_negocio\n' ||
    E'      FROM public.roles r\n' ||
    E'     CROSS JOIN public.permisos p\n' ||
    E'     WHERE r.negocio_id = v_negocio AND r.nombre IN (''ENCARGADO'', ''VENDEDOR'')\n' ||
    E'       AND p.clave IN (''ventas.cobrar'', ''caja.operar'');\n'
  );
end;
$$;

-- GUARD: quedó lo nuevo y no se perdió lo viejo.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crear_negocio_con_owner'
     and pg_get_function_identity_arguments(p.oid) like 'p_nombre text, p_slug text, p_whatsapp text%';
  if position('ventas.cobrar' in v_def) = 0
     or position('metodos_pago' in v_def) = 0
     or position('configuracion_pos' in v_def) = 0
     or position('es_owner' in v_def) = 0 then
    raise exception 'crear_negocio_con_owner quedo incompleta';
  end if;
end;
$$;
