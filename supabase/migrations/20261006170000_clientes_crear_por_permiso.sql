-- Crear clientes exige `clientes.crear` (6/10/2026, pedido de Ignacio).
--
-- Hasta hoy `clientes` tenía una PERMISSIVE `true` para cualquier autenticado:
-- cualquier vendedora daba de alta clientes desde el POS o la ficha, y en
-- Librería Colores eso llenó la lista de duplicados (la misma escuela cargada
-- dos veces, cada una con su parte de la deuda).
--
-- El corte:
--   * Permiso nuevo `clientes.crear`. La pantalla de roles lo muestra sola.
--   * Policy RESTRICTIVE de INSERT sobre `clientes`: la base lo exige, el botón
--     escondido no es control de acceso. Editar, leer y borrar no cambian.
--     La importación por CSV también inserta, así que también lo pide.
--   * Nadie pierde nada fuera de Colores: el permiso se asigna a TODOS los
--     roles de todos los negocios (hoy todos crean clientes), MENOS a ENCARGADO
--     y VENDEDOR de Librería Colores, donde a partir de ahora solo crea la
--     admin. Si un dueño quiere lo mismo, lo saca en Empleados y Permisos.
--   * `crear_negocio_con_owner` (la de 9 parámetros, la que usa el alta) le da
--     `clientes.crear` a ENCARGADO y VENDEDOR junto con lo mínimo para vender:
--     un comercio nuevo arranca como hoy. Se reescribe desde el cuerpo VIVO.
--
-- No hay funciones SQL que inserten en `clientes` (verificado sobre pg_proc):
-- las únicas altas son `crearClienteAction` e `importarClientesCSVAction`.
--
-- Reversión: supabase/reversals/20261006170000_clientes_crear_por_permiso.sql

do $mig$
declare
  v_colores constant uuid := '27b693c8-44f5-49c2-b3df-66d00be6719a';
  v_permiso uuid;
  v_filas int;
  v_roles int;
  v_def text;
  v_viejo text;
  v_nuevo text;
  v_veces int;
begin
  if not exists (select 1 from negocios where id = v_colores and nombre = 'Librería Colores') then
    raise exception 'El negocio de Colores no es el esperado';
  end if;
  if exists (select 1 from permisos where clave = 'clientes.crear') then
    raise exception 'clientes.crear ya existe: ¿se corrió dos veces?';
  end if;

  insert into permisos (clave, modulo, descripcion)
  values ('clientes.crear', 'clientes', 'Dar de alta clientes nuevos (POS, ficha de clientes e importación)')
  returning id into v_permiso;

  -- Todos los roles, menos los no-ADMIN de Colores.
  select count(*) into v_roles
    from roles r
   where not (r.negocio_id = v_colores and r.nombre <> 'ADMIN');

  insert into rol_permisos (rol_id, permiso_id, negocio_id)
  select r.id, v_permiso, r.negocio_id
    from roles r
   where not (r.negocio_id = v_colores and r.nombre <> 'ADMIN');
  get diagnostics v_filas = row_count;
  if v_filas <> v_roles or v_filas = 0 then
    raise exception 'Asignaciones: % sobre % roles', v_filas, v_roles;
  end if;

  -- Colores: solo ADMIN.
  if (select array_agg(r.nombre order by r.nombre)
        from rol_permisos rp join roles r on r.id = rp.rol_id
       where rp.permiso_id = v_permiso and r.negocio_id = v_colores) <> array['ADMIN'] then
    raise exception 'En Colores el permiso no quedó solo en ADMIN';
  end if;

  -- Ningún otro negocio pierde nada: todo usuario fuera de Colores lo tiene.
  if exists (
    select 1 from usuarios_negocios un
     where un.negocio_id <> v_colores and un.rol_id is not null
       and not exists (select 1 from rol_permisos rp
                        where rp.rol_id = un.rol_id and rp.permiso_id = v_permiso)
  ) then
    raise exception 'Hay usuarios fuera de Colores que perderían clientes.crear';
  end if;

  -- Alta de comercio: ENCARGADO y VENDEDOR nacen pudiendo crear clientes.
  select pg_get_functiondef('public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure)
    into v_def;
  v_viejo := 'AND p.clave IN (''ventas.cobrar'', ''caja.operar'');';
  v_nuevo := 'AND p.clave IN (''ventas.cobrar'', ''caja.operar'', ''clientes.crear'');';
  v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_veces <> 1 then
    raise exception 'crear_negocio_con_owner: el ancla matchea % veces', v_veces;
  end if;
  execute replace(v_def, v_viejo, v_nuevo);

  select pg_get_functiondef('public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure)
    into v_def;
  if v_def not like '%''clientes.crear''%' or v_def not like '%SECURITY DEFINER%'
     or v_def not like '%auth.uid()%' then
    raise exception 'crear_negocio_con_owner no quedó como se esperaba';
  end if;
end
$mig$;

create policy clientes_crear_con_permiso on public.clientes
  as restrictive
  for insert to authenticated
  with check ((select public.tiene_permiso('clientes.crear')));

do $mig$
begin
  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'clientes'
         and policyname = 'clientes_crear_con_permiso'
         and permissive = 'RESTRICTIVE' and cmd = 'INSERT'
         and with_check like '%tiene_permiso%clientes.crear%') <> 1 then
    raise exception 'La policy de INSERT de clientes no quedó como se esperaba';
  end if;
end
$mig$;
