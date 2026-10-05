-- ─────────────────────────────────────────────────────────────────────────────
-- Resumen de cuenta público (/r/<token>): la deuda viva por venta, con su
-- vencimiento.
--
-- Por qué (5/10/2026): Librería Colores, cliente EESO 405 POZO BORRADO. El
-- resumen decía "Total a pagar $276.450 — Vence el 10/10", pero el 10/10 vence
-- solo el saldo inicial ($98.850); el resto vence el 23/10 y el 1/11. Un solo
-- vencimiento para todo el saldo es `fecha_vencimiento_deuda` (el MÍNIMO), que
-- sirve para la mora pero no para decirle a la clienta qué paga cuándo.
--
-- `deudas` sale de `cc_deudas_vivas_detalle`, la misma función del detalle
-- del cliente, el modal de cobro y el recibo: la página agrupa por mes con
-- `agruparDeudaPorMes`, igual que adentro. La función es DEFINER (la lee
-- anon por token): `cc_deudas_vivas` filtra por el negocio del cliente.
-- Parche sobre el cuerpo VIVO.
-- Reversión: supabase/reversals/20261005130000_resumen_cuenta_deuda_por_venta.sql
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_def     text;
  v_ancla   constant text := '    ''vence_el'', v_cliente.fecha_vencimiento_deuda,';
  v_nuevo   constant text := '    ''vence_el'', v_cliente.fecha_vencimiento_deuda,
    ''deudas'', (
      select coalesce(jsonb_agg(jsonb_build_object(
        ''debito_id'', d.debito_id,
        ''venta_id'', d.venta_id,
        ''comprobante_punto_venta'', d.comprobante_punto_venta,
        ''comprobante_numero'', d.comprobante_numero,
        ''fecha'', d.fecha,
        ''vence_el'', d.vence_el,
        ''descripcion'', d.descripcion,
        ''monto'', round(d.monto, 2),
        ''vivo'', round(d.vivo, 2),
        ''es_mora_huerfana'', d.es_mora_huerfana
      ) order by d.vence_el, d.fecha, d.creado_en), ''[]''::jsonb)
      from public.cc_deudas_vivas_detalle(v_cliente.id) d
      where d.vivo > 0
    ),';
begin
  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure) into v_def;

  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'resumen_cuenta_por_token: vence_el no aparece exactamente 1 vez, el cuerpo vivo cambió';
  end if;
  if position('SECURITY DEFINER' in v_def) = 0
     or position('where c.resumen_token = p_token' in v_def) = 0
     or position('length(p_token) < 24' in v_def) = 0 then
    raise exception 'resumen_cuenta_por_token: falta el DEFINER o el filtro por token';
  end if;

  execute replace(v_def, v_ancla, v_nuevo);

  select pg_get_functiondef('public.resumen_cuenta_por_token(text)'::regprocedure) into v_def;
  if position('cc_deudas_vivas_detalle(v_cliente.id)' in v_def) = 0
     or position('SECURITY DEFINER' in v_def) = 0
     or position('where c.resumen_token = p_token' in v_def) = 0 then
    raise exception 'resumen_cuenta_por_token: el parche no quedó como se esperaba';
  end if;
end $$;

-- Guard: para todo cliente con token y deuda, lo vivo por venta suma el saldo.
do $$
declare
  v_descuadrados int;
begin
  select count(*) into v_descuadrados
    from public.clientes c
   cross join lateral (
     select public.resumen_cuenta_por_token(c.resumen_token) as r
   ) x
   where c.resumen_token is not null
     and c.saldo_pendiente > 0
     and abs(
       (select coalesce(sum((e->>'vivo')::numeric), 0)
          from jsonb_array_elements(x.r->'deudas') e)
       - c.saldo_pendiente) > 0.01;
  if v_descuadrados > 0 then
    raise exception 'resumen_cuenta_por_token: % clientes donde la deuda por venta no suma el saldo', v_descuadrados;
  end if;
end $$;
