-- Permisos de caja para el módulo financiero.
--
-- Hasta acá la caja tenía tres permisos: `caja.operar` (abrir/cerrar turno y
-- registrar gastos), `caja.cerrar_ajena` y `caja.ver_gerencial`, y ese último
-- hacía de llave maestra de todo lo nuevo: transferir entre cuentas, leer el
-- ledger, declarar saldos. No alcanza para lo que viene —anular movimientos,
-- revertir transferencias, una tabla general de movimientos— porque mezcla
-- "puede VER la plata" con "puede MOVER la plata", y son dos confianzas
-- distintas: a una encargada se le muestra el resumen del día sin que por eso
-- pueda pasar $500.000 de Mercado Pago a la caja grande.
--
-- Cuatro permisos nuevos, y a quién se le dan HOY (nadie pierde nada):
--
--   caja.registrar_egreso  → los roles que ya tienen `caja.operar`
--                            (ADMIN 11, ENCARGADO 11, VENDEDOR 9 de 11).
--                            Sale de adentro de `caja.operar` para que el
--                            dueño pueda sacarle los gastos a una vendedora
--                            sin sacarle la apertura del turno.
--   caja.transferir        → los roles que ya tienen `caja.ver_gerencial`
--                            (ADMIN 11, ENCARGADO 1). Es lo que la RPC exigía;
--                            ahora tiene nombre propio y se puede quitar solo.
--   caja.ver_movimientos   → los roles que ya tienen `caja.ver_gerencial`.
--                            Leer el ledger y la tabla general.
--   caja.anular_movimiento → solo ADMIN. Anular un egreso, revertir una
--                            transferencia. Mismo criterio que
--                            `ventas.elegir_medio_devolucion`: es la única
--                            forma de hacer desaparecer plata ya registrada.
--
-- Los negocios nuevos reciben los cuatro solos para ADMIN
-- (`crear_negocio_con_owner` le da todas las filas de `permisos`). ENCARGADO
-- y VENDEDOR de un negocio nuevo NO los reciben: la lista default de
-- ENCARGADO es la de `20260717001048` y ahí no está `caja.operar` tampoco —
-- se los otorga el dueño desde la pantalla de roles, que es el camino de
-- siempre.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LO QUE ESTA MIGRACIÓN ARREGLA DE PASO, Y ES LO QUE MÁS IMPORTA
--
-- `egresos_insert_propio` decía `with check (creado_por = auth.uid())` y nada
-- más. O sea: cualquier miembro del negocio, con cualquier rol y SIN
-- `caja.operar`, podía insertar un egreso desde la consola del navegador
-- (supabase-js ya tiene la sesión). La action lo frenaba; la base no. Es el
-- mismo agujero que `20260905120000` cerró en configuración y catálogo, y
-- quedó abierto acá porque en ese momento la caja no tenía permiso de
-- escritura propio.
--
-- Ahora la policy pide `caja.registrar_egreso`. Con una excepción declarada:
-- `anular_venta` es SECURITY INVOKER a propósito (el aislamiento tiene que
-- seguir siendo la RLS del que llama) e inserta el egreso "Devolución en
-- efectivo" con la sesión de quien anula. Quien tiene `ventas.anular` tiene
-- que poder escribir ESE egreso aunque no tenga el de gastos, o la anulación
-- se cae entera por un permiso que no es de ella. Hoy no pasaría (los 5
-- ENCARGADO con `ventas.anular` tienen `caja.operar`), pero es un acople que
-- hay que dejar escrito en la policy y no descubrir el día que alguien
-- desmarque un casillero.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LOS PERMISOS
-- ─────────────────────────────────────────────────────────────────────────

insert into public.permisos (clave, modulo, descripcion)
values
  ('caja.registrar_egreso', 'caja',
   'Registrar gastos y salidas de dinero'),
  ('caja.transferir', 'caja',
   'Pasar dinero entre cuentas propias (caja, banco, billeteras)'),
  ('caja.ver_movimientos', 'caja',
   'Ver la tabla general de movimientos de dinero y el detalle de cada cuenta'),
  ('caja.anular_movimiento', 'caja',
   'Anular un gasto o revertir una transferencia ya registrada')
on conflict (clave) do nothing;

-- registrar_egreso: a quien ya opera caja.
insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select rp.rol_id, nuevo.id, rp.negocio_id
  from public.rol_permisos rp
  join public.permisos actual
    on actual.id = rp.permiso_id and actual.clave = 'caja.operar'
 cross join (select id from public.permisos where clave = 'caja.registrar_egreso') as nuevo
on conflict (rol_id, permiso_id) do nothing;

-- transferir y ver_movimientos: a quien ya ve lo gerencial.
insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select rp.rol_id, nuevo.id, rp.negocio_id
  from public.rol_permisos rp
  join public.permisos actual
    on actual.id = rp.permiso_id and actual.clave = 'caja.ver_gerencial'
 cross join (
   select id from public.permisos
    where clave in ('caja.transferir', 'caja.ver_movimientos')
 ) as nuevo
on conflict (rol_id, permiso_id) do nothing;

-- anular_movimiento: solo ADMIN.
insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select r.id, p.id, r.negocio_id
  from public.roles r
  cross join public.permisos p
 where r.nombre = 'ADMIN'
   and r.negocio_id is not null
   and p.clave = 'caja.anular_movimiento'
on conflict (rol_id, permiso_id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. LA BASE LOS CUMPLE
-- ─────────────────────────────────────────────────────────────────────────

-- Egresos: escribir pide el permiso (ver arriba por qué `ventas.anular`
-- también pasa). El subselect es obligatorio: sin él la función corre una vez
-- por fila (`20260905120000`).
drop policy if exists egresos_insert_propio on public.egresos;
create policy egresos_insert_propio on public.egresos
  for insert to authenticated
  with check (
    creado_por = auth.uid()
    and (
      (select public.tiene_permiso('caja.registrar_egreso'))
      or (select public.tiene_permiso('ventas.anular'))
    )
  );

-- Ledger y transferencias: leer pide ver_movimientos. Nadie pierde acceso
-- porque todo rol con ver_gerencial acaba de recibirlo.
drop policy if exists movimientos_financieros_select_gerencial
  on public.movimientos_financieros;
create policy movimientos_financieros_select_movimientos
  on public.movimientos_financieros
  for select to authenticated
  using ((select public.tiene_permiso('caja.ver_movimientos')));

drop policy if exists transferencias_select_gerencial
  on public.transferencias_financieras;
create policy transferencias_select_movimientos
  on public.transferencias_financieras
  for select to authenticated
  using ((select public.tiene_permiso('caja.ver_movimientos')));

-- La RPC de transferencia pedía ver_gerencial. Se cambia UNA línea del cuerpo
-- VIVO (`pg_get_functiondef`, 21/9/2026), no del archivo de `20260919150000`:
-- el vivo tiene el freno de la cuenta puente (`CUENTA_PUENTE_RESERVADA`) y
-- otros códigos de error que el archivo no tiene. Dos gates, y los dos hacen
-- falta: el de adentro es la puerta real (la función es SECURITY DEFINER), el
-- de la policy de SELECT es para leer lo que hizo.
create or replace function public.registrar_transferencia_financiera(
  p_cuenta_origen_id uuid,
  p_cuenta_destino_id uuid,
  p_monto numeric,
  p_concepto text,
  p_turno_caja_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_transferencia uuid;
  v_operacion uuid := gen_random_uuid();
  v_origen public.cuentas_financieras;
  v_destino public.cuentas_financieras;
  v_turno public.turnos_caja;
  v_turno_origen uuid;
  v_turno_destino uuid;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.transferir') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  if p_monto is null or p_monto <= 0
     or nullif(btrim(p_concepto), '') is null
     or p_cuenta_origen_id is null or p_cuenta_destino_id is null
     or p_cuenta_origen_id = p_cuenta_destino_id then
    raise exception 'TRANSFERENCIA_INVALIDA';
  end if;

  select * into v_origen from public.cuentas_financieras
   where negocio_id = v_negocio and id = p_cuenta_origen_id and activa
   for update;
  select * into v_destino from public.cuentas_financieras
   where negocio_id = v_negocio and id = p_cuenta_destino_id and activa
   for update;
  if v_origen.id is null or v_destino.id is null then
    raise exception 'CUENTA_NO_DISPONIBLE';
  end if;
  if v_origen.tipo = 'PUENTE_ACREDITACION' or v_destino.tipo = 'PUENTE_ACREDITACION' then
    raise exception 'CUENTA_PUENTE_RESERVADA';
  end if;

  if v_origen.requiere_arqueo or v_destino.requiere_arqueo then
    if p_turno_caja_id is null then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
    select * into v_turno from public.turnos_caja
     where negocio_id = v_negocio and id = p_turno_caja_id and estado = 'ABIERTO'
     for update;
    if v_turno.id is null
       or (v_turno.cuenta_financiera_id <> p_cuenta_origen_id
           and v_turno.cuenta_financiera_id <> p_cuenta_destino_id) then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
    if v_turno.cuenta_financiera_id = p_cuenta_origen_id then
      v_turno_origen := v_turno.id;
    end if;
    if v_turno.cuenta_financiera_id = p_cuenta_destino_id then
      v_turno_destino := v_turno.id;
    end if;
  end if;

  insert into public.transferencias_financieras (
    negocio_id, cuenta_origen_id, cuenta_destino_id, monto, concepto, registrado_por
  ) values (
    v_negocio, p_cuenta_origen_id, p_cuenta_destino_id, p_monto, btrim(p_concepto), auth.uid()
  ) returning id into v_transferencia;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id,
    evento, importe, impacto_resultado, turno_caja_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values
  (
    v_operacion, v_negocio, p_cuenta_origen_id, 'TRANSFERENCIA', v_transferencia,
    'REGISTRO', -p_monto, 0, v_turno_origen,
    format('Transferencia a %s: %s', v_destino.nombre, btrim(p_concepto)),
    jsonb_build_object('cuenta_origen_id', p_cuenta_origen_id,
                       'cuenta_destino_id', p_cuenta_destino_id),
    now(), auth.uid()
  ),
  (
    v_operacion, v_negocio, p_cuenta_destino_id, 'TRANSFERENCIA', v_transferencia,
    'REGISTRO', p_monto, 0, v_turno_destino,
    format('Transferencia desde %s: %s', v_origen.nombre, btrim(p_concepto)),
    jsonb_build_object('cuenta_origen_id', p_cuenta_origen_id,
                       'cuenta_destino_id', p_cuenta_destino_id),
    now(), auth.uid()
  );

  return v_transferencia;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. GUARDS
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  v_operar   int;
  v_egreso   int;
  v_gerencial int;
  v_transf   int;
  v_ver      int;
  v_admin    int;
  v_anular   int;
begin
  -- Nadie perdió: cada (rol, negocio) con el permiso viejo tiene el nuevo.
  select count(*) into v_operar
    from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
   where p.clave = 'caja.operar';
  select count(*) into v_egreso
    from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
   where p.clave = 'caja.registrar_egreso';
  if v_egreso < v_operar then
    raise exception 'GUARD: registrar_egreso (%) no cubre a caja.operar (%)', v_egreso, v_operar;
  end if;

  select count(*) into v_gerencial
    from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
   where p.clave = 'caja.ver_gerencial';
  select count(*) into v_transf
    from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
   where p.clave = 'caja.transferir';
  select count(*) into v_ver
    from public.rol_permisos rp join public.permisos p on p.id = rp.permiso_id
   where p.clave = 'caja.ver_movimientos';
  if v_transf < v_gerencial or v_ver < v_gerencial then
    raise exception 'GUARD: transferir (%) / ver_movimientos (%) no cubren a ver_gerencial (%)',
      v_transf, v_ver, v_gerencial;
  end if;

  -- anular_movimiento: todos los ADMIN y nadie más.
  select count(*) into v_admin
    from public.roles where nombre = 'ADMIN' and negocio_id is not null;
  select count(*) into v_anular
    from public.rol_permisos rp
    join public.permisos p on p.id = rp.permiso_id
    join public.roles r on r.id = rp.rol_id
   where p.clave = 'caja.anular_movimiento' and r.nombre = 'ADMIN';
  if v_anular <> v_admin then
    raise exception 'GUARD: anular_movimiento en % ADMIN de %', v_anular, v_admin;
  end if;
  if exists (
    select 1 from public.rol_permisos rp
      join public.permisos p on p.id = rp.permiso_id
      join public.roles r on r.id = rp.rol_id
     where p.clave = 'caja.anular_movimiento' and r.nombre <> 'ADMIN'
  ) then
    raise exception 'GUARD: anular_movimiento otorgado fuera de ADMIN';
  end if;

  -- La policy de egresos quedó atada al permiso.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'egresos'
       and policyname = 'egresos_insert_propio'
       and with_check like '%caja.registrar_egreso%'
       and with_check like '%ventas.anular%'
  ) then
    raise exception 'GUARD: egresos_insert_propio no pide caja.registrar_egreso';
  end if;

  -- La RPC pide el permiso nuevo y ya no el viejo.
  if pg_get_functiondef('public.registrar_transferencia_financiera(uuid,uuid,numeric,text,uuid)'::regprocedure)
     not like '%caja.transferir%' then
    raise exception 'GUARD: registrar_transferencia_financiera no pide caja.transferir';
  end if;
  -- Y la reescritura no perdió lo que el cuerpo vivo tenía y el archivo
  -- viejo no (misma lección que `20260904140000`).
  if pg_get_functiondef('public.registrar_transferencia_financiera(uuid,uuid,numeric,text,uuid)'::regprocedure)
     not like '%CUENTA_PUENTE_RESERVADA%' then
    raise exception 'GUARD: la reescritura perdió el freno de la cuenta puente';
  end if;
end $$;

commit;
