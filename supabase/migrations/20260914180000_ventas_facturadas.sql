-- Cuánto se facturó y cuánto no.
--
-- Con la elección de comprobante por venta, la pregunta obvia de la dueña
-- es "¿qué parte de lo que vendí este mes está facturado?". El dato ya
-- estaba —cada venta tiene o no una fila FACTURA_* con CAE en
-- `comprobantes`— pero ninguna pantalla lo sumaba.
--
-- Tres cajones, no dos: FACTURADO (CAE de producción), SIN FACTURAR (ticket
-- interno) y PRUEBA (CAE de homologación). El tercero existe para que un
-- comercio que está probando no vea "facturado" lo que no tiene valor
-- fiscal, y para que no se mezcle con lo sin facturar. Cuando pase a
-- producción va a quedar en cero solo.
--
-- Va por `ventas.total` y `fecha_venta` (día en hora Argentina), ventas
-- CONFIRMADAS. Las anuladas quedan afuera: una venta anulada con factura
-- necesita nota de crédito, que es otro tema y otra señal.
--
-- Gateada por `caja.ver_gerencial`, SECURITY DEFINER con el negocio
-- filtrado a mano en cada consulta, misma forma que `posicion_dinero`.

create or replace function public.ventas_facturadas(p_periodo text default 'mes')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz      constant text := 'America/Argentina/Buenos_Aires';
  v_negocio uuid;
  v_hoy     date;
  v_desde   date;
  v_out     jsonb;
begin
  if not public.tiene_permiso('caja.ver_gerencial') then
    raise exception 'No tenés permiso para ver esta vista'
      using errcode = '42501';
  end if;

  v_negocio := security.current_negocio_id();
  if v_negocio is null then
    raise exception 'No hay un negocio activo' using errcode = '42501';
  end if;

  v_hoy := (now() at time zone v_tz)::date;
  v_desde := case p_periodo
    when 'hoy'    then v_hoy
    when 'semana' then (date_trunc('week',  v_hoy)::date)
    when 'mes'    then (date_trunc('month', v_hoy)::date)
    when 'anio'   then (date_trunc('year',  v_hoy)::date)
    else v_hoy
  end;

  with ventas_periodo as (
    select v.id, v.total
      from public.ventas v
     where v.negocio_id = v_negocio
       and v.estado_operacion = 'CONFIRMADA'
       and (v.fecha_venta at time zone v_tz)::date between v_desde and v_hoy
  ),
  clasificadas as (
    select vp.id,
           vp.total,
           c.tipo,
           case
             when c.id is null then 'SIN_FACTURAR'
             when c.arca_ambiente = 'PRODUCCION' then 'FACTURADO'
             else 'PRUEBA'
           end as cajon
      from ventas_periodo vp
      left join lateral (
        select c.id, c.tipo, c.arca_ambiente
          from public.comprobantes c
         where c.negocio_id = v_negocio
           and c.venta_id = vp.id
           and c.tipo like 'FACTURA%'
           and c.cae is not null
         order by c.emitido_en
         limit 1
      ) c on true
  )
  select jsonb_build_object(
    'desde', v_desde,
    'hasta', v_hoy,
    'periodo', p_periodo,
    'facturado', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas where cajon = 'FACTURADO'),
      'total',    (select coalesce(sum(total), 0) from clasificadas where cajon = 'FACTURADO'),
      'por_tipo', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'tipo', tipo, 'cantidad', cantidad, 'total', total
        ) order by total desc), '[]'::jsonb)
        from (
          select tipo, count(*) as cantidad, sum(total) as total
            from clasificadas where cajon = 'FACTURADO'
           group by tipo
        ) t
      )
    ),
    'sin_facturar', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas where cajon = 'SIN_FACTURAR'),
      'total',    (select coalesce(sum(total), 0) from clasificadas where cajon = 'SIN_FACTURAR')
    ),
    'prueba', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas where cajon = 'PRUEBA'),
      'total',    (select coalesce(sum(total), 0) from clasificadas where cajon = 'PRUEBA')
    ),
    'total', jsonb_build_object(
      'cantidad', (select count(*) from clasificadas),
      'total',    (select coalesce(sum(total), 0) from clasificadas)
    )
  )
  into v_out;

  return v_out;
end;
$function$;

comment on function public.ventas_facturadas(text) is
  'Ventas CONFIRMADAS del periodo partidas en FACTURADO (CAE de produccion), SIN_FACTURAR (ticket interno) y PRUEBA (CAE de homologacion). Gateada por caja.ver_gerencial. SECURITY DEFINER con negocio_id filtrado a mano.';

grant execute on function public.ventas_facturadas(text) to authenticated;

-- GUARD: DEFINER apaga la RLS, así que el negocio tiene que estar filtrado
-- a mano en CADA consulta a `ventas` y `comprobantes`.
do $$
declare
  v_def   text;
  v_veces integer;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ventas_facturadas';
  v_veces := (length(v_def) - length(replace(v_def, 'negocio_id = v_negocio', ''))) / length('negocio_id = v_negocio');
  if v_veces < 2 then
    raise exception 'ventas_facturadas: faltan filtros por negocio (% de 2)', v_veces;
  end if;
end;
$$;
