-- Pedidos a caja: feature de plan y prendido/apagado con el rol VENDEDOR.
--
-- Dos ajustes sobre 20260915120000:
--
-- 1. Es una feature de PLAN: Gestión, Empresa y Prueba. Emprendedor es un
--    plan de UN usuario, y "varios puestos, una caja" no tiene sentido con
--    una sola persona. Se agrega a `planes.reglas.features`, que es lo que
--    lee `tiene_feature()`.
--
-- 2. Prender la opción REPARTE los roles solo: VENDEDOR deja de poder cobrar
--    (pierde `ventas.cobrar`) y ENCARGADO/ADMIN siguen cobrando. Apagarla se
--    lo devuelve. Antes eran dos pasos en dos pantallas distintas —el toggle
--    en Caja y el permiso en Empleados—, y con uno solo hecho el sistema
--    quedaba a medias: prendido pero con las vendedoras cobrando igual. Por
--    eso va en UNA función, transaccional, y el toggle vive en Empleados y
--    Permisos, que es donde se decide quién hace qué.
--
--    SECURITY INVOKER: quien llama tiene que poder escribir `configuracion_pos`
--    y `rol_permisos` (ADMIN, por RLS). La función solo agrupa.

update public.planes
   set reglas = jsonb_set(
     reglas,
     '{features}',
     (reglas -> 'features') || '["pedidos_a_caja"]'::jsonb
   )
 where nombre in ('Gestión', 'Empresa', 'Prueba')
   and not (reglas -> 'features' ? 'pedidos_a_caja');

create or replace function public.configurar_pedidos_a_caja(p_activo boolean)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_negocio uuid := security.current_negocio_id();
  v_permiso uuid;
  v_rol     uuid;
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

  select id into v_permiso from public.permisos where clave = 'ventas.cobrar';
  select id into v_rol
    from public.roles
   where negocio_id = v_negocio and nombre = 'VENDEDOR';

  if v_rol is not null and v_permiso is not null then
    if p_activo then
      delete from public.rol_permisos
       where rol_id = v_rol and permiso_id = v_permiso;
    else
      insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
      values (v_rol, v_permiso, v_negocio)
      on conflict (rol_id, permiso_id) do nothing;
    end if;
  end if;

  return jsonb_build_object('pedidos_a_caja', p_activo, 'rol_vendedor', v_rol is not null);
end;
$function$;

comment on function public.configurar_pedidos_a_caja(boolean) is
  'Prende/apaga pedidos a caja y, en la misma transaccion, le saca (o devuelve) ventas.cobrar al rol VENDEDOR del negocio. Exige configuracion.empleados_y_permisos y la feature pedidos_a_caja.';

grant execute on function public.configurar_pedidos_a_caja(boolean) to authenticated;
