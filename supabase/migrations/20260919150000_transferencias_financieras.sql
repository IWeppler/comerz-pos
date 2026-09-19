-- Etapa 4: transferencias internas. Mueven dinero entre cuentas sin crear
-- ingreso, egreso ni efecto económico.

begin;

create table public.transferencias_financieras (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id) on delete restrict,
  cuenta_origen_id uuid not null,
  cuenta_destino_id uuid not null,
  monto numeric not null check (monto > 0),
  concepto text not null check (length(btrim(concepto)) > 0),
  fecha timestamptz not null default now(),
  registrado_por uuid,
  creado_en timestamptz not null default now(),
  constraint transferencias_cuentas_distintas
    check (cuenta_origen_id <> cuenta_destino_id),
  constraint transferencias_origen_fkey
    foreign key (negocio_id, cuenta_origen_id)
    references public.cuentas_financieras(negocio_id, id) on delete restrict,
  constraint transferencias_destino_fkey
    foreign key (negocio_id, cuenta_destino_id)
    references public.cuentas_financieras(negocio_id, id) on delete restrict
);

create index transferencias_financieras_fecha_idx
  on public.transferencias_financieras(negocio_id, fecha desc);

alter table public.transferencias_financieras enable row level security;
create policy aislamiento_negocio on public.transferencias_financieras
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
create policy transferencias_select_gerencial
  on public.transferencias_financieras for select to authenticated
  using ((select public.tiene_permiso('caja.ver_gerencial')));

create trigger trg_transferencias_inmutables
  before update or delete on public.transferencias_financieras
  for each row execute function public.impedir_mutacion_movimiento_financiero();

alter table public.movimientos_financieros
  drop constraint movimientos_financieros_origen_tipo_check,
  add constraint movimientos_financieros_origen_tipo_check
    check (origen_tipo in ('VENTA_PAGO', 'EGRESO', 'TRANSFERENCIA'));

comment on table public.transferencias_financieras is
  'Cabecera inmutable de pases entre fondos propios. Sus dos movimientos financieros suman cero y su impacto_resultado es cero.';

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
  if not public.tiene_permiso('caja.ver_gerencial') then
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
  if v_origen.tipo = 'PUENTE_ACREDITACION'
     or v_destino.tipo = 'PUENTE_ACREDITACION' then
    raise exception 'CUENTA_PUENTE_RESERVADA';
  end if;

  if v_origen.requiere_arqueo or v_destino.requiere_arqueo then
    if p_turno_caja_id is null then
      raise exception 'CAJA_DIARIA_REQUIERE_TURNO_ABIERTO';
    end if;
    select * into v_turno from public.turnos_caja
     where negocio_id = v_negocio
       and id = p_turno_caja_id
       and estado = 'ABIERTO'
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

  insert into public.transferencias_financieras(
    negocio_id, cuenta_origen_id, cuenta_destino_id, monto, concepto,
    registrado_por
  ) values (
    v_negocio, p_cuenta_origen_id, p_cuenta_destino_id, p_monto,
    btrim(p_concepto), auth.uid()
  ) returning id into v_transferencia;

  insert into public.movimientos_financieros(
    operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id,
    evento, importe, impacto_resultado, turno_caja_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values
  (
    v_operacion, v_negocio, p_cuenta_origen_id, 'TRANSFERENCIA', v_transferencia,
    'REGISTRO', -p_monto, 0, v_turno_origen,
    format('Transferencia a %s: %s', v_destino.nombre, btrim(p_concepto)),
    jsonb_build_object('cuenta_origen_id', p_cuenta_origen_id,
      'cuenta_destino_id', p_cuenta_destino_id), now(), auth.uid()
  ),
  (
    v_operacion, v_negocio, p_cuenta_destino_id, 'TRANSFERENCIA', v_transferencia,
    'REGISTRO', p_monto, 0, v_turno_destino,
    format('Transferencia desde %s: %s', v_origen.nombre, btrim(p_concepto)),
    jsonb_build_object('cuenta_origen_id', p_cuenta_origen_id,
      'cuenta_destino_id', p_cuenta_destino_id), now(), auth.uid()
  );

  return v_transferencia;
end;
$$;

revoke all on function public.registrar_transferencia_financiera(uuid, uuid, numeric, text, uuid)
  from public, anon;
grant execute on function public.registrar_transferencia_financiera(uuid, uuid, numeric, text, uuid)
  to authenticated;

create or replace function public.transferencias_caja_turno(p_turno_id uuid)
returns table (
  movimiento_id bigint,
  importe numeric,
  descripcion text,
  fecha_movimiento timestamptz
)
language plpgsql
stable security definer
set search_path = public, security, pg_temp
as $$
declare v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.operar')
     and not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;
  return query
  select m.id, m.importe, m.descripcion, m.fecha_movimiento
    from public.turnos_caja t
    join public.movimientos_financieros m
      on m.negocio_id = t.negocio_id
     and m.turno_caja_id = t.id
     and m.cuenta_financiera_id = t.cuenta_financiera_id
     and m.origen_tipo = 'TRANSFERENCIA'
   where t.negocio_id = v_negocio
     and t.id = p_turno_id
     and (t.modo = 'UNICA' or t.vendedor_id = auth.uid()
          or public.tiene_permiso('caja.cerrar_ajena'))
   order by m.fecha_movimiento desc, m.id desc;
end;
$$;

revoke all on function public.transferencias_caja_turno(uuid) from public, anon;
grant execute on function public.transferencias_caja_turno(uuid) to authenticated;

create or replace function public.estado_cuentas_financieras()
returns jsonb
language plpgsql
stable security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
  v_out jsonb;
begin
  if v_negocio is null then raise exception 'SIN_NEGOCIO_ACTIVO'; end if;
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'SIN_PERMISO' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'cuentas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'codigo', c.codigo, 'nombre', c.nombre, 'tipo', c.tipo,
        'es_efectivo', c.es_efectivo, 'requiere_arqueo', c.requiere_arqueo,
        'es_sistema', c.es_sistema, 'activa', c.activa
      ) order by c.es_sistema desc, c.nombre)
      from public.cuentas_financieras c
      where c.negocio_id = v_negocio and c.activa
        and c.tipo <> 'PUENTE_ACREDITACION'
    ), '[]'::jsonb),
    'transferencias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'monto', x.monto, 'concepto', x.concepto,
        'fecha', x.fecha, 'origen_nombre', o.nombre,
        'destino_nombre', d.nombre, 'registrado_por_nombre', p.nombre
      ) order by x.fecha desc)
      from (
        select * from public.transferencias_financieras
        where negocio_id = v_negocio order by fecha desc limit 20
      ) x
      join public.cuentas_financieras o on o.id = x.cuenta_origen_id
      join public.cuentas_financieras d on d.id = x.cuenta_destino_id
      left join public.perfiles p on p.id = x.registrado_por
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.estado_cuentas_financieras() from public, anon;
grant execute on function public.estado_cuentas_financieras() to authenticated;

do $$
declare v_error bigint;
begin
  select count(*) into v_error
    from public.movimientos_financieros m
   where m.origen_tipo = 'TRANSFERENCIA'
   group by m.origen_id
  having count(*) <> 2 or sum(m.importe) <> 0 or sum(m.impacto_resultado) <> 0
  limit 1;
  if coalesce(v_error, 0) <> 0 then
    raise exception 'Una transferencia no quedó balanceada.';
  end if;
end;
$$;

commit;
