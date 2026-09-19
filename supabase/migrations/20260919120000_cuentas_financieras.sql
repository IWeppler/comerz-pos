-- Etapa 1: cuentas financieras SIN cambiar el comportamiento actual.
--
-- Esta migracion crea la identidad de los fondos y deja referencias en las
-- tablas que hoy mueven dinero. Caja, POS, reportes, cierres y posicion_dinero
-- siguen leyendo exactamente las columnas anteriores. Ninguna consulta
-- existente usa estas relaciones todavia.
--
-- Dos cuentas de sistema se crean por negocio:
--   CAJA_DIARIA   efectivo fisico sujeto a arqueo.
--   POR_ACREDITAR cuenta puente para cobros digitales aun no acreditados.
--
-- No se crea una caja general, banco o billetera ficticios: esas cuentas
-- necesitan nombre y realidad operativa del comercio. Inventarlas seria peor
-- que dejarlas pendientes para la etapa de configuracion.

begin;

create table public.cuentas_financieras (
  id                uuid primary key default gen_random_uuid(),
  negocio_id        uuid not null default security.current_negocio_id()
                    references public.negocios(id) on delete restrict,
  codigo            text not null,
  nombre            text not null,
  tipo              text not null,
  es_efectivo       boolean not null default false,
  requiere_arqueo   boolean not null default false,
  es_sistema        boolean not null default false,
  activa            boolean not null default true,
  creado_por        uuid,
  creado_en         timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint cuentas_financieras_codigo_no_vacio
    check (length(btrim(codigo)) > 0),
  constraint cuentas_financieras_codigo_canonico
    check (codigo = upper(btrim(codigo))),
  constraint cuentas_financieras_nombre_no_vacio
    check (length(btrim(nombre)) > 0),
  constraint cuentas_financieras_tipo_check
    check (tipo in (
      'CAJA_DIARIA',
      'CAJA_GENERAL',
      'BANCO',
      'BILLETERA',
      'PUENTE_ACREDITACION',
      'OTRA'
    )),
  constraint cuentas_financieras_arqueo_solo_efectivo
    check (not requiere_arqueo or es_efectivo),
  constraint cuentas_financieras_negocio_codigo_key
    unique (negocio_id, codigo),
  constraint cuentas_financieras_negocio_id_id_key
    unique (negocio_id, id)
);

create index cuentas_financieras_activas_idx
  on public.cuentas_financieras (negocio_id, tipo, nombre)
  where activa;

comment on table public.cuentas_financieras is
  'Fondos y cuentas donde esta el dinero. No guarda saldo: el saldo se deriva de movimientos_financieros. Etapa 1 aditiva; ninguna lectura de Caja depende de esta tabla todavia.';
comment on column public.cuentas_financieras.codigo is
  'Identidad estable dentro del negocio. CAJA_DIARIA y POR_ACREDITAR son codigos reservados para cuentas de sistema.';
comment on column public.cuentas_financieras.requiere_arqueo is
  'La cuenta representa efectivo fisico que se compara contra un monto declarado. Solo CAJA_DIARIA nace con esta marca.';

alter table public.cuentas_financieras enable row level security;

create policy aislamiento_negocio on public.cuentas_financieras
  as restrictive for all to public
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

create policy cuentas_financieras_select on public.cuentas_financieras
  for select to authenticated using (true);

create policy cuentas_financieras_insert_admin on public.cuentas_financieras
  for insert to authenticated with check ((select public.is_admin()));
create policy cuentas_financieras_update_admin on public.cuentas_financieras
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy cuentas_financieras_delete_admin on public.cuentas_financieras
  for delete to authenticated using ((select public.is_admin()));

create trigger trg_cuentas_financieras_updated_at
  before update on public.cuentas_financieras
  for each row execute function public.marcar_updated_at();

-- La funcion tambien la usa el trigger de alta de negocios. Recibe el UUID
-- explicito porque durante el alta la cookie todavia puede apuntar al negocio
-- anterior (mismo problema documentado en 20260826230000).
create or replace function public.sembrar_cuentas_financieras_sistema(
  p_negocio_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  if p_negocio_id is null
     or not exists (select 1 from public.negocios where id = p_negocio_id) then
    raise exception 'NEGOCIO_INEXISTENTE';
  end if;

  insert into public.cuentas_financieras (
    negocio_id, codigo, nombre, tipo, es_efectivo, requiere_arqueo, es_sistema
  ) values
    (p_negocio_id, 'CAJA_DIARIA', 'Caja diaria', 'CAJA_DIARIA', true, true, true),
    (p_negocio_id, 'POR_ACREDITAR', 'Dinero por acreditar', 'PUENTE_ACREDITACION', false, false, true)
  on conflict (negocio_id, codigo) do nothing;
end;
$$;

revoke all on function public.sembrar_cuentas_financieras_sistema(uuid)
  from public;

select public.sembrar_cuentas_financieras_sistema(id)
  from public.negocios;

create or replace function public.sembrar_cuentas_financieras_nuevo_negocio()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  perform public.sembrar_cuentas_financieras_sistema(new.id);
  return new;
end;
$$;

revoke all on function public.sembrar_cuentas_financieras_nuevo_negocio()
  from public;

create trigger trg_negocios_sembrar_cuentas_financieras
  after insert on public.negocios
  for each row execute function public.sembrar_cuentas_financieras_nuevo_negocio();

-- Resolvedor interno. Los callers siempre pasan negocio_id explicitamente;
-- no depende de sesion ni de la cookie activa.
create or replace function public.cuenta_financiera_sistema(
  p_negocio_id uuid,
  p_codigo text
)
returns uuid
language sql
stable
security definer
set search_path = public, security, pg_temp
as $$
  select id
    from public.cuentas_financieras
   where negocio_id = p_negocio_id
     and codigo = p_codigo
     and es_sistema
     and activa
   limit 1;
$$;

revoke all on function public.cuenta_financiera_sistema(uuid, text)
  from public;

-- Referencias con FK compuesta: conocer un UUID de otro comercio nunca
-- permite colgarlo de una fila propia, incluso desde SECURITY DEFINER.
alter table public.turnos_caja
  add column cuenta_financiera_id uuid;
alter table public.turnos_caja
  add constraint turnos_caja_cuenta_financiera_fkey
  foreign key (negocio_id, cuenta_financiera_id)
  references public.cuentas_financieras (negocio_id, id) on delete restrict;

alter table public.egresos
  add column cuenta_origen_id uuid;
alter table public.egresos
  add constraint egresos_cuenta_origen_fkey
  foreign key (negocio_id, cuenta_origen_id)
  references public.cuentas_financieras (negocio_id, id) on delete restrict;

alter table public.metodos_pago
  add column cuenta_destino_id uuid;
alter table public.metodos_pago
  add constraint metodos_pago_cuenta_destino_fkey
  foreign key (negocio_id, cuenta_destino_id)
  references public.cuentas_financieras (negocio_id, id) on delete restrict;

-- Snapshot del destino elegido al cobrar. No se deriva en reportes desde el
-- metodo actual: si el metodo cambia de banco manana, el cobro de ayer no.
alter table public.venta_pagos
  add column cuenta_destino_id uuid;
alter table public.venta_pagos
  add constraint venta_pagos_cuenta_destino_fkey
  foreign key (negocio_id, cuenta_destino_id)
  references public.cuentas_financieras (negocio_id, id) on delete restrict;

comment on column public.turnos_caja.cuenta_financiera_id is
  'Cuenta de efectivo arqueada por el turno. Etapa 1: se completa con CAJA_DIARIA, pero los calculos actuales aun no la leen.';
comment on column public.egresos.cuenta_origen_id is
  'Cuenta desde la que salio el dinero. Etapa 1 conserva la semantica vigente: todo egreso existente sale de CAJA_DIARIA.';
comment on column public.metodos_pago.cuenta_destino_id is
  'Cuenta final donde acredita el medio. NULL significa pendiente de configurar; no es la cuenta puente POR_ACREDITAR.';
comment on column public.venta_pagos.cuenta_destino_id is
  'Snapshot de la cuenta final configurada al registrar el cobro. El dinero puede seguir en POR_ACREDITAR hasta su acreditacion.';

create index turnos_caja_cuenta_financiera_idx
  on public.turnos_caja (negocio_id, cuenta_financiera_id);
create index egresos_cuenta_origen_idx
  on public.egresos (negocio_id, cuenta_origen_id, fecha desc);
create index metodos_pago_cuenta_destino_idx
  on public.metodos_pago (negocio_id, cuenta_destino_id);
create index venta_pagos_cuenta_destino_idx
  on public.venta_pagos (negocio_id, cuenta_destino_id, creado_en desc);

-- Backfill fiel al comportamiento actual. Todo turno y egreso existente es
-- efectivo fisico porque hoy todos afectan el esperado del cajon. Solo los
-- pagos/metodos EFECTIVO reciben destino; para digitales no se inventa banco.
-- El guard de inmutabilidad bloquea TODO UPDATE sobre turnos cerrados, incluso
-- agregar metadata que ningun calculo actual lee. Se deshabilita solo durante
-- este backfill y se reactiva en la misma transaccion. Si algo falla, el
-- rollback tambien restaura el trigger habilitado.
alter table public.turnos_caja
  disable trigger trg_bloquear_edicion_turno_cerrado;

update public.turnos_caja t
   set cuenta_financiera_id = public.cuenta_financiera_sistema(
     t.negocio_id, 'CAJA_DIARIA'
   )
 where cuenta_financiera_id is null;

alter table public.turnos_caja
  enable trigger trg_bloquear_edicion_turno_cerrado;

update public.egresos e
   set cuenta_origen_id = public.cuenta_financiera_sistema(
     e.negocio_id, 'CAJA_DIARIA'
   )
 where cuenta_origen_id is null;

update public.metodos_pago m
   set cuenta_destino_id = public.cuenta_financiera_sistema(
     m.negocio_id, 'CAJA_DIARIA'
   )
 where m.cuenta_destino_id is null
   and m.tipo = 'EFECTIVO';

update public.venta_pagos p
   set cuenta_destino_id = public.cuenta_financiera_sistema(
     p.negocio_id, 'CAJA_DIARIA'
   )
 where p.cuenta_destino_id is null
   and p.metodo_tipo = 'EFECTIVO';

-- Estas dos relaciones no son opcionales en el modelo nuevo. El trigger de
-- INSERT mantiene compatibilidad con callers viejos que no envian la columna.
alter table public.turnos_caja
  alter column cuenta_financiera_id set not null;
alter table public.egresos
  alter column cuenta_origen_id set not null;

-- Mantiene las referencias para nuevas filas sin modificar ningun caller.
create or replace function public.asignar_cuenta_financiera_actual()
returns trigger
language plpgsql
security definer
set search_path = public, security, pg_temp
as $$
begin
  if tg_table_name = 'turnos_caja' then
    if new.cuenta_financiera_id is null then
      new.cuenta_financiera_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;
  elsif tg_table_name = 'egresos' then
    if new.cuenta_origen_id is null then
      new.cuenta_origen_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;
  elsif tg_table_name = 'metodos_pago' then
    if tg_op = 'UPDATE' and old.tipo is distinct from new.tipo then
      new.cuenta_destino_id := null;
    end if;

    if new.cuenta_destino_id is null and new.tipo = 'EFECTIVO' then
      new.cuenta_destino_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;
  elsif tg_table_name = 'venta_pagos' then
    -- Una correccion de medio debe recalcular el snapshot. Si conservara la
    -- cuenta anterior, corregir Efectivo a Debito seguiria moviendo Caja.
    if tg_op = 'UPDATE'
       and row(old.metodo_pago_id, old.metodo_tipo)
           is distinct from row(new.metodo_pago_id, new.metodo_tipo) then
      new.cuenta_destino_id := null;
    end if;

    if new.cuenta_destino_id is null and new.metodo_pago_id is not null then
      select m.cuenta_destino_id
        into new.cuenta_destino_id
        from public.metodos_pago m
       where m.id = new.metodo_pago_id
         and m.negocio_id = new.negocio_id;
    end if;

    if new.cuenta_destino_id is null and new.metodo_tipo = 'EFECTIVO' then
      new.cuenta_destino_id := public.cuenta_financiera_sistema(
        new.negocio_id, 'CAJA_DIARIA'
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.asignar_cuenta_financiera_actual()
  from public;

create trigger trg_turnos_caja_asignar_cuenta
  before insert on public.turnos_caja
  for each row execute function public.asignar_cuenta_financiera_actual();
create trigger trg_egresos_asignar_cuenta
  before insert on public.egresos
  for each row execute function public.asignar_cuenta_financiera_actual();
create trigger trg_metodos_pago_asignar_cuenta
  before insert or update of tipo on public.metodos_pago
  for each row execute function public.asignar_cuenta_financiera_actual();
create trigger trg_venta_pagos_asignar_cuenta
  before insert or update of metodo_pago_id, metodo_tipo on public.venta_pagos
  for each row execute function public.asignar_cuenta_financiera_actual();

-- Guardas: si alguna falla, toda la migracion vuelve atras.
do $$
declare
  v_error bigint;
begin
  select count(*) into v_error
    from public.negocios n
   where (select count(*) from public.cuentas_financieras c
           where c.negocio_id = n.id
             and c.codigo in ('CAJA_DIARIA', 'POR_ACREDITAR')) <> 2;
  if v_error <> 0 then
    raise exception 'Hay % negocios sin sus dos cuentas financieras de sistema.', v_error;
  end if;

  select count(*) into v_error from public.turnos_caja
   where cuenta_financiera_id is null;
  if v_error <> 0 then
    raise exception 'Quedaron % turnos sin CAJA_DIARIA.', v_error;
  end if;

  select count(*) into v_error from public.egresos
   where cuenta_origen_id is null;
  if v_error <> 0 then
    raise exception 'Quedaron % egresos sin cuenta de origen.', v_error;
  end if;

  select count(*) into v_error from public.venta_pagos
   where metodo_tipo = 'EFECTIVO' and cuenta_destino_id is null;
  if v_error <> 0 then
    raise exception 'Quedaron % pagos en efectivo sin CAJA_DIARIA.', v_error;
  end if;

  select count(*) into v_error
    from (
      select t.negocio_id, t.cuenta_financiera_id as cuenta_id
        from public.turnos_caja t
      union all
      select e.negocio_id, e.cuenta_origen_id from public.egresos e
      union all
      select m.negocio_id, m.cuenta_destino_id from public.metodos_pago m
      union all
      select p.negocio_id, p.cuenta_destino_id from public.venta_pagos p
    ) x
    join public.cuentas_financieras c on c.id = x.cuenta_id
   where x.cuenta_id is not null and c.negocio_id <> x.negocio_id;
  if v_error <> 0 then
    raise exception 'Hay % referencias financieras cruzadas entre negocios.', v_error;
  end if;
end;
$$;

commit;
