-- Corregir el medio de pago de un cobro de cuenta corriente sin tocar la
-- deuda amortizada. La operación actualiza venta_pagos y la leyenda del libro
-- mayor en una sola transacción y deja un historial append-only.
--
-- Turno abierto: quien registró el cobro puede corregirlo y el arqueo derivado
-- cambia inmediatamente.
-- Turno cerrado: solo ADMIN puede corregirlo. El snapshot firmado del cierre
-- permanece inmutable; la auditoría explica la diferencia y los reportes que
-- derivan desde venta_pagos pasan a usar el medio real.

begin;

create table public.cobros_cc_correcciones (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null default security.current_negocio_id(),
  pago_id         uuid not null references public.venta_pagos(id) on delete restrict,
  cliente_id      uuid not null references public.clientes(id) on delete restrict,
  valor_anterior  jsonb not null,
  valor_nuevo     jsonb not null,
  turno_estado    text not null check (turno_estado in (''ABIERTO'', ''CERRADO'')),
  motivo          text,
  corregido_por   uuid,
  corregido_en    timestamptz not null default now()
);

create index idx_cobros_cc_correcciones_pago
  on public.cobros_cc_correcciones (negocio_id, pago_id, corregido_en);

alter table public.cobros_cc_correcciones enable row level security;

create policy aislamiento_negocio on public.cobros_cc_correcciones
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy cobros_cc_correcciones_select on public.cobros_cc_correcciones
  for select to authenticated using (true);

create policy cobros_cc_correcciones_insert on public.cobros_cc_correcciones
  for insert to authenticated with check (true);

insert into public.permisos (clave, modulo, descripcion)
values (
  ''clientes.corregir_cobro_cc'',
  ''clientes'',
  ''Corregir el medio de pago de un cobro de cuenta corriente''
)
on conflict (clave) do nothing;

-- Mantiene la capacidad que ya existe: quien puede cobrar puede corregir su
-- propio cobro mientras la caja sigue abierta. La función aplica el límite
-- adicional de ADMIN cuando el turno ya cerró.
insert into public.rol_permisos (rol_id, permiso_id, negocio_id)
select rp.rol_id, nuevo.id, rp.negocio_id
  from public.rol_permisos rp
  join public.permisos actual
    on actual.id = rp.permiso_id
   and actual.clave = ''clientes.cobrar_cc''
 cross join (
   select id from public.permisos where clave = ''clientes.corregir_cobro_cc''
 ) nuevo
on conflict do nothing;

create or replace function public.corregir_metodo_pago_cobro_cc(
  p_pago_id uuid,
  p_metodo_pago_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio       uuid := security.current_negocio_id();
  v_usuario       uuid := auth.uid();
  v_pago          public.venta_pagos%rowtype;
  v_movimiento    public.cuenta_corriente_movimientos%rowtype;
  v_metodo        public.metodos_pago%rowtype;
  v_turno         public.turnos_caja%rowtype;
  v_creditos      integer;
  v_base          numeric;
  v_recargo       numeric;
  v_bruto         numeric;
  v_comision      numeric;
  v_descripcion   text;
  v_anterior      jsonb;
begin
  if v_negocio is null then
    raise exception ''SIN_NEGOCIO_ACTIVO'';
  end if;

  if not public.tiene_permiso(''clientes.corregir_cobro_cc'') then
    raise exception ''SIN_PERMISO'';
  end if;

  select * into v_pago
    from public.venta_pagos
   where id = p_pago_id
   for update;

  if not found or v_pago.negocio_id is distinct from v_negocio then
    raise exception ''COBRO_INEXISTENTE'';
  end if;

  if v_pago.tipo_movimiento <> ''PAGO_CUENTA_CORRIENTE''
     or v_pago.venta_id is not null
     or v_pago.cliente_id is null
     or v_pago.estado_pago_operacion <> ''CONFIRMADO'' then
    raise exception ''COBRO_NO_CORREGIBLE'';
  end if;

  select count(*) into v_creditos
    from public.cuenta_corriente_movimientos
   where pago_id = p_pago_id
     and tipo = ''CREDITO''
     and not coalesce(anulado, false);

  if v_creditos <> 1 then
    raise exception ''COBRO_SIN_MOVIMIENTO'';
  end if;

  select * into v_movimiento
    from public.cuenta_corriente_movimientos
   where pago_id = p_pago_id
     and tipo = ''CREDITO''
     and not coalesce(anulado, false)
   for update;

  if v_movimiento.negocio_id is distinct from v_negocio
     or v_movimiento.cliente_id is distinct from v_pago.cliente_id then
    raise exception ''COBRO_SIN_MOVIMIENTO'';
  end if;

  if v_movimiento.creado_por is distinct from v_usuario
     and not coalesce(public.is_admin(), false) then
    raise exception ''COBRO_AJENO'';
  end if;

  select * into v_turno
    from public.turnos_caja
   where id = v_pago.turno_caja_id;

  if not found or v_turno.negocio_id is distinct from v_negocio then
    raise exception ''COBRO_NO_CORREGIBLE'';
  end if;

  if v_turno.estado = ''CERRADO''
     and not coalesce(public.is_admin(), false) then
    raise exception ''TURNO_CERRADO_REQUIERE_ADMIN'';
  end if;

  select * into v_metodo
    from public.metodos_pago
   where id = p_metodo_pago_id
     and negocio_id = v_negocio
     and activo;

  if not found then
    raise exception ''METODO_INEXISTENTE'';
  end if;

  if v_metodo.id = v_pago.metodo_pago_id then
    raise exception ''MISMO_METODO'';
  end if;

  v_base := coalesce(v_pago.monto_base, v_movimiento.monto);
  v_recargo := round(v_base * coalesce(v_metodo.recargo_porcentaje, 0) / 100);
  v_bruto := v_base + v_recargo;
  v_comision := round(v_bruto * coalesce(v_metodo.comision, 0) / 100, 2);
  v_descripcion := case
    when v_recargo > 0 then
      format(
        ''Pago a cuenta - %s (incluye $%s de recargo por %s)'',
        v_metodo.nombre,
        v_recargo,
        v_metodo.nombre
      )
    else format(''Pago a cuenta - %s'', v_metodo.nombre)
  end;

  v_anterior := jsonb_build_object(
    ''metodo_pago_id'',       v_pago.metodo_pago_id,
    ''metodo_nombre'',        v_pago.metodo_nombre,
    ''metodo_tipo'',          v_pago.metodo_tipo,
    ''recargo_porcentaje'',   v_pago.recargo_porcentaje,
    ''recargo_monto'',        v_pago.recargo_monto,
    ''monto_bruto'',          v_pago.monto_bruto,
    ''comision_porcentaje'',  v_pago.comision_porcentaje,
    ''comision_monto'',       v_pago.comision_monto,
    ''monto_neto'',           v_pago.monto_neto,
    ''acreditacion_dias'',    v_pago.acreditacion_dias
  );

  update public.venta_pagos
     set metodo_pago_id      = v_metodo.id,
         metodo_nombre       = v_metodo.nombre,
         metodo_tipo         = v_metodo.tipo,
         recargo_porcentaje  = coalesce(v_metodo.recargo_porcentaje, 0),
         recargo_monto       = v_recargo,
         monto_bruto         = v_bruto,
         comision_porcentaje = coalesce(v_metodo.comision, 0),
         comision_monto      = v_comision,
         monto_neto          = v_bruto - v_comision,
         acreditacion_dias   = coalesce(v_metodo.acreditacion_dias, 0)
   where id = p_pago_id;

  update public.cuenta_corriente_movimientos
     set descripcion = v_descripcion
   where id = v_movimiento.id;

  insert into public.cobros_cc_correcciones (
    negocio_id,
    pago_id,
    cliente_id,
    valor_anterior,
    valor_nuevo,
    turno_estado,
    motivo,
    corregido_por
  ) values (
    v_negocio,
    p_pago_id,
    v_pago.cliente_id,
    v_anterior,
    jsonb_build_object(
      ''metodo_pago_id'',       v_metodo.id,
      ''metodo_nombre'',        v_metodo.nombre,
      ''metodo_tipo'',          v_metodo.tipo,
      ''recargo_porcentaje'',   coalesce(v_metodo.recargo_porcentaje, 0),
      ''recargo_monto'',        v_recargo,
      ''monto_bruto'',          v_bruto,
      ''comision_porcentaje'',  coalesce(v_metodo.comision, 0),
      ''comision_monto'',       v_comision,
      ''monto_neto'',           v_bruto - v_comision,
      ''acreditacion_dias'',    coalesce(v_metodo.acreditacion_dias, 0)
    ),
    v_turno.estado,
    nullif(btrim(coalesce(p_motivo, '''')), ''''),
    v_usuario
  );

  return jsonb_build_object(
    ''metodo_anterior'',  v_pago.metodo_nombre,
    ''metodo_nuevo'',     v_metodo.nombre,
    ''total_anterior'',   v_pago.monto_bruto,
    ''total_nuevo'',      v_bruto,
    ''diferencia_total'', v_bruto - v_pago.monto_bruto,
    ''turno_cerrado'',    v_turno.estado = ''CERRADO''
  );
end;
$$;

comment on function public.corregir_metodo_pago_cobro_cc(uuid, uuid, text) is
  ''Corrige en una transacción el medio de un cobro de cuenta corriente, sin ''
  ''cambiar el capital amortizado. Conserva el snapshot de turnos cerrados y ''
  ''registra antes/después en cobros_cc_correcciones.'';

revoke all on function public.corregir_metodo_pago_cobro_cc(uuid, uuid, text)
  from public;
grant execute on function public.corregir_metodo_pago_cobro_cc(uuid, uuid, text)
  to authenticated;

-- El cierre firmado no se reescribe. Esta lectura devuelve el esperado según
-- los movimientos que están vigentes AHORA para que el historial pueda
-- mostrar, junto al original, el efecto de una corrección posterior.
create or replace function public.efectivo_actual_turnos(p_turno_ids uuid[])
returns table (turno_id uuid, efectivo_esperado_actual numeric)
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio uuid := security.current_negocio_id();
begin
  if v_negocio is null then
    raise exception ''SIN_NEGOCIO_ACTIVO'';
  end if;

  if not public.tiene_permiso(''caja.operar'')
     and not public.tiene_permiso(''caja.ver_gerencial'') then
    raise exception ''SIN_PERMISO'';
  end if;

  return query
  with pagos as (
    select vp.turno_caja_id, sum(vp.monto_bruto) as efectivo
      from public.venta_pagos vp
     where vp.negocio_id = v_negocio
       and vp.turno_caja_id = any(coalesce(p_turno_ids, ''{}''::uuid[]))
       and vp.metodo_tipo = ''EFECTIVO''
       and vp.estado_pago_operacion <> ''ANULADO''
     group by vp.turno_caja_id
  ),
  salidas as (
    select e.turno_caja_id, sum(e.monto) as egresos
      from public.egresos e
     where e.negocio_id = v_negocio
       and e.turno_caja_id = any(coalesce(p_turno_ids, ''{}''::uuid[]))
     group by e.turno_caja_id
  )
  select
    t.id,
    t.monto_inicial + coalesce(p.efectivo, 0) - coalesce(s.egresos, 0)
  from public.turnos_caja t
  left join pagos p on p.turno_caja_id = t.id
  left join salidas s on s.turno_caja_id = t.id
  where t.negocio_id = v_negocio
    and t.id = any(coalesce(p_turno_ids, ''{}''::uuid[]));
end;
$$;

revoke all on function public.efectivo_actual_turnos(uuid[]) from public;
grant execute on function public.efectivo_actual_turnos(uuid[]) to authenticated;

do $$
begin
  if not exists (
    select 1 from public.permisos
     where clave = ''clientes.corregir_cobro_cc''
  ) then
    raise exception ''No se creó el permiso clientes.corregir_cobro_cc.'';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = ''public''
       and tablename = ''cobros_cc_correcciones''
       and cmd in (''UPDATE'', ''DELETE'', ''ALL'')
       and policyname <> ''aislamiento_negocio''
  ) then
    raise exception ''La auditoría de cobros CC no puede ser editable.'';
  end if;
end;
$$;

commit;
