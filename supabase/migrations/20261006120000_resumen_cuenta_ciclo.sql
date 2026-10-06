-- Resumen de cuenta por WhatsApp (/r/<token>) recortado al ciclo de cobro en
-- comercios con CIERRE MENSUAL (pedido del 6/10/2026 para Librería Colores).
--
-- La página necesita dos datos que la RPC no devolvía:
--   * `regla_vencimiento`: modo, plazo, cierre y vencimiento del comercio, para
--     calcular el ciclo vigente con `cicloVigente` (TS, la misma que usan los
--     avisos) y cortar ahí.
--   * `movimientos[].vence_el`: cuándo vence cada CARGO, para sacar del resumen
--     lo comprado después del cierre (vence el mes que viene). Sale de
--     `cc_deudas_vivas`, la misma regla que el cobro y la mora: un ticket tiene
--     su vencimiento; una mora pegada a un ticket, el de su ticket; una mora
--     huérfana, su propio día. Los pagos van con null.
--
-- Aditivo: el JSON suma dos claves y nada más cambia. Se reescribe desde el
-- cuerpo VIVO con replace() y guards (cada reemplazo matchea una sola vez y lo
-- crítico sigue ahí).
-- Reversión: supabase/reversals/20261006120000_resumen_cuenta_ciclo.sql

do $mig$
declare
  v_def text;
  v_reemplazos text[][] := array[
    -- 1. La config del comercio trae la regla de vencimiento.
    [
      'select cp."posName" as pos_name, cp.direccion, cp.whatsapp into v_config',
      'select cp."posName" as pos_name, cp.direccion, cp.whatsapp,
         cp.cc_vencimiento_modo, cp.cc_plazo_mora, cp.cc_dia_cierre,
         cp.cc_dia_vencimiento
    into v_config'
    ],
    -- 2. Los movimientos traen su id y el ticket de origen (para la mora).
    [
      E'      m.creado_en,\n      m.tipo,\n      m.monto,\n      m.descripcion\n    from public.cuenta_corriente_movimientos m',
      E'      m.creado_en,\n      m.tipo,\n      m.monto,\n      m.descripcion,\n      m.id,\n      m.debito_origen_id\n    from public.cuenta_corriente_movimientos m'
    ],
    [
      E'      b.descripcion,\n      (select saldo from anterior)',
      E'      b.descripcion,\n      b.id,\n      b.debito_origen_id,\n      (select saldo from anterior)'
    ],
    -- 3. El vencimiento de cada unidad de deuda, de la regla única.
    [
      '  periodo as (',
      E'  vences as (\n    select d.debito_id, d.vence_el\n    from public.cc_deudas_vivas(v_cliente.id) d\n  ),\n  periodo as ('
    ],
    -- 4. Salida: la regla y el vencimiento de cada cargo.
    [
      E'    ''vence_el'', v_cliente.fecha_vencimiento_deuda,\n',
      E'    ''vence_el'', v_cliente.fecha_vencimiento_deuda,\n    ''regla_vencimiento'', jsonb_build_object(\n      ''modo'', v_config.cc_vencimiento_modo,\n      ''plazo_dias'', v_config.cc_plazo_mora,\n      ''dia_cierre'', v_config.cc_dia_cierre,\n      ''dia_vencimiento'', v_config.cc_dia_vencimiento\n    ),\n'
    ],
    [
      E'        ''saldo'', round(saldo_corriente, 2)\n',
      E'        ''saldo'', round(saldo_corriente, 2),\n        ''vence_el'', case when tipo = ''DEBITO'' then (\n          select v.vence_el\n          from vences v\n          where v.debito_id in (periodo.id, periodo.debito_origen_id)\n          order by (v.debito_id = periodo.id) desc\n          limit 1\n        ) end\n'
    ]
  ];
  v_viejo text;
  v_nuevo text;
  v_veces int;
  i int;
  v_out jsonb;
  v_token text;
begin
  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure)
    into v_def;

  if v_def like '%regla_vencimiento%' then
    raise exception 'resumen_cuenta_por_token ya tiene regla_vencimiento: ¿se corrió dos veces?';
  end if;

  for i in 1 .. array_length(v_reemplazos, 1) loop
    v_viejo := v_reemplazos[i][1];
    v_nuevo := v_reemplazos[i][2];
    v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    if v_veces <> 1 then
      raise exception 'Reemplazo % matchea % veces (se esperaba 1): %', i, v_veces, v_viejo;
    end if;
    v_def := replace(v_def, v_viejo, v_nuevo);
  end loop;

  execute v_def;

  -- Lo crítico sigue ahí.
  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure)
    into v_def;
  if v_def not like '%SECURITY DEFINER%'
     or v_def not like '%where c.resumen_token = p_token%'
     or v_def not like '%length(p_token) < 24%'
     or v_def not like '%m.anulado = false%' then
    raise exception 'resumen_cuenta_por_token perdió una salvaguarda';
  end if;
  if (select count(*) from pg_proc where proname = 'resumen_cuenta_por_token') <> 1 then
    raise exception 'resumen_cuenta_por_token quedó con sobrecargas';
  end if;
  if not has_function_privilege('anon', 'public.resumen_cuenta_por_token(text)', 'execute') then
    raise exception 'anon perdió EXECUTE sobre resumen_cuenta_por_token';
  end if;

  -- Prueba con un cliente real con deuda: los totales no cambian y cada cargo
  -- trae vencimiento.
  select c.resumen_token into v_token
    from public.clientes c
   where c.resumen_token is not null and c.saldo_pendiente > 0
   limit 1;
  if v_token is not null then
    v_out := public.resumen_cuenta_por_token(v_token);
    if v_out -> 'regla_vencimiento' is null then
      raise exception 'Falta regla_vencimiento en la salida';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_out -> 'movimientos') m
       where m ->> 'tipo' = 'DEBITO'
    ) and not exists (
      select 1 from jsonb_array_elements(v_out -> 'movimientos') m
       where m ->> 'tipo' = 'DEBITO' and m ->> 'vence_el' is not null
    ) then
      raise exception 'Ningún cargo del resumen de prueba trae vence_el';
    end if;
  end if;
end
$mig$;
