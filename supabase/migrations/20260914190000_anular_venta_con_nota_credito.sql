-- Anular una venta FACTURADA emite la nota de crédito.
--
-- Hasta acá `cancel-sale.ts` frenaba: "esta venta tiene factura, hacele la
-- nota de crédito en ARCA". Con la conexión hecha, la NC se pide a ARCA
-- (WSFEv1, mismo FECAESolicitar con CbtesAsoc apuntando a la factura) y se
-- registra junto con la anulación.
--
-- Este wrapper hace lo mismo que `registrar_venta_facturada` para la venta:
-- corre `anular_venta` (cuerpo vivo, intacto) y en LA MISMA transacción
-- inserta la NC en `comprobantes` con `anula_comprobante_id` apuntando a la
-- factura, más su desglose en `comprobantes_iva`. Si la anulación falla, la
-- NC no queda registrada — pero SÍ quedó emitida en ARCA, y eso el código lo
-- loguea con todo el detalle (ver cancel-sale.ts). Lo que no puede pasar es
-- una venta anulada sin su NC: la factura quedaría viva en ARCA contra una
-- venta que el sistema da por anulada.
--
-- SECURITY INVOKER: quién puede anular lo sigue decidiendo `anular_venta` y
-- la RLS del que llama.

create or replace function public.anular_venta_facturada(
  p_venta_id uuid,
  p_motivo text,
  p_turno_id uuid,
  p_motivo_codigo text,
  p_motivo_detalle text,
  p_comprobante jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_resultado jsonb;
  v_id        uuid;
  v_factura   uuid;
begin
  if p_comprobante is null
     or p_comprobante->>'tipo' not like 'NOTA_CREDITO%'
     or nullif(p_comprobante->>'cae', '') is null then
    raise exception 'NOTA_CREDITO_REQUERIDA';
  end if;

  v_factura := (p_comprobante->>'anula_comprobante_id')::uuid;

  -- La factura que se compensa tiene que ser de ESTA venta y estar visible
  -- (RLS). Una NC apuntando a otra venta sería un agujero contable.
  if not exists (
    select 1 from public.comprobantes c
     where c.id = v_factura
       and c.venta_id = p_venta_id
       and c.tipo like 'FACTURA%'
  ) then
    raise exception 'FACTURA_NO_CORRESPONDE';
  end if;

  v_resultado := public.anular_venta(
    p_venta_id, p_motivo, p_turno_id, p_motivo_codigo, p_motivo_detalle
  );

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    receptor_doc_tipo, receptor_doc_nro,
    neto, iva_monto, exento, no_gravado, total,
    cae, cae_vencimiento, fecha_comprobante,
    arca_ambiente, arca_resultado, arca_observaciones,
    anula_comprobante_id, emitido_por
  )
  select
    p_venta_id,
    p_comprobante->>'tipo',
    (p_comprobante->>'punto_venta')::integer,
    (p_comprobante->>'numero')::bigint,
    -- Receptor: copiado de la factura. La NC dice lo mismo que la factura.
    f.cliente_id, f.receptor_razon_social, f.receptor_cuit, f.receptor_condicion_iva,
    f.receptor_doc_tipo, f.receptor_doc_nro,
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
    v_factura,
    (p_comprobante->>'emitido_por')::uuid
  from public.comprobantes f
  where f.id = v_factura
  returning id into v_id;

  insert into public.comprobantes_iva (comprobante_id, alicuota_id, base_imponible, importe)
  select v_id,
         (x->>'id')::integer,
         (x->>'base_imponible')::numeric,
         (x->>'importe')::numeric
    from jsonb_array_elements(coalesce(p_comprobante->'iva', '[]'::jsonb)) as x;

  return v_resultado || jsonb_build_object('nota_credito_id', v_id);
end;
$function$;

comment on function public.anular_venta_facturada(uuid, text, uuid, text, text, jsonb) is
  'anular_venta + la nota de credito (CAE ya pedido a ARCA) apuntando a la factura via anula_comprobante_id, en UNA transaccion. SECURITY INVOKER. Wrapper: no reescribe anular_venta.';

grant execute on function public.anular_venta_facturada(uuid, text, uuid, text, text, jsonb) to authenticated;
