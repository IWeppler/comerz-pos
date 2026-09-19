-- Etapa 2: bitacora financiera en paralelo.
--
-- Registra, por trigger, el efecto financiero de venta_pagos y egresos. Es
-- append-only y NO reemplaza ninguna fuente existente: Caja, cierres,
-- posicion_dinero, dashboard y exportaciones siguen leyendo el modelo actual.
--
-- `importe` responde donde cambio el dinero:
--   positivo = entro a la cuenta; negativo = salio de la cuenta.
-- `impacto_resultado` responde si cambio el resultado economico:
--   cobro = 0; comision = negativa; gasto OPERATIVO = negativo;
--   retiro de socio y compra de mercaderia = 0.
--
-- Para pagos digitales se usa monto_neto. Mientras no exista una acreditacion
-- confirmada, cae en POR_ACREDITAR. Si el medio tiene destino configurado y
-- acreditacion_dias = 0, entra directo a esa cuenta. Esta bitacora no inventa
-- acreditaciones por fecha estimada: eso vendra en una etapa posterior.

begin;

create table public.movimientos_financieros (
  id                  bigint generated always as identity primary key,
  evento_id           uuid not null default gen_random_uuid() unique,
  operacion_id        uuid not null default gen_random_uuid(),
  negocio_id          uuid not null,
  cuenta_financiera_id uuid not null,
  origen_tipo         text not null,
  origen_id           uuid not null,
  evento              text not null,
  importe             numeric not null,
  impacto_resultado   numeric not null default 0,
  turno_caja_id       uuid,
  orden_compra_id     uuid,
  descripcion         text,
  datos               jsonb not null default '{}'::jsonb,
  fecha_movimiento    timestamptz not null,
  registrado_en       timestamptz not null default now(),
  registrado_por      uuid,

  constraint movimientos_financieros_cuenta_fkey
    foreign key (negocio_id, cuenta_financiera_id)
    references public.cuentas_financieras (negocio_id, id) on delete restrict,
  constraint movimientos_financieros_origen_tipo_check
    check (origen_tipo in ('VENTA_PAGO', 'EGRESO')),
  constraint movimientos_financieros_evento_check
    check (evento in (
      'MIGRACION_ESTADO_INICIAL',
      'REGISTRO',
      'REGISTRO_ANULADO',
      'ANULACION',
      'REACTIVACION',
      'CORRECCION_REVERSA',
      'CORRECCION_APLICADA',
      'CORRECCION_SIN_IMPACTO',
      'ELIMINACION_REVERSA'
    )),
  constraint movimientos_financieros_datos_objeto
    check (jsonb_typeof(datos) = 'object')
);

create index movimientos_financieros_cuenta_fecha_idx
  on public.movimientos_financieros (
    negocio_id, cuenta_financiera_id, fecha_movimiento desc, id desc
  );
create index movimientos_financieros_origen_idx
  on public.movimientos_financieros (
    negocio_id, origen_tipo, origen_id, registrado_en, id
  );
create index movimientos_financieros_turno_idx
  on public.movimientos_financieros (negocio_id, turno_caja_id)
  where turno_caja_id is not null;
create index movimientos_financieros_operacion_idx
  on public.movimientos_financieros (operacion_id, id);

comment on table public.movimientos_financieros is
  'Bitacora financiera append-only. Es espejo en paralelo de venta_pagos y egresos; en Etapa 2 ninguna pantalla ni calculo existente la usa como fuente de verdad.';
comment on column public.movimientos_financieros.importe is
  'Cambio firmado en la cuenta: entrada positiva, salida negativa. En pagos digitales usa monto_neto; monto_bruto y comision quedan congelados en datos.';
comment on column public.movimientos_financieros.impacto_resultado is
  'Cambio economico firmado separado del flujo financiero. Evita tratar transferencias/retiros/compras como gasto operativo.';
comment on column public.movimientos_financieros.operacion_id is
  'Agrupa reversa y aplicacion de una misma correccion. No es el id de la venta ni del egreso.';
comment on column public.movimientos_financieros.fecha_movimiento is
  'Fecha efectiva del evento. En MIGRACION_ESTADO_INICIAL conserva la fecha de la fuente; una correccion usa el momento en que se hizo.';

alter table public.movimientos_financieros enable row level security;

create policy aislamiento_negocio on public.movimientos_financieros
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy movimientos_financieros_select_gerencial
  on public.movimientos_financieros
  for select to authenticated
  using ((select public.tiene_permiso('caja.ver_gerencial')));

-- Sin policy INSERT/UPDATE/DELETE. Solo triggers SECURITY DEFINER escriben.
-- La segunda barrera bloquea UPDATE/DELETE incluso a un caller privilegiado:
-- una correccion siempre se expresa con nuevas filas compensatorias.
create or replace function public.impedir_mutacion_movimiento_financiero()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'BITACORA_FINANCIERA_APPEND_ONLY';
end;
$$;

revoke all on function public.impedir_mutacion_movimiento_financiero()
  from public;

create trigger trg_movimientos_financieros_inmutable
  before update or delete on public.movimientos_financieros
  for each row execute function public.impedir_mutacion_movimiento_financiero();

-- Cuenta que recibe el efecto ACTUAL del pago. cuenta_destino_id es el destino
-- final congelado; POR_ACREDITAR es el lugar transitorio cuando hay demora o
-- cuando el comercio aun no configuro la cuenta real.
create or replace function public.cuenta_actual_venta_pago(
  p_negocio_id uuid,
  p_metodo_tipo text,
  p_acreditacion_dias integer,
  p_cuenta_destino_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_cuenta uuid;
begin
  if p_metodo_tipo = 'EFECTIVO' then
    v_cuenta := coalesce(
      p_cuenta_destino_id,
      public.cuenta_financiera_sistema(p_negocio_id, 'CAJA_DIARIA')
    );
  elsif coalesce(p_acreditacion_dias, 0) = 0
        and p_cuenta_destino_id is not null then
    v_cuenta := p_cuenta_destino_id;
  else
    v_cuenta := public.cuenta_financiera_sistema(
      p_negocio_id, 'POR_ACREDITAR'
    );
  end if;

  if v_cuenta is null then
    raise exception 'CUENTA_FINANCIERA_SISTEMA_INEXISTENTE';
  end if;

  return v_cuenta;
end;
$$;

revoke all on function public.cuenta_actual_venta_pago(uuid, text, integer, uuid)
  from public;

create or replace function public.importe_financiero_venta_pago(
  p_metodo_tipo text,
  p_monto_bruto numeric,
  p_monto_neto numeric
)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_metodo_tipo = 'EFECTIVO' then p_monto_bruto
    else p_monto_neto
  end;
$$;

revoke all on function public.importe_financiero_venta_pago(text, numeric, numeric)
  from public;

create or replace function public.snapshot_financiero_venta_pago(
  p public.venta_pagos
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'venta_id', p.venta_id,
    'cliente_id', p.cliente_id,
    'metodo_pago_id', p.metodo_pago_id,
    'metodo_nombre', p.metodo_nombre,
    'metodo_tipo', p.metodo_tipo,
    'tipo_movimiento', p.tipo_movimiento,
    'estado_pago_operacion', p.estado_pago_operacion,
    'monto_base', p.monto_base,
    'recargo_monto', p.recargo_monto,
    'monto_bruto', p.monto_bruto,
    'comision_monto', p.comision_monto,
    'monto_neto', p.monto_neto,
    'acreditacion_dias', p.acreditacion_dias,
    'cuenta_destino_id', p.cuenta_destino_id
  );
$$;

revoke all on function public.snapshot_financiero_venta_pago(public.venta_pagos)
  from public;

create or replace function public.registrar_bitacora_venta_pago()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_operacion     uuid := gen_random_uuid();
  v_cuenta_old    uuid;
  v_cuenta_new    uuid;
  v_importe_old   numeric;
  v_importe_new   numeric;
  v_cambio        boolean;
begin
  if tg_op = 'INSERT' then
    v_cuenta_new := public.cuenta_actual_venta_pago(
      new.negocio_id,
      new.metodo_tipo,
      new.acreditacion_dias,
      new.cuenta_destino_id
    );
    v_importe_new := public.importe_financiero_venta_pago(
      new.metodo_tipo, new.monto_bruto, new.monto_neto
    );

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then 'REGISTRO' else 'REGISTRO_ANULADO' end,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then v_importe_new else 0 end,
      case when new.estado_pago_operacion = 'CONFIRMADO'
        then -new.comision_monto else 0 end,
      new.turno_caja_id,
      format('Cobro por %s', new.metodo_nombre),
      public.snapshot_financiero_venta_pago(new),
      new.creado_en,
      auth.uid()
    );

    return new;
  end if;

  if tg_op = 'DELETE' then
    v_cuenta_old := public.cuenta_actual_venta_pago(
      old.negocio_id,
      old.metodo_tipo,
      old.acreditacion_dias,
      old.cuenta_destino_id
    );
    v_importe_old := public.importe_financiero_venta_pago(
      old.metodo_tipo, old.monto_bruto, old.monto_neto
    );

    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, old.negocio_id, v_cuenta_old,
      'VENTA_PAGO', old.id, 'ELIMINACION_REVERSA',
      case when old.estado_pago_operacion = 'CONFIRMADO'
        then -v_importe_old else 0 end,
      case when old.estado_pago_operacion = 'CONFIRMADO'
        then old.comision_monto else 0 end,
      old.turno_caja_id,
      format('Eliminacion de cobro por %s', old.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old)
      ),
      now(),
      auth.uid()
    );

    return old;
  end if;

  v_cambio := row(
    old.estado_pago_operacion,
    old.metodo_pago_id,
    old.metodo_nombre,
    old.metodo_tipo,
    old.monto_base,
    old.recargo_monto,
    old.monto_bruto,
    old.comision_monto,
    old.monto_neto,
    old.acreditacion_dias,
    old.cuenta_destino_id,
    old.turno_caja_id
  ) is distinct from row(
    new.estado_pago_operacion,
    new.metodo_pago_id,
    new.metodo_nombre,
    new.metodo_tipo,
    new.monto_base,
    new.recargo_monto,
    new.monto_bruto,
    new.comision_monto,
    new.monto_neto,
    new.acreditacion_dias,
    new.cuenta_destino_id,
    new.turno_caja_id
  );

  if not v_cambio then
    return new;
  end if;

  v_cuenta_old := public.cuenta_actual_venta_pago(
    old.negocio_id,
    old.metodo_tipo,
    old.acreditacion_dias,
    old.cuenta_destino_id
  );
  v_cuenta_new := public.cuenta_actual_venta_pago(
    new.negocio_id,
    new.metodo_tipo,
    new.acreditacion_dias,
    new.cuenta_destino_id
  );
  v_importe_old := public.importe_financiero_venta_pago(
    old.metodo_tipo, old.monto_bruto, old.monto_neto
  );
  v_importe_new := public.importe_financiero_venta_pago(
    new.metodo_tipo, new.monto_bruto, new.monto_neto
  );

  if old.estado_pago_operacion = 'CONFIRMADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, old.negocio_id, v_cuenta_old,
      'VENTA_PAGO', old.id,
      case when new.estado_pago_operacion = 'ANULADO'
        then 'ANULACION' else 'CORRECCION_REVERSA' end,
      -v_importe_old,
      old.comision_monto,
      old.turno_caja_id,
      format('Reversa de cobro por %s', old.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  end if;

  if new.estado_pago_operacion = 'CONFIRMADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id,
      case when old.estado_pago_operacion = 'ANULADO'
        then 'REACTIVACION' else 'CORRECCION_APLICADA' end,
      v_importe_new,
      -new.comision_monto,
      new.turno_caja_id,
      format('Cobro corregido por %s', new.metodo_nombre),
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  elsif old.estado_pago_operacion = 'ANULADO' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, descripcion, datos, fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, v_cuenta_new,
      'VENTA_PAGO', new.id, 'CORRECCION_SIN_IMPACTO', 0, 0,
      new.turno_caja_id,
      'Correccion sobre cobro anulado',
      jsonb_build_object(
        'anterior', public.snapshot_financiero_venta_pago(old),
        'nuevo', public.snapshot_financiero_venta_pago(new)
      ),
      now(),
      auth.uid()
    );
  end if;

  return new;
end;
$$;

revoke all on function public.registrar_bitacora_venta_pago()
  from public;

create trigger trg_venta_pagos_bitacora_financiera
  after insert or update or delete on public.venta_pagos
  for each row execute function public.registrar_bitacora_venta_pago();

create or replace function public.snapshot_financiero_egreso(
  e public.egresos
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'concepto', e.concepto,
    'monto', e.monto,
    'tipo', e.tipo,
    'turno_caja_id', e.turno_caja_id,
    'orden_compra_id', e.orden_compra_id,
    'cuenta_origen_id', e.cuenta_origen_id
  );
$$;

revoke all on function public.snapshot_financiero_egreso(public.egresos)
  from public;

create or replace function public.registrar_bitacora_egreso()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
declare
  v_operacion uuid := gen_random_uuid();
  v_cambio    boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, orden_compra_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      v_operacion, new.negocio_id, new.cuenta_origen_id,
      'EGRESO', new.id, 'REGISTRO', -new.monto,
      case when new.tipo = 'OPERATIVO' then -new.monto else 0 end,
      new.turno_caja_id, new.orden_compra_id, new.concepto,
      public.snapshot_financiero_egreso(new),
      new.fecha,
      coalesce(auth.uid(), new.creado_por)
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.movimientos_financieros (
      operacion_id, negocio_id, cuenta_financiera_id,
      origen_tipo, origen_id, evento, importe, impacto_resultado,
      turno_caja_id, orden_compra_id, descripcion, datos,
      fecha_movimiento, registrado_por
    ) values (
      v_operacion, old.negocio_id, old.cuenta_origen_id,
      'EGRESO', old.id, 'ELIMINACION_REVERSA', old.monto,
      case when old.tipo = 'OPERATIVO' then old.monto else 0 end,
      old.turno_caja_id, old.orden_compra_id, old.concepto,
      jsonb_build_object(
        'anterior', public.snapshot_financiero_egreso(old)
      ),
      now(),
      auth.uid()
    );
    return old;
  end if;

  v_cambio := row(
    old.negocio_id,
    old.cuenta_origen_id,
    old.monto,
    old.tipo,
    old.concepto,
    old.turno_caja_id,
    old.orden_compra_id
  ) is distinct from row(
    new.negocio_id,
    new.cuenta_origen_id,
    new.monto,
    new.tipo,
    new.concepto,
    new.turno_caja_id,
    new.orden_compra_id
  );

  if not v_cambio then
    return new;
  end if;

  insert into public.movimientos_financieros (
    operacion_id, negocio_id, cuenta_financiera_id,
    origen_tipo, origen_id, evento, importe, impacto_resultado,
    turno_caja_id, orden_compra_id, descripcion, datos,
    fecha_movimiento, registrado_por
  ) values (
    v_operacion, old.negocio_id, old.cuenta_origen_id,
    'EGRESO', old.id, 'CORRECCION_REVERSA', old.monto,
    case when old.tipo = 'OPERATIVO' then old.monto else 0 end,
    old.turno_caja_id, old.orden_compra_id, old.concepto,
    jsonb_build_object(
      'anterior', public.snapshot_financiero_egreso(old),
      'nuevo', public.snapshot_financiero_egreso(new)
    ),
    now(),
    auth.uid()
  ), (
    v_operacion, new.negocio_id, new.cuenta_origen_id,
    'EGRESO', new.id, 'CORRECCION_APLICADA', -new.monto,
    case when new.tipo = 'OPERATIVO' then -new.monto else 0 end,
    new.turno_caja_id, new.orden_compra_id, new.concepto,
    jsonb_build_object(
      'anterior', public.snapshot_financiero_egreso(old),
      'nuevo', public.snapshot_financiero_egreso(new)
    ),
    now(),
    auth.uid()
  );

  return new;
end;
$$;

revoke all on function public.registrar_bitacora_egreso()
  from public;

create trigger trg_egresos_bitacora_financiera
  after insert or update or delete on public.egresos
  for each row execute function public.registrar_bitacora_egreso();

-- Baseline honesto: representa el estado vigente al aplicar la migracion, no
-- inventa fechas historicas de anulacion. Por eso cada fuente recibe UNA fila
-- MIGRACION_ESTADO_INICIAL; un pago ya anulado entra con importe cero.
insert into public.movimientos_financieros (
  negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
  importe, impacto_resultado, turno_caja_id, descripcion, datos,
  fecha_movimiento, registrado_por
)
select
  p.negocio_id,
  public.cuenta_actual_venta_pago(
    p.negocio_id,
    p.metodo_tipo,
    p.acreditacion_dias,
    p.cuenta_destino_id
  ),
  'VENTA_PAGO',
  p.id,
  'MIGRACION_ESTADO_INICIAL',
  case when p.estado_pago_operacion = 'CONFIRMADO'
    then public.importe_financiero_venta_pago(
      p.metodo_tipo, p.monto_bruto, p.monto_neto
    )
    else 0
  end,
  case when p.estado_pago_operacion = 'CONFIRMADO'
    then -p.comision_monto else 0 end,
  p.turno_caja_id,
  format('Estado inicial de cobro por %s', p.metodo_nombre),
  public.snapshot_financiero_venta_pago(p),
  p.creado_en,
  null
from public.venta_pagos p;

insert into public.movimientos_financieros (
  negocio_id, cuenta_financiera_id, origen_tipo, origen_id, evento,
  importe, impacto_resultado, turno_caja_id, orden_compra_id,
  descripcion, datos, fecha_movimiento, registrado_por
)
select
  e.negocio_id,
  e.cuenta_origen_id,
  'EGRESO',
  e.id,
  'MIGRACION_ESTADO_INICIAL',
  -e.monto,
  case when e.tipo = 'OPERATIVO' then -e.monto else 0 end,
  e.turno_caja_id,
  e.orden_compra_id,
  e.concepto,
  public.snapshot_financiero_egreso(e),
  e.fecha,
  e.creado_por
from public.egresos e;

-- Guardas de cobertura y reconciliacion del baseline. Comparan por origen para
-- no mezclar el flujo financiero con el resultado economico.
do $$
declare
  v_error          bigint;
  v_esperado       numeric;
  v_registrado     numeric;
  v_resultado_esp  numeric;
  v_resultado_reg  numeric;
begin
  select count(*) into v_error
    from public.venta_pagos p
   where not exists (
     select 1 from public.movimientos_financieros m
      where m.origen_tipo = 'VENTA_PAGO'
        and m.origen_id = p.id
        and m.negocio_id = p.negocio_id
        and m.evento = 'MIGRACION_ESTADO_INICIAL'
   );
  if v_error <> 0 then
    raise exception 'Faltan % pagos en el baseline financiero.', v_error;
  end if;

  select count(*) into v_error
    from public.egresos e
   where not exists (
     select 1 from public.movimientos_financieros m
      where m.origen_tipo = 'EGRESO'
        and m.origen_id = e.id
        and m.negocio_id = e.negocio_id
        and m.evento = 'MIGRACION_ESTADO_INICIAL'
   );
  if v_error <> 0 then
    raise exception 'Faltan % egresos en el baseline financiero.', v_error;
  end if;

  select coalesce(sum(case
    when estado_pago_operacion <> 'CONFIRMADO' then 0
    when metodo_tipo = 'EFECTIVO' then monto_bruto
    else monto_neto
  end), 0),
  coalesce(sum(case
    when estado_pago_operacion = 'CONFIRMADO' then -comision_monto
    else 0
  end), 0)
  into v_esperado, v_resultado_esp
  from public.venta_pagos;

  select coalesce(sum(importe), 0), coalesce(sum(impacto_resultado), 0)
    into v_registrado, v_resultado_reg
    from public.movimientos_financieros
   where origen_tipo = 'VENTA_PAGO'
     and evento = 'MIGRACION_ESTADO_INICIAL';

  if v_esperado is distinct from v_registrado
     or v_resultado_esp is distinct from v_resultado_reg then
    raise exception
      'Baseline de pagos no reconcilia. Flujo esperado %, registrado %; resultado esperado %, registrado %.',
      v_esperado, v_registrado, v_resultado_esp, v_resultado_reg;
  end if;

  select coalesce(sum(-monto), 0),
         coalesce(sum(case when tipo = 'OPERATIVO' then -monto else 0 end), 0)
    into v_esperado, v_resultado_esp
    from public.egresos;

  select coalesce(sum(importe), 0), coalesce(sum(impacto_resultado), 0)
    into v_registrado, v_resultado_reg
    from public.movimientos_financieros
   where origen_tipo = 'EGRESO'
     and evento = 'MIGRACION_ESTADO_INICIAL';

  if v_esperado is distinct from v_registrado
     or v_resultado_esp is distinct from v_resultado_reg then
    raise exception
      'Baseline de egresos no reconcilia. Flujo esperado %, registrado %; resultado esperado %, registrado %.',
      v_esperado, v_registrado, v_resultado_esp, v_resultado_reg;
  end if;

  select count(*) into v_error
    from (values
      ('venta_pagos', 'trg_venta_pagos_bitacora_financiera'),
      ('egresos', 'trg_egresos_bitacora_financiera'),
      ('movimientos_financieros', 'trg_movimientos_financieros_inmutable')
    ) as esperado(tabla, trigger_nombre)
   where not exists (
     select 1 from pg_trigger t
      where t.tgrelid = ('public.' || esperado.tabla)::regclass
        and t.tgname = esperado.trigger_nombre
        and not t.tgisinternal
   );
  if v_error <> 0 then
    raise exception 'Faltan % triggers de bitacora financiera.', v_error;
  end if;
end;
$$;

commit;
