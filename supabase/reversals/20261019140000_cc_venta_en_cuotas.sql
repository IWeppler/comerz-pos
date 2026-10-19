-- Reversión de 20261019140000_cc_venta_en_cuotas.sql. A mano, nunca en
-- migrations/.
--
-- Frena si ya hay ventas en cuotas: borrar las columnas les sacaría el
-- vencimiento propio y las cuotas pasarían a vencer todas a los 30 días de la
-- compra. En ese caso hay que decidir qué hacer con esas deudas antes.
--
-- Las funciones se revierten con el reemplazo inverso sobre el cuerpo VIVO.
-- La corrección UTC → día comercial de registrar_venta NO se revierte: era un
-- bug.

do $$
declare
  v_def text;
  v_n int;
  v_anclas text[][];
  i int;
begin
  if exists (select 1 from public.cuenta_corriente_movimientos
              where cuota_numero is not null) then
    raise exception 'Hay ventas en cuotas: decidir qué pasa con esas deudas antes de revertir';
  end if;

  v_def := pg_get_functiondef(
    'public.registrar_venta(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid[])'::regprocedure);
  v_anclas := array[
    [E'         and nullif(p_cc->>''cuotas'', '''') is null\n         and not coalesce(public.tiene_permiso(''ventas.fiar_sin_recargo''), false) then',
     E'         and not coalesce(public.tiene_permiso(''ventas.fiar_sin_recargo''), false) then'],
    [E'      if nullif(p_cc->>''cuotas'', '''') is null then\n        insert into public.cuenta_corriente_movimientos (\n          negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n          monto_recargo, recargo_porcentaje\n        )\n        values (\n          v_negocio, v_cliente, v_venta_id, ''DEBITO'', v_pendiente,\n          p_cc->>''descripcion'', v_vendedor,\n          v_recargo_cc,\n          (p_venta->>''recargo_cc_porcentaje'')::numeric\n        );\n      else\n        -- Venta en cuotas (20261019140000): N tickets con su vencimiento.\n        -- La venta vence con la primera cuota.\n        v_vencimiento := public.cc_registrar_cuotas_venta(\n          v_negocio, v_cliente, v_venta_id, v_vendedor, v_pendiente,\n          v_recargo_cc, (p_venta->>''recargo_cc_porcentaje'')::numeric,\n          (p_cc->>''cuotas'')::int, p_cc->>''descripcion'',\n          (v_fecha_venta at time zone ''America/Argentina/Buenos_Aires'')::date,\n          coalesce((p_venta->>''registrada_offline'')::boolean, false)\n        );\n      end if;',
     E'      insert into public.cuenta_corriente_movimientos (\n        negocio_id, cliente_id, venta_id, tipo, monto, descripcion, creado_por,\n        monto_recargo, recargo_porcentaje\n      )\n      values (\n        v_negocio, v_cliente, v_venta_id, ''DEBITO'', v_pendiente,\n        p_cc->>''descripcion'', v_vendedor,\n        v_recargo_cc,\n        (p_venta->>''recargo_cc_porcentaje'')::numeric\n      );']
  ];
  for i in 1..array_length(v_anclas, 1) loop
    v_n := (length(v_def) - length(replace(v_def, v_anclas[i][1], ''))) / length(v_anclas[i][1]);
    if v_n <> 1 then
      raise exception 'Guard: ancla % de registrar_venta matchea % veces', i, v_n;
    end if;
    v_def := replace(v_def, v_anclas[i][1], v_anclas[i][2]);
  end loop;
  execute v_def;

  v_def := pg_get_functiondef('public.cc_deudas_vivas(uuid,uuid)'::regprocedure);
  v_anclas := array[
    [E'           false as es_mora_huerfana,\n           coalesce(t.vence_el, public.cc_vence_el(t.dia, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento)) as vence,\n           coalesce(t.vence_el, public.cc_vence_el(t.dia, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento)) as orden\n      from tickets t\n      cross join cliente cl\n      left join mora_por_ticket mt on mt.ticket_id = t.id',
     E'           false as es_mora_huerfana\n      from tickets t\n      left join mora_por_ticket mt on mt.ticket_id = t.id'],
    [E'           m.monto, m.monto, true, m.dia,\n           public.cc_vence_el(m.dia, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento)\n      from movs m\n      cross join cliente cl',
     E'           m.monto, m.monto, true\n      from movs m'],
    [E'             order by u.orden, u.fecha, u.creado_en, u.id',
     E'             order by u.fecha, u.creado_en, u.id'],
    [E'         o.vence,',
     E'         case when o.es_mora_huerfana then o.fecha\n              else public.cc_vence_el(o.fecha, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento) end,'],
    [E'   order by o.orden, o.fecha, o.creado_en, o.id;',
     E'   order by o.fecha, o.creado_en, o.id;']
  ];
  for i in 1..array_length(v_anclas, 1) loop
    v_n := (length(v_def) - length(replace(v_def, v_anclas[i][1], ''))) / length(v_anclas[i][1]);
    if v_n <> 1 then
      raise exception 'Guard: ancla % de cc_deudas_vivas matchea % veces', i, v_n;
    end if;
    v_def := replace(v_def, v_anclas[i][1], v_anclas[i][2]);
  end loop;
  execute v_def;

  v_def := pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure);
  v_n := (length(v_def) - length(replace(v_def,
    'array_agg(m.debito_id order by m.vence_el, m.fecha, m.creado_en, m.debito_id)', '')))
    / length('array_agg(m.debito_id order by m.vence_el, m.fecha, m.creado_en, m.debito_id)');
  if v_n <> 1 then
    raise exception 'Guard: ancla de deuda_cc_vencida matchea % veces', v_n;
  end if;
  execute replace(v_def,
    'array_agg(m.debito_id order by m.vence_el, m.fecha, m.creado_en, m.debito_id)',
    'array_agg(m.debito_id order by m.fecha, m.creado_en, m.debito_id)');
end $$;

drop function public.cc_registrar_cuotas_venta(
  uuid, uuid, uuid, uuid, numeric, numeric, numeric, integer, text, date, boolean);
drop trigger trg_cc_mov_cuota_inmutable on public.cuenta_corriente_movimientos;
drop function public.cc_mov_cuota_inmutable();
alter table public.cuenta_corriente_movimientos
  drop constraint cc_mov_cuota_coherente,
  drop constraint cc_mov_vence_el_solo_en_ticket,
  drop column cuotas_total,
  drop column cuota_numero,
  drop column vence_el;
