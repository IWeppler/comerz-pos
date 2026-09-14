-- Facturar DESPUÉS: una venta que salió con ticket interno recibe su factura.
--
-- Es el flujo real de "decido después": la clienta vuelve al rato y pide
-- factura, o la vendedora eligió ticket y la dueña quiere facturarla. El CAE
-- se pide a ARCA desde `facturarVentaAction` y acá se registra.
--
-- Guardas que importan:
--   * Solo ventas CONFIRMADAS. Una anulada no se factura: ya no existe.
--   * UNA factura por venta. `select ... for update` sobre la venta
--     serializa dos clicks a la vez, y el `exists` rechaza el segundo con
--     `VENTA_YA_FACTURADA`. Sin esto, doble click = dos CAE para la misma
--     venta, que es justo lo que ARCA no permite deshacer.
--   * SECURITY INVOKER: la venta tiene que ser VISIBLE para quien llama.
--
-- El TICKET interno que ya tenía la venta queda: es historia, y el papel que
-- salió en el mostrador existió. La factura es un comprobante MÁS de la
-- misma venta, que es exactamente para lo que `comprobantes` es una tabla
-- aparte.

create or replace function public.registrar_factura_de_venta(
  p_venta_id uuid,
  p_comprobante jsonb
)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_estado text;
  v_id     uuid;
begin
  if p_comprobante is null
     or p_comprobante->>'tipo' not like 'FACTURA%'
     or nullif(p_comprobante->>'cae', '') is null then
    raise exception 'FACTURA_REQUERIDA';
  end if;

  select estado_operacion into v_estado
    from public.ventas
   where id = p_venta_id
   for update;

  if v_estado is null then
    raise exception 'VENTA_NO_ENCONTRADA';
  end if;
  if v_estado <> 'CONFIRMADA' then
    raise exception 'VENTA_NO_FACTURABLE';
  end if;
  if exists (
    select 1 from public.comprobantes c
     where c.venta_id = p_venta_id
       and c.tipo like 'FACTURA%'
       and c.cae is not null
  ) then
    raise exception 'VENTA_YA_FACTURADA';
  end if;

  insert into public.comprobantes (
    venta_id, tipo, punto_venta, numero,
    cliente_id, receptor_razon_social, receptor_cuit, receptor_condicion_iva,
    receptor_doc_tipo, receptor_doc_nro,
    neto, iva_monto, exento, no_gravado, total,
    cae, cae_vencimiento, fecha_comprobante,
    arca_ambiente, arca_resultado, arca_observaciones,
    emitido_por
  ) values (
    p_venta_id,
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

  return v_id;
end;
$function$;

comment on function public.registrar_factura_de_venta(uuid, jsonb) is
  'Registra la factura (CAE ya pedido a ARCA) de una venta CONFIRMADA que salio con ticket. Una por venta: row lock sobre la venta + VENTA_YA_FACTURADA. SECURITY INVOKER.';

grant execute on function public.registrar_factura_de_venta(uuid, jsonb) to authenticated;
