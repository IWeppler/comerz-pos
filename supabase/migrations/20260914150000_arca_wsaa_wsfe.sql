-- ---------------------------------------------------------------------------
-- Conexión con ARCA: WSAA + WSFEv1.
--
-- Hasta acá el terreno estaba preparado (comprobantes, numeración, matriz de
-- letras, CHECK de CAE) pero nada hablaba con ARCA. Esta migración agrega lo
-- que la conexión necesita en la base:
--
--   1. `arca_credenciales`: la clave privada (CIFRADA en el server, nunca en
--      claro), el CSR, el certificado y el cache del ticket de acceso, por
--      negocio Y por ambiente. Homologación y producción usan certificados
--      distintos, así que son dos filas.
--   2. `configuracion_pos.arca_ambiente`: contra cuál de los dos se emite.
--      Default HOMOLOGACION: un negocio que pone modo ARCA prueba primero, y
--      pasar a PRODUCCION es un acto explícito.
--   3. `comprobantes`: lo que una factura tiene y un ticket no — exento, no
--      gravado, fecha del comprobante, documento del receptor, ambiente y lo
--      que ARCA contestó. Más `comprobantes_iva`, el subtotal por alícuota:
--      una factura A con líneas al 21% y al 10,5% necesita los dos, y la
--      cabecera tiene UN neto y UN iva.
--   4. `registrar_venta_facturada`: la venta y su comprobante con CAE en la
--      MISMA transacción. El CAE se pide ANTES (es lo que exige el CHECK
--      `comprobantes_ticket_sin_cae_check`), y si la venta no se puede
--      grabar el CAE queda emitido en ARCA sin venta — eso se loguea y se
--      resuelve con nota de crédito; lo que NO puede pasar es una venta
--      grabada sin su factura, que es lo que este wrapper evita.
--
-- ADITIVA: ninguna venta cambia hasta que un negocio tenga modo ARCA +
-- credenciales cargadas. Los 4 negocios siguen en INTERNO.
-- ---------------------------------------------------------------------------

-- 1. Credenciales -----------------------------------------------------------

create table if not exists public.arca_credenciales (
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  ambiente text not null,

  -- AES-256-GCM con ARCA_CLAVE_CIFRADO, formato `v1:iv:tag:cifrado`
  -- (features/arca/lib/cifrado.ts). Un dump de esta tabla no firma nada.
  clave_privada_cifrada text not null,
  csr_pem text not null,

  -- NULL hasta que la persona pegue el .crt que le dio ARCA.
  certificado_pem text,
  certificado_vencimiento timestamptz,
  certificado_subject text,

  -- Cache del ticket de acceso de WSAA. Dura 12 h y NO se puede volver a
  -- pedir mientras está vigente (fault coe.alreadyAuthenticated), así que sin
  -- este cache la segunda venta de la mañana no podría facturar. Cifrado con
  -- la misma clave que la privada.
  ta_cifrado text,
  ta_expira_en timestamptz,

  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),

  primary key (negocio_id, ambiente),
  constraint arca_credenciales_ambiente_check
    check (ambiente in ('HOMOLOGACION', 'PRODUCCION'))
);

-- RLS prendida y SIN policies: ningún rol de la app la lee ni la escribe.
-- Solo el server con service_role (que saltea RLS) y después de chequear
-- `configuracion.facturacion`. La clave privada es lo que permite facturar
-- a nombre del comercio: no tiene por qué llegar a supabase-js del navegador,
-- ni siquiera cifrada.
alter table public.arca_credenciales enable row level security;
revoke all on public.arca_credenciales from anon, authenticated;

comment on table public.arca_credenciales is
  'Clave privada (cifrada), CSR, certificado y cache del TA de WSAA, por negocio y ambiente. SIN policies a proposito: solo la lee el server via service_role tras chequear configuracion.facturacion.';

-- 2. Ambiente activo ---------------------------------------------------------

alter table public.configuracion_pos
  add column if not exists arca_ambiente text not null default 'HOMOLOGACION';

alter table public.configuracion_pos
  drop constraint if exists configuracion_pos_arca_ambiente_check;
alter table public.configuracion_pos
  add constraint configuracion_pos_arca_ambiente_check
  check (arca_ambiente in ('HOMOLOGACION', 'PRODUCCION'));

comment on column public.configuracion_pos.arca_ambiente is
  'Contra que ARCA se emite: HOMOLOGACION (pruebas, CAE sin valor) o PRODUCCION. Solo importa con modo_facturacion = ARCA. Default homologacion a proposito.';

-- 3. Lo que una factura tiene y un ticket no --------------------------------

alter table public.comprobantes
  add column if not exists exento numeric(14, 2) not null default 0,
  add column if not exists no_gravado numeric(14, 2) not null default 0,
  -- CbteFch: el día fiscal del comprobante, en hora Argentina. `emitido_en`
  -- es el instante técnico y puede caer en otro día calendario.
  add column if not exists fecha_comprobante date,
  add column if not exists receptor_doc_tipo integer,
  add column if not exists receptor_doc_nro text,
  add column if not exists arca_ambiente text,
  add column if not exists arca_resultado text,
  -- Observaciones que ARCA devolvió aunque haya autorizado. Las va a querer
  -- ver el contador.
  add column if not exists arca_observaciones jsonb;

alter table public.comprobantes
  drop constraint if exists comprobantes_arca_ambiente_check;
alter table public.comprobantes
  add constraint comprobantes_arca_ambiente_check
  check (
    case
      when tipo = 'TICKET' then arca_ambiente is null
      else arca_ambiente in ('HOMOLOGACION', 'PRODUCCION')
    end
  );

alter table public.comprobantes
  drop constraint if exists comprobantes_importes_coherentes_check;
alter table public.comprobantes
  add constraint comprobantes_importes_coherentes_check
  check (neto >= 0 and iva_monto >= 0 and exento >= 0 and no_gravado >= 0 and total >= 0);

-- La numeración de homologación y la de producción son series DISTINTAS en
-- ARCA: la Factura B 0001-00000001 existe en las dos. El índice único viejo
-- las chocaba. TICKET (ambiente null) sigue siendo una sola serie.
drop index if exists public.comprobantes_numeracion_unica_idx;
create unique index if not exists comprobantes_numeracion_unica_idx
  on public.comprobantes (negocio_id, punto_venta, tipo, numero, coalesce(arca_ambiente, ''));

comment on column public.comprobantes.arca_ambiente is
  'HOMOLOGACION o PRODUCCION para lo fiscal, NULL para TICKET. Los de homologacion NO van al libro de IVA: son pruebas.';
comment on column public.comprobantes.fecha_comprobante is
  'CbteFch: dia fiscal en hora Argentina. emitido_en es el instante tecnico.';

create table if not exists public.comprobantes_iva (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null default security.current_negocio_id()
    references public.negocios(id),
  comprobante_id uuid not null references public.comprobantes(id) on delete restrict,
  -- Id de FEParamGetTiposIva: 4 = 10,5%, 5 = 21%, 6 = 27%.
  alicuota_id integer not null,
  base_imponible numeric(14, 2) not null,
  importe numeric(14, 2) not null,
  constraint comprobantes_iva_importes_check
    check (base_imponible >= 0 and importe >= 0)
);

create index if not exists comprobantes_iva_comprobante_idx
  on public.comprobantes_iva (comprobante_id);

alter table public.comprobantes_iva enable row level security;

drop policy if exists aislamiento_negocio on public.comprobantes_iva;
create policy aislamiento_negocio on public.comprobantes_iva
  as restrictive for all to authenticated
  using (negocio_id = (select security.current_negocio_id()))
  with check (negocio_id = (select security.current_negocio_id()));

drop policy if exists comprobantes_iva_select on public.comprobantes_iva;
create policy comprobantes_iva_select on public.comprobantes_iva
  for select to authenticated
  using (true);

-- El INSERT exige que el padre sea VISIBLE, misma forma que las hijas de
-- `ventas`: de que sea del negocio ya se encarga la RLS de `comprobantes`.
drop policy if exists comprobantes_iva_insert on public.comprobantes_iva;
create policy comprobantes_iva_insert on public.comprobantes_iva
  for insert to authenticated
  with check (
    exists (select 1 from public.comprobantes c where c.id = comprobante_id)
  );

-- Sin UPDATE ni DELETE: inmutable como su padre.

comment on table public.comprobantes_iva is
  'Subtotal por alicuota de un comprobante fiscal. INMUTABLE (sin policy de UPDATE/DELETE), como comprobantes.';

-- 4. Venta + factura en una transacción -------------------------------------

create or replace function public.registrar_venta_facturada(
  p_venta jsonb,
  p_pagos jsonb,
  p_items jsonb,
  p_stock_legacy jsonb,
  p_descuento jsonb,
  p_cc jsonb,
  p_reserva_ids uuid[],
  p_comprobante jsonb
)
returns jsonb
language plpgsql
-- SECURITY INVOKER (sin cláusula): el aislamiento sigue siendo la RLS del que
-- vende, igual que `registrar_venta`. Un wrapper y no una reescritura de esa
-- función: su cuerpo vivo no se toca, así que no se puede perder nada.
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_resultado jsonb;
  v_venta_id  uuid;
  v_id        uuid;
begin
  v_resultado := public.registrar_venta(
    p_venta, p_pagos, p_items, p_stock_legacy, p_descuento, p_cc, p_reserva_ids
  );

  -- Reintento de una venta que ya quedó: su comprobante también. No se
  -- inserta nada más.
  if coalesce((v_resultado->>'ya_registrada')::boolean, false) then
    return v_resultado;
  end if;

  if p_comprobante is null then
    raise exception 'COMPROBANTE_REQUERIDO';
  end if;
  if p_comprobante->>'tipo' = 'TICKET' or nullif(p_comprobante->>'cae', '') is null then
    -- El CHECK de la tabla lo frenaría igual; el nombre lo hace legible.
    raise exception 'COMPROBANTE_SIN_CAE';
  end if;

  v_venta_id := (v_resultado->>'venta_id')::uuid;

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    receptor_doc_tipo, receptor_doc_nro,
    neto, iva_monto, exento, no_gravado, total,
    cae, cae_vencimiento, fecha_comprobante,
    arca_ambiente, arca_resultado, arca_observaciones,
    emitido_por
  ) values (
    v_venta_id,
    p_comprobante->>'tipo',
    (p_comprobante->>'punto_venta')::integer,
    (p_comprobante->>'numero')::bigint,
    nullif(p_comprobante->>'cliente_id', '')::uuid,
    nullif(p_comprobante->>'receptor_razon_social', ''),
    nullif(p_comprobante->>'receptor_cuit', ''),
    nullif(p_comprobante->>'receptor_condicion_iva', ''),
    (p_comprobante->>'receptor_doc_tipo')::integer,
    p_comprobante->>'receptor_doc_nro',
    (p_comprobante->>'neto')::numeric,
    (p_comprobante->>'iva_monto')::numeric,
    coalesce((p_comprobante->>'exento')::numeric, 0),
    coalesce((p_comprobante->>'no_gravado')::numeric, 0),
    (p_comprobante->>'total')::numeric,
    p_comprobante->>'cae',
    (p_comprobante->>'cae_vencimiento')::date,
    (p_comprobante->>'fecha_comprobante')::date,
    p_comprobante->>'arca_ambiente',
    p_comprobante->>'arca_resultado',
    p_comprobante->'arca_observaciones',
    (p_comprobante->>'emitido_por')::uuid
  )
  returning id into v_id;

  insert into public.comprobantes_iva (comprobante_id, alicuota_id, base_imponible, importe)
  select v_id,
         (x->>'id')::integer,
         (x->>'base_imponible')::numeric,
         (x->>'importe')::numeric
    from jsonb_array_elements(coalesce(p_comprobante->'iva', '[]'::jsonb)) as x;

  return v_resultado || jsonb_build_object('comprobante_id', v_id);
end;
$function$;

comment on function public.registrar_venta_facturada(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], jsonb) is
  'registrar_venta + la fila de comprobantes (con CAE ya pedido a ARCA) + comprobantes_iva, en UNA transaccion. SECURITY INVOKER a proposito. Wrapper: no reescribe registrar_venta.';

grant execute on function public.registrar_venta_facturada(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid[], jsonb) to authenticated;

-- GUARD: la tabla de credenciales quedó SIN policies. Si alguien le agrega
-- una "para que el panel la lea", la clave privada cifrada llega al
-- navegador. Falla acá antes que en producción.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'arca_credenciales'
  ) then
    raise exception 'arca_credenciales no puede tener policies: se lee solo por service_role.';
  end if;
end;
$$;
