-- Librería Colores: el cierre es el día 1, no el 5.
--
-- 20261005140000 cargó cierre 5 / vencimiento 15 entendiendo que el 5 era el
-- cierre. Lo que la dueña pidió (aclarado el 5/10/2026): lo comprado durante
-- TODO el mes (del 1 al último día) se avisa alrededor del 5 y se paga entre
-- ese día y el 15 del mes siguiente. El 5 es cuándo se avisa, no cuándo cierra.
--
-- Con cierre 5, lo comprado del 1 al 4 de un mes caía en el ciclo anterior:
-- NATI CORDOBA tenía $14.800 del 4/9 "vencidos el 15/9" cuando vencen el 15/10.
-- Medido antes de aplicar: 91 deudas de 59 clientes cambian de vencimiento;
-- los clientes vencidos al 5/10 pasan de 54 a 37 ($2.414.095 -> $1.901.855).
--
-- El trigger `trg_recachear_vencimientos_por_plazo` re-cachea
-- `clientes.fecha_vencimiento_deuda` del comercio.

do $$
declare
  v_negocio constant uuid := '27b693c8-44f5-49c2-b3df-66d00be6719a';
  v_filas int;
  v_desfasados int;
begin
  update public.configuracion_pos
     set cc_dia_cierre = 1
   where negocio_id = v_negocio
     and cc_vencimiento_modo = 'CIERRE_MENSUAL'
     and cc_dia_cierre = 5
     and cc_dia_vencimiento = 15;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'Colores: se esperaba 1 fila con cierre 5 / vence 15, hubo %', v_filas;
  end if;

  select count(*) into v_desfasados
    from public.clientes c
   where c.negocio_id = v_negocio
     and c.fecha_vencimiento_deuda
         is distinct from public.recalcular_vencimiento_cc(c.id);
  if v_desfasados > 0 then
    raise exception 'Colores: % clientes con el vencimiento desfasado después del re-cacheo', v_desfasados;
  end if;

  -- La regla nueva: todo septiembre vence el 15/10; el 1/10 ya es de noviembre.
  if public.cc_vence_el('2026-09-01', 'CIERRE_MENSUAL', 32, 1, 15) <> '2026-10-15'
     or public.cc_vence_el('2026-09-30', 'CIERRE_MENSUAL', 32, 1, 15) <> '2026-10-15'
     or public.cc_vence_el('2026-10-01', 'CIERRE_MENSUAL', 32, 1, 15) <> '2026-11-15' then
    raise exception 'cc_vence_el no da el ciclo mensual esperado con cierre 1';
  end if;
end $$;
