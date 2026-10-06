-- Revierte 20261006170000_clientes_crear_por_permiso.sql: cualquiera vuelve a
-- poder crear clientes.

drop policy if exists clientes_crear_con_permiso on public.clientes;

do $rev$
declare
  v_def text;
  v_viejo constant text := 'AND p.clave IN (''ventas.cobrar'', ''caja.operar'', ''clientes.crear'');';
  v_nuevo constant text := 'AND p.clave IN (''ventas.cobrar'', ''caja.operar'');';
begin
  select pg_get_functiondef('public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure)
    into v_def;
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'crear_negocio_con_owner: el ancla no matchea exactamente una vez';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);

  delete from rol_permisos
   where permiso_id = (select id from permisos where clave = 'clientes.crear');
  delete from permisos where clave = 'clientes.crear';
end
$rev$;
