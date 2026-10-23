-- Reversión de 20261022220000_rls_escritura_directa_por_rol.sql.
-- OJO: vuelve a dejar que cualquier rol del negocio cambie saldos de clientes,
-- movimientos de CC, promociones y stock desde la consola del navegador.

begin;

drop policy if exists clientes_borrar_directo_admin on public.clientes;
drop trigger if exists trg_proteger_campos_cliente on public.clientes;
drop function if exists security.proteger_campos_cliente();

drop policy if exists cc_credito_manual_directo_requiere_permiso on public.cuenta_corriente_movimientos;
drop policy if exists cc_editar_directo_admin on public.cuenta_corriente_movimientos;
drop policy if exists cc_borrar_directo_admin on public.cuenta_corriente_movimientos;
drop policy if exists promociones_editar_directo_admin on public.promociones;

do $$
declare t text;
begin
  foreach t in array array['producto_variantes', 'producto_variante_valores', 'productos_stock'] loop
    execute format('drop policy if exists %I on public.%I', t || '_alta_directa_permiso', t);
    execute format('drop policy if exists %I on public.%I', t || '_edicion_directa_permiso', t);
    execute format('drop policy if exists %I on public.%I', t || '_baja_directa_permiso', t);
  end loop;
end $$;

-- ajustar_saldo_cliente vuelve a no pedir permiso.
do $$
declare
  d text := pg_get_functiondef('public.ajustar_saldo_cliente(uuid, numeric)'::regprocedure);
  v_bloque text := E'\n'
    || E'  -- Mueve plata que no entró: cargar saldo, perdonar, corregir un manual.\n'
    || E'  -- Lo llaman acciones que ya piden este permiso (o admin, que lo tiene).\n'
    || E'  if not public.tiene_permiso(''clientes.cargar_saldo'') then\n'
    || E'    raise exception ''SIN_PERMISO'' using errcode = ''42501'';\n'
    || E'  end if;\n';
begin
  if (length(d) - length(replace(d, v_bloque, ''))) / length(v_bloque) <> 1 then
    raise exception 'ajustar_saldo_cliente: el bloque del permiso no aparece una vez';
  end if;
  execute replace(d, v_bloque, '');
end $$;

drop function if exists security.es_escritura_directa();

commit;
