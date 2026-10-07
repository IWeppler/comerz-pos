-- Recargos de cuenta corriente: anularlos, corregirlos o cargar deuda a mano
-- queda para ADMIN por default, como permisos granulares que cada comercio
-- puede dar a otros roles desde Empleados y permisos.
--
-- 1. `ventas.fiar_sin_recargo` (nuevo): el "Anular" de la línea RECARGO CC del
--    POS. Lo exige `registrar_venta` (guard abajo) y `create-sale.ts`.
--    Medido el 7/10/2026: en Evens las vendedoras fiaron 10 veces sin recargo
--    ($316.700) con el recargo del comercio en 15 %.
-- 2. `clientes.cargar_saldo` (nuevo): "Cargar saldo" de la ficha y la deuda
--    inicial de la importación CSV. Lo exige una RESTRICTIVE de INSERT sobre
--    `cuenta_corriente_movimientos` para el DÉBITO manual (sin venta ni pago).
--    Los débitos de las RPC llevan venta_id (venta) o pago_id (mora al cobrar).
-- 3. `clientes.corregir_cobro_cc` (existente): sale de ENCARGADO y VENDEDOR.
--    Cambiar el medio de un cobro cambia su recargo por método.
--
-- `tiene_permiso` ya da true a cualquier ADMIN; la fila en `rol_permisos` del
-- ADMIN es para que la pantalla de roles lo muestre tildado.
-- Reversión: supabase/reversals/20261007230000_permisos_recargos_cc_admin.sql

do $$
declare
  v_def text;
  v_nuevo text;
  v_buscar constant text := E'    if v_cliente is not null and v_pendiente > 0.05 then\n      v_vencimiento := public.cc_vence_el_negocio(';
  v_guard constant text := E'    if v_cliente is not null and v_pendiente > 0.05 then\n'
    || E'      -- Fiar sin el recargo de CC del comercio pide permiso (20261007230000).\n'
    || E'      -- Con recargo 0 en la configuración no hay nada que anular.\n'
    || E'      if coalesce((select c.cc_recargo_default from public.configuracion_pos c\n'
    || E'                    where c.negocio_id = v_negocio), 0) > 0\n'
    || E'         and (coalesce((p_venta->>''recargo_cc_porcentaje'')::numeric, 0) <= 0\n'
    || E'              or coalesce((p_venta->>''recargo_cc_monto'')::numeric, 0) <= 0)\n'
    || E'         and not coalesce(public.tiene_permiso(''ventas.fiar_sin_recargo''), false) then\n'
    || E'        raise exception ''SIN_PERMISO_FIAR_SIN_RECARGO'';\n'
    || E'      end if;\n\n'
    || E'      v_vencimiento := public.cc_vence_el_negocio(';
  v_antes_admin int;
  v_antes_corregir_no_admin int;
  v_despues int;
  v_overloads int;
begin
  -- Permisos nuevos
  insert into public.permisos (clave, modulo, descripcion) values
    ('ventas.fiar_sin_recargo', 'ventas',
     'Fiar sin el recargo de cuenta corriente (anular el recargo al vender)'),
    ('clientes.cargar_saldo', 'clientes',
     'Cargar deuda a mano a un cliente (saldo inicial, también al importar CSV)')
  on conflict (clave) do nothing;

  select count(*) into v_antes_admin
    from public.roles where nombre = 'ADMIN';

  -- Al ADMIN de cada negocio
  insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
  select r.id, p.id, r.negocio_id
    from public.roles r
    cross join public.permisos p
   where r.nombre = 'ADMIN'
     and p.clave in ('ventas.fiar_sin_recargo', 'clientes.cargar_saldo')
  on conflict do nothing;

  select count(*) into v_despues
    from public.rol_permisos rp
    join public.permisos p on p.id = rp.permiso_id
    join public.roles r on r.id = rp.rol_id
   where p.clave in ('ventas.fiar_sin_recargo', 'clientes.cargar_saldo')
     and r.nombre = 'ADMIN';
  if v_despues <> v_antes_admin * 2 then
    raise exception 'Guard: % filas ADMIN para los permisos nuevos, esperaba %',
      v_despues, v_antes_admin * 2;
  end if;

  if exists (
    select 1 from public.rol_permisos rp
      join public.permisos p on p.id = rp.permiso_id
      join public.roles r on r.id = rp.rol_id
     where p.clave in ('ventas.fiar_sin_recargo', 'clientes.cargar_saldo')
       and r.nombre <> 'ADMIN'
  ) then
    raise exception 'Guard: un permiso nuevo quedó en un rol que no es ADMIN';
  end if;

  -- corregir_cobro_cc: solo ADMIN
  select count(*) into v_antes_corregir_no_admin
    from public.rol_permisos rp
    join public.permisos p on p.id = rp.permiso_id
    join public.roles r on r.id = rp.rol_id
   where p.clave = 'clientes.corregir_cobro_cc' and r.nombre <> 'ADMIN';

  delete from public.rol_permisos rp
   using public.permisos p, public.roles r
   where p.id = rp.permiso_id and r.id = rp.rol_id
     and p.clave = 'clientes.corregir_cobro_cc' and r.nombre <> 'ADMIN';

  if exists (
    select 1 from public.rol_permisos rp
      join public.permisos p on p.id = rp.permiso_id
      join public.roles r on r.id = rp.rol_id
     where p.clave = 'clientes.corregir_cobro_cc' and r.nombre <> 'ADMIN'
  ) then
    raise exception 'Guard: corregir_cobro_cc sigue en un rol que no es ADMIN';
  end if;
  raise notice 'corregir_cobro_cc: % asignaciones no-ADMIN quitadas',
    v_antes_corregir_no_admin;

  -- registrar_venta: guard desde el cuerpo VIVO
  v_def := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);

  if (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar) <> 1 then
    raise exception 'Guard: el ancla de registrar_venta no matchea exactamente una vez';
  end if;

  v_nuevo := replace(v_def, v_buscar, v_guard);
  execute v_nuevo;

  v_def := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  if position('SIN_PERMISO_FIAR_SIN_RECARGO' in v_def) = 0
     or position('security.current_negocio_id()' in v_def) = 0 then
    raise exception 'Guard: registrar_venta quedó sin el guard o sin el negocio';
  end if;
  if (select prosecdef from pg_proc
       where oid = 'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure) then
    raise exception 'Guard: registrar_venta pasó a SECURITY DEFINER';
  end if;
  select count(*) into v_overloads from pg_proc
   where proname = 'registrar_venta' and pronamespace = 'public'::regnamespace;
  if v_overloads <> 1 then
    raise exception 'Guard: % versiones de registrar_venta', v_overloads;
  end if;
end $$;

-- Débito manual en la cuenta corriente: pide clientes.cargar_saldo.
drop policy if exists cc_debito_manual_requiere_permiso
  on public.cuenta_corriente_movimientos;
create policy cc_debito_manual_requiere_permiso
  on public.cuenta_corriente_movimientos
  as restrictive
  for insert
  to authenticated
  with check (
    tipo <> 'DEBITO'
    or venta_id is not null
    or pago_id is not null
    or (select public.tiene_permiso('clientes.cargar_saldo'))
  );

do $$
begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'cuenta_corriente_movimientos'
       and policyname = 'cc_debito_manual_requiere_permiso'
       and permissive = 'RESTRICTIVE' and cmd = 'INSERT'
       and qual is null
       and with_check like '%clientes.cargar_saldo%'
  ) then
    raise exception 'Guard: la policy de débito manual no quedó como se esperaba';
  end if;
end $$;
