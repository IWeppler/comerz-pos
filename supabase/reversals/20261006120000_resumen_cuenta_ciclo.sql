-- Reversión de 20261006120000_resumen_cuenta_ciclo.sql: vuelve
-- resumen_cuenta_por_token al cuerpo vivo anterior (sin regla_vencimiento ni
-- movimientos[].vence_el). La página tolera que falten: sin regla no recorta.
CREATE OR REPLACE FUNCTION public.resumen_cuenta_por_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_tz       constant text := 'America/Argentina/Buenos_Aires';
  v_dias     constant int := 365;
  v_cliente  record;
  v_config   record;
  v_negocio  record;
  v_hoy      date;
  v_desde    date;
  v_out      jsonb;
begin
  if p_token is null or length(p_token) < 24 then
    return null;
  end if;

  select c.* into v_cliente
  from public.clientes c
  where c.resumen_token = p_token;

  if not found then
    return null;
  end if;

  v_hoy := (now() at time zone v_tz)::date;
  v_desde := v_hoy - v_dias;

  select n.nombre into v_negocio
  from public.negocios n
  where n.id = v_cliente.negocio_id;

  select cp."posName" as pos_name, cp.direccion, cp.whatsapp into v_config
  from public.configuracion_pos cp
  where cp.negocio_id = v_cliente.negocio_id
  limit 1;

  with base as (
    select
      coalesce(m.fecha_origen, (m.creado_en at time zone v_tz)::date) as fecha,
      m.creado_en,
      m.tipo,
      m.monto,
      m.descripcion
    from public.cuenta_corriente_movimientos m
    where m.cliente_id = v_cliente.id
      and m.anulado = false
  ),
  anterior as (
    select coalesce(
      sum(case when tipo = 'DEBITO' then monto else -monto end), 0
    ) as saldo
    from base
    where fecha < v_desde
  ),
  periodo as (
    select
      b.fecha,
      b.creado_en,
      b.tipo,
      b.monto,
      b.descripcion,
      (select saldo from anterior)
        + sum(case when b.tipo = 'DEBITO' then b.monto else -b.monto end)
          over (order by b.fecha, b.creado_en
                rows between unbounded preceding and current row) as saldo_corriente
    from base b
    where b.fecha >= v_desde
  )
  select jsonb_build_object(
    'comercio', jsonb_build_object(
      'nombre', coalesce(v_config.pos_name, v_negocio.nombre),
      'direccion', v_config.direccion,
      'whatsapp', v_config.whatsapp
    ),
    'cliente', jsonb_build_object(
      'nombre', v_cliente.nombre,
      'telefono', nullif(btrim(coalesce(v_cliente.telefono, '')), ''),
      'dni', nullif(btrim(coalesce(v_cliente.dni, '')), '')
    ),
    'desde', v_desde,
    'hasta', v_hoy,
    'emitido_en', now(),
    'saldo_anterior', round((select saldo from anterior), 2),
    'saldo_actual', round(coalesce(v_cliente.saldo_pendiente, 0), 2),
    'vence_el', v_cliente.fecha_vencimiento_deuda,
    'deudas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'debito_id', d.debito_id,
        'venta_id', d.venta_id,
        'comprobante_punto_venta', d.comprobante_punto_venta,
        'comprobante_numero', d.comprobante_numero,
        'fecha', d.fecha,
        'vence_el', d.vence_el,
        'descripcion', d.descripcion,
        'monto', round(d.monto, 2),
        'vivo', round(d.vivo, 2),
        'es_mora_huerfana', d.es_mora_huerfana
      ) order by d.vence_el, d.fecha, d.creado_en), '[]'::jsonb)
      from public.cc_deudas_vivas_detalle(v_cliente.id) d
      where d.vivo > 0
    ),
    'movimientos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'fecha', fecha,
        'concepto', coalesce(nullif(btrim(descripcion), ''),
                             case when tipo = 'DEBITO' then 'Compra' else 'Pago' end),
        'tipo', tipo,
        'monto', round(monto, 2),
        'saldo', round(saldo_corriente, 2)
      ) order by fecha, creado_en), '[]'::jsonb)
      from periodo
    )
  )
  into v_out;

  return v_out;
end;
$function$;
