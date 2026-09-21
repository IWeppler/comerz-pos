-- Etapa 5: liquidaciones reales de cobros digitales.
-- Un cobro queda en POR_ACREDITAR hasta que esta RPC lo liquida en una cuenta
-- concreta. No se modifica venta_pagos ni se infiere la fecha desde el plazo.
begin;

-- `venta_pagos` no tenía unique (negocio_id, id), así que la FK compuesta de
-- `acreditaciones_financieras_pagos` no se podía crear y esta migración fallaba
-- entera. Es redundante con la PK —`id` ya es único— y existe solo para que la
-- FK pueda atar también el negocio, mismo patrón que
-- `cuentas_financieras_negocio_id_id_key`. (Agregado el 20/9/2026, al aplicar:
-- esta migración estaba commiteada pero nunca había corrido en ningún lado.)
alter table public.venta_pagos
  add constraint venta_pagos_negocio_id_id_key unique (negocio_id, id);

create table public.acreditaciones_financieras (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id) on delete restrict,
  cuenta_destino_id uuid not null,
  fecha_acreditacion timestamptz not null default now(),
  referencia text,
  importe_neto numeric not null check (importe_neto > 0),
  creado_por uuid,
  creado_en timestamptz not null default now(),
  unique (negocio_id, id),
  foreign key (negocio_id, cuenta_destino_id)
    references public.cuentas_financieras(negocio_id, id) on delete restrict
);

create table public.acreditaciones_financieras_pagos (
  acreditacion_id uuid not null references public.acreditaciones_financieras(id) on delete restrict,
  venta_pago_id uuid not null,
  negocio_id uuid not null,
  monto_neto numeric not null check (monto_neto > 0),
  primary key (acreditacion_id, venta_pago_id),
  unique (negocio_id, venta_pago_id),
  foreign key (negocio_id, venta_pago_id)
    references public.venta_pagos(negocio_id, id) on delete restrict
);

create index acreditaciones_financieras_fecha_idx
  on public.acreditaciones_financieras(negocio_id, fecha_acreditacion desc);

alter table public.acreditaciones_financieras enable row level security;
alter table public.acreditaciones_financieras_pagos enable row level security;
create policy aislamiento_negocio on public.acreditaciones_financieras as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
create policy acreditaciones_select_gerencial on public.acreditaciones_financieras for select to authenticated
  using ((select public.tiene_permiso('caja.ver_gerencial')));
create policy aislamiento_negocio on public.acreditaciones_financieras_pagos as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));
create policy acreditaciones_pagos_select_gerencial on public.acreditaciones_financieras_pagos for select to authenticated
  using ((select public.tiene_permiso('caja.ver_gerencial')));

create or replace function public.registrar_acreditacion_financiera(
  p_cuenta_destino_id uuid,
  p_venta_pago_ids uuid[],
  p_fecha_acreditacion timestamptz default now(),
  p_referencia text default null
)
returns uuid language plpgsql security definer
set search_path = public, security, pg_temp
as $$
declare
  v_negocio_id uuid := security.current_negocio_id();
  v_usuario_id uuid := auth.uid();
  v_acreditacion_id uuid;
  v_puente_id uuid;
  v_neto numeric;
  v_cantidad integer;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then raise exception 'SIN_PERMISO'; end if;
  if coalesce(array_length(p_venta_pago_ids, 1), 0) = 0 then raise exception 'SIN_COBROS'; end if;
  if p_fecha_acreditacion is null then raise exception 'FECHA_INVALIDA'; end if;
  if not exists (select 1 from public.cuentas_financieras c where c.id = p_cuenta_destino_id and c.negocio_id = v_negocio_id and c.activa and c.codigo <> 'POR_ACREDITAR') then
    raise exception 'CUENTA_DESTINO_INVALIDA';
  end if;
  v_puente_id := public.cuenta_financiera_sistema(v_negocio_id, 'POR_ACREDITAR');

  select count(*), coalesce(sum(p.monto_neto), 0) into v_cantidad, v_neto
    from public.venta_pagos p
   where p.negocio_id = v_negocio_id
     and p.id = any(p_venta_pago_ids)
     and p.metodo_tipo <> 'EFECTIVO'
     and p.estado_pago_operacion <> 'ANULADO'
     and p.acreditacion_dias > 0
     and not exists (select 1 from public.acreditaciones_financieras_pagos ap where ap.negocio_id = v_negocio_id and ap.venta_pago_id = p.id);
  if v_cantidad <> cardinality(p_venta_pago_ids) then raise exception 'COBROS_NO_LIQUIDABLES'; end if;

  insert into public.acreditaciones_financieras(negocio_id, cuenta_destino_id, fecha_acreditacion, referencia, importe_neto, creado_por)
  values (v_negocio_id, p_cuenta_destino_id, p_fecha_acreditacion, nullif(btrim(p_referencia), ''), v_neto, v_usuario_id)
  returning id into v_acreditacion_id;
  insert into public.acreditaciones_financieras_pagos(acreditacion_id, venta_pago_id, negocio_id, monto_neto)
  select v_acreditacion_id, p.id, v_negocio_id, p.monto_neto from public.venta_pagos p
   where p.id = any(p_venta_pago_ids) and p.negocio_id = v_negocio_id;

  -- El puente ya recibió el neto al cobrar (Etapa 2). La liquidación solo lo
  -- reubica: no vuelve a reconocer comisión ni resultado económico.
  insert into public.movimientos_financieros(operacion_id, negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento, importe, impacto_resultado, descripcion, datos, fecha_movimiento, registrado_por)
  values
    (v_acreditacion_id, v_negocio_id, v_puente_id, 'ACREDITACION', v_acreditacion_id, 'ACREDITACION_SALIDA', -v_neto, 0, 'Liquidación a cuenta destino', jsonb_build_object('cuenta_destino_id', p_cuenta_destino_id), p_fecha_acreditacion, v_usuario_id),
    (v_acreditacion_id, v_negocio_id, p_cuenta_destino_id, 'ACREDITACION', v_acreditacion_id, 'ACREDITACION_ENTRADA', v_neto, 0, 'Liquidación de cobros digitales', jsonb_build_object('cuenta_puente_id', v_puente_id), p_fecha_acreditacion, v_usuario_id);
  return v_acreditacion_id;
end;
$$;

revoke all on function public.registrar_acreditacion_financiera(uuid, uuid[], timestamptz, text) from public;
grant execute on function public.registrar_acreditacion_financiera(uuid, uuid[], timestamptz, text) to authenticated;

alter table public.movimientos_financieros drop constraint movimientos_financieros_origen_tipo_check,
  add constraint movimientos_financieros_origen_tipo_check check (origen_tipo in ('VENTA_PAGO','EGRESO','TRANSFERENCIA','ACREDITACION'));
alter table public.movimientos_financieros drop constraint movimientos_financieros_evento_check,
  add constraint movimientos_financieros_evento_check check (evento in ('MIGRACION_ESTADO_INICIAL','REGISTRO','REGISTRO_ANULADO','ANULACION','REACTIVACION','CORRECCION_REVERSA','CORRECCION_APLICADA','CORRECCION_SIN_IMPACTO','ELIMINACION_REVERSA','TRANSFERENCIA_SALIDA','TRANSFERENCIA_ENTRADA','ACREDITACION_SALIDA','ACREDITACION_ENTRADA'));
commit;
