-- Permiso `caja.operar`: abrir y cerrar turno, registrar egresos.
--
-- Hasta acá cualquiera del negocio podía abrir una caja y cerrar la que
-- abrió; el único permiso de caja era `caja.cerrar_ajena` (cerrar la de
-- OTRO). Con "varios puestos, una caja" apareció el caso de una vendedora
-- que no toca la caja jamás — y seguía viendo el botón "Caja cerrada" en la
-- barra, con el modal de abrir turno adentro.
--
-- Se otorga a los roles que hoy tienen `ventas.cobrar`, o sea a todos los
-- que venden: nadie pierde nada. Y `configurar_pedidos_a_caja` se lo saca
-- al rol VENDEDOR junto con `ventas.cobrar` al prender la opción (y se lo
-- devuelve al apagarla): quien no cobra tampoco opera caja.
--
-- Lo que NO cambia: `caja.cerrar_ajena` sigue mandando sobre la caja de
-- otro, y en modo UNICA la de otro solo la cierra un admin.

insert into public.permisos (clave, modulo, descripcion)
values ('caja.operar', 'caja', 'Operar la caja: abrir y cerrar el turno propio, registrar gastos')
on conflict (clave) do nothing;

insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select rp.rol_id, nuevo.id, rp.negocio_id
  from public.rol_permisos rp
  join public.permisos actual
    on actual.id = rp.permiso_id
   and actual.clave = 'ventas.cobrar'
 cross join (select id from public.permisos where clave = 'caja.operar') as nuevo
on conflict (rol_id, permiso_id) do nothing;

create or replace function public.configurar_pedidos_a_caja(p_activo boolean)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_rol     uuid;
  v_permiso uuid;
  v_clave   text;
  v_filas   integer;
begin
  if v_negocio is null then
    raise exception 'SIN_NEGOCIO_ACTIVO';
  end if;
  if not public.tiene_permiso('configuracion.empleados_y_permisos') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_activo and not public.tiene_feature('pedidos_a_caja') then
    raise exception 'FEATURE_NO_INCLUIDA';
  end if;

  update public.configuracion_pos
     set pedidos_a_caja = p_activo
   where negocio_id = v_negocio;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'CONFIGURACION_NO_ENCONTRADA';
  end if;

  select id into v_rol
    from public.roles
   where negocio_id = v_negocio and nombre = 'VENDEDOR';

  if v_rol is not null then
    -- Cobrar y operar caja van juntos: quien manda pedidos no hace ninguna
    -- de las dos.
    foreach v_clave in array array['ventas.cobrar', 'caja.operar'] loop
      select id into v_permiso from public.permisos where clave = v_clave;
      if v_permiso is null then continue; end if;
      if p_activo then
        delete from public.rol_permisos
         where rol_id = v_rol and permiso_id = v_permiso;
      else
        insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
        values (v_rol, v_permiso, v_negocio)
        on conflict (rol_id, permiso_id) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object('pedidos_a_caja', p_activo, 'rol_vendedor', v_rol is not null);
end;
$function$;
