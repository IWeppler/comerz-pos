-- Reversión de 20261007230000_permisos_recargos_cc_admin.sql. A mano, nunca
-- desde migrations/.
--
-- Revertir el CÓDIGO primero o junto: sin los permisos, `tienePermiso` da
-- false y el POS esconde "Anular" y la ficha "Cargar saldo" a todos menos
-- ADMIN (fail-closed; ADMIN sigue pudiendo porque `tiene_permiso` le da true).

drop policy if exists cc_debito_manual_requiere_permiso
  on public.cuenta_corriente_movimientos;

do $$
declare
  v_def text;
  v_guard constant text := E'      -- Fiar sin el recargo de CC del comercio pide permiso (20261007230000).\n'
    || E'      -- Con recargo 0 en la configuración no hay nada que anular.\n'
    || E'      if coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                    where c.negocio_id = v_negocio), 0) > 0\n'
    || E'         and (coalesce((p_venta->>''recargo_cc_porcentaje'')::numeric, 0) <= 0\n'
    || E'              or coalesce((p_venta->>''recargo_cc_monto'')::numeric, 0) <= 0)\n'
    || E'         and not coalesce(public.tiene_permiso(''ventas.fiar_sin_recargo''), false) then\n'
    || E'        raise exception ''SIN_PERMISO_FIAR_SIN_RECARGO'';\n'
    || E'      end if;\n\n';
begin
  v_def := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_guard, ''))) / length(v_guard) <> 1 then
    raise exception 'El guard de registrar_venta no está exactamente una vez';
  end if;
  execute replace(v_def, v_guard, '');
end $$;

-- Devuelve corregir_cobro_cc a ENCARGADO y VENDEDOR de todos los negocios
-- (la asignación previa no se guardó fila por fila: 15 filas el 7/10/2026,
-- todas de roles ENCARGADO/VENDEDOR).
insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select r.id, p.id, r.negocio_id
  from public.roles r
  cross join public.permisos p
 where r.nombre in ('ENCARGADO', 'VENDEDOR')
   and p.clave = 'clientes.corregir_cobro_cc'
on conflict do nothing;

delete from public.rol_permisos rp
 using public.permisos p
 where p.id = rp.permiso_id
   and p.clave in ('ventas.fiar_sin_recargo', 'clientes.cargar_saldo');
delete from public.permisos
 where clave in ('ventas.fiar_sin_recargo', 'clientes.cargar_saldo');
