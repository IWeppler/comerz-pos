-- RLS por ROL en las tablas que la venta escribe con la sesión de quien vende
-- (auditoría de seguridad del 22/10/2026, RLS por rol).
--
-- EL HUECO. `clientes`, `cuenta_corriente_movimientos`, `promociones` (UPDATE),
-- `producto_variantes`, `producto_variante_valores` y `productos_stock` tenían
-- una policy "permitir todo" para cualquier rol del negocio. Desde la consola del
-- navegador una vendedora podía poner en cero la deuda de un cliente, borrar o
-- editar movimientos de CC, cargarse un crédito, editar promociones o cambiar el
-- stock y el precio de cualquier variante. Se habían dejado abiertas porque
-- `registrar_venta`, `anular_venta`, `registrar_cobro_cc`, etc. son INVOKER:
-- escriben con la RLS de quien vende, y cerrar la tabla rompía la venta.
--
-- LA SALIDA, sin reescribir la venta: distinguir la escritura DIRECTA (PostgREST
-- sobre la tabla, `request.path` = '/clientes') de la que pasa por una función
-- (`request.path` = '/rpc/…'). PostgREST setea `request.path` en cada pedido
-- (verificado el 22/10 en pg_stat_statements). Sin pedido HTTP (SQL, jobs) no
-- hay path y no es escritura directa.
--  - Escritura directa → pide el permiso de la acción.
--  - Dentro de una RPC → manda la RPC (cada RPC valida lo suyo).
-- OJO: esto deja la seguridad de esas tablas en las RPC que las escriben. Las
-- que hoy no validan permiso adentro (anular_venta, registrar_cobro_cc,
-- fusionar_productos, importar_productos_planilla, guardar_variantes_producto,
-- ajustar_stock_*) quedan igual que antes (abiertas) y van en la tanda
-- siguiente. Acá se cierra `ajustar_saldo_cliente`, la que deja mover saldo con
-- cualquier monto.
--
-- Qué pide cada cosa (por escritura directa):
--  - clientes: cambiar `saldo_pendiente` (o crear con saldo ≠ 0) →
--    `clientes.cargar_saldo`; cambiar `lista_precio_id` → ADMIN (decisión del
--    22/10); borrar → ADMIN (ninguna pantalla borra clientes).
--  - ajustar_saldo_cliente (también por RPC) → `clientes.cargar_saldo`. La llaman
--    solo cargar saldo / CSV (ya piden ese permiso) y perdonar / editar / anular
--    movimiento manual (ya piden admin, que tiene todos los permisos).
--  - cuenta_corriente_movimientos: CRÉDITO manual (sin venta ni pago) →
--    `clientes.cargar_saldo` (el DÉBITO manual ya lo pedía); UPDATE/DELETE → ADMIN
--    (igual que `editar/anularMovimientoManualAction` en Node).
--  - promociones: UPDATE → ADMIN (alta y baja ya lo pedían).
--  - producto_variantes, producto_variante_valores → `stock.editar_producto`;
--    productos_stock → `stock.editar_producto` o `stock.dar_baja` (la pantalla
--    de bajas actualiza el espejo).
--
-- Impacto medido el 22/10: los 156 movimientos manuales de CC de los últimos 90
-- días los hizo un ADMIN; `clientes.cargar_saldo` no lo tiene ningún otro rol.
-- Reversión: supabase/reversals/20261022220000_rls_escritura_directa_por_rol.sql

begin;

-- ── El criterio, en un solo lugar ────────────────────────────────────────────
create function security.es_escritura_directa()
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  -- '/rpc/…' = dentro de una función; sin path = no viene de PostgREST.
  select coalesce(nullif(current_setting('request.path', true), ''), '/rpc/') not like '/rpc/%';
$$;

revoke all on function security.es_escritura_directa() from public;
grant execute on function security.es_escritura_directa() to authenticated, service_role;

-- ── clientes ─────────────────────────────────────────────────────────────────
create function security.proteger_campos_cliente()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- service_role (webhooks, scripts) no tiene sesión ni permisos de rol: la
  -- RLS ya no le aplica y este trigger tampoco.
  if not security.es_escritura_directa() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.saldo_pendiente, 0) <> 0
       and not public.tiene_permiso('clientes.cargar_saldo') then
      raise exception 'SIN_PERMISO_SALDO_CLIENTE' using errcode = '42501';
    end if;
    if new.lista_precio_id is not null and not public.is_admin() then
      raise exception 'SIN_PERMISO_LISTA_PRECIO' using errcode = '42501';
    end if;
  else
    if new.saldo_pendiente is distinct from old.saldo_pendiente
       and not public.tiene_permiso('clientes.cargar_saldo') then
      raise exception 'SIN_PERMISO_SALDO_CLIENTE' using errcode = '42501';
    end if;
    if new.lista_precio_id is distinct from old.lista_precio_id
       and not public.is_admin() then
      raise exception 'SIN_PERMISO_LISTA_PRECIO' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger trg_proteger_campos_cliente
  before insert or update of saldo_pendiente, lista_precio_id on public.clientes
  for each row execute function security.proteger_campos_cliente();

create policy clientes_borrar_directo_admin on public.clientes
  as restrictive for delete to authenticated
  using (not (select security.es_escritura_directa()) or (select public.is_admin()));

-- ── ajustar_saldo_cliente: pide el permiso adentro ───────────────────────────
do $$
declare
  d text := pg_get_functiondef('public.ajustar_saldo_cliente(uuid, numeric)'::regprocedure);
  v_viejo text := E'    raise exception ''AJUSTE_SALDO_DATOS_INVALIDOS'';\n  end if;\n';
  v_veces int;
begin
  v_veces := (length(d) - length(replace(d, v_viejo, ''))) / length(v_viejo);
  if v_veces <> 1 then
    raise exception 'ajustar_saldo_cliente: el ancla aparece % veces', v_veces;
  end if;
  d := replace(d, v_viejo, v_viejo
    || E'\n'
    || E'  -- Mueve plata que no entró: cargar saldo, perdonar, corregir un manual.\n'
    || E'  -- Lo llaman acciones que ya piden este permiso (o admin, que lo tiene).\n'
    || E'  if not public.tiene_permiso(''clientes.cargar_saldo'') then\n'
    || E'    raise exception ''SIN_PERMISO'' using errcode = ''42501'';\n'
    || E'  end if;\n');
  execute d;
end $$;

-- ── cuenta_corriente_movimientos ─────────────────────────────────────────────
create policy cc_credito_manual_directo_requiere_permiso on public.cuenta_corriente_movimientos
  as restrictive for insert to authenticated
  with check (
    tipo <> 'CREDITO'
    or venta_id is not null
    or pago_id is not null
    or not (select security.es_escritura_directa())
    or (select public.tiene_permiso('clientes.cargar_saldo'))
  );

create policy cc_editar_directo_admin on public.cuenta_corriente_movimientos
  as restrictive for update to authenticated
  using (not (select security.es_escritura_directa()) or (select public.is_admin()))
  with check (not (select security.es_escritura_directa()) or (select public.is_admin()));

create policy cc_borrar_directo_admin on public.cuenta_corriente_movimientos
  as restrictive for delete to authenticated
  using (not (select security.es_escritura_directa()) or (select public.is_admin()));

-- ── promociones ──────────────────────────────────────────────────────────────
create policy promociones_editar_directo_admin on public.promociones
  as restrictive for update to authenticated
  using (not (select security.es_escritura_directa()) or (select public.is_admin()))
  with check (not (select security.es_escritura_directa()) or (select public.is_admin()));

-- ── stock y variantes ────────────────────────────────────────────────────────
do $$
declare
  t text;
  v_cond text;
begin
  foreach t in array array['producto_variantes', 'producto_variante_valores', 'productos_stock'] loop
    v_cond := case t
      when 'productos_stock' then
        '(not (select security.es_escritura_directa()) or (select public.tiene_permiso(''stock.editar_producto'')) or (select public.tiene_permiso(''stock.dar_baja'')))'
      else
        '(not (select security.es_escritura_directa()) or (select public.tiene_permiso(''stock.editar_producto'')))'
    end;
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check %s',
                   t || '_alta_directa_permiso', t, v_cond);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using %s with check %s',
                   t || '_edicion_directa_permiso', t, v_cond, v_cond);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using %s',
                   t || '_baja_directa_permiso', t, v_cond);
  end loop;
end $$;

-- ── Guards ───────────────────────────────────────────────────────────────────
do $guard$
declare
  v_n int;
begin
  -- Las 14 policies nuevas, todas RESTRICTIVE y para authenticated.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and permissive = 'RESTRICTIVE' and roles = '{authenticated}'
     and policyname in (
       'clientes_borrar_directo_admin',
       'cc_credito_manual_directo_requiere_permiso', 'cc_editar_directo_admin', 'cc_borrar_directo_admin',
       'promociones_editar_directo_admin',
       'producto_variantes_alta_directa_permiso', 'producto_variantes_edicion_directa_permiso', 'producto_variantes_baja_directa_permiso',
       'producto_variante_valores_alta_directa_permiso', 'producto_variante_valores_edicion_directa_permiso', 'producto_variante_valores_baja_directa_permiso',
       'productos_stock_alta_directa_permiso', 'productos_stock_edicion_directa_permiso', 'productos_stock_baja_directa_permiso');
  if v_n <> 14 then
    raise exception 'se esperaban 14 policies restrictivas nuevas, hay %', v_n;
  end if;

  -- Ninguna restringe SELECT: la lectura no cambia.
  if exists (select 1 from pg_policies
              where schemaname = 'public' and cmd in ('SELECT', 'ALL')
                and coalesce(qual, '') || coalesce(with_check, '') like '%es_escritura_directa%') then
    raise exception 'una policy nueva alcanza a SELECT';
  end if;

  -- El aislamiento por negocio sigue en las seis tablas.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and policyname = 'aislamiento_negocio' and permissive = 'RESTRICTIVE'
     and tablename in ('clientes', 'cuenta_corriente_movimientos', 'promociones',
                       'producto_variantes', 'producto_variante_valores', 'productos_stock');
  if v_n <> 6 then
    raise exception 'falta aislamiento_negocio en alguna tabla (%/6)', v_n;
  end if;

  if position('clientes.cargar_saldo' in pg_get_functiondef('public.ajustar_saldo_cliente(uuid, numeric)'::regprocedure)) = 0 then
    raise exception 'ajustar_saldo_cliente no quedó con el permiso';
  end if;
  if (select count(*) from pg_proc where proname = 'ajustar_saldo_cliente') <> 1 then
    raise exception 'ajustar_saldo_cliente: se esperaba una sola versión';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_proteger_campos_cliente'
                    and tgrelid = 'public.clientes'::regclass and tgenabled = 'O') then
    raise exception 'falta el trigger de clientes';
  end if;

  if not has_function_privilege('authenticated', 'security.es_escritura_directa()', 'EXECUTE') then
    raise exception 'authenticated no puede evaluar es_escritura_directa';
  end if;
end $guard$;

commit;
