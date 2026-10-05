-- Reversión de 20261005140000_cc_vencimiento_cierre_mensual.sql. Correr a mano.
-- Antes: revertir el código que lee cc_vencimiento_modo / cc_dia_*.
-- Colores vuelve a DIAS con su plazo (32): avisarle a la dueña.

-- Solo se re-cachean los comercios que estuvieron en cierre mensual: los demás
-- tienen vencimientos desfasados viejos que se deciden con cada dueña.
create temp table _en_cierre as
  select negocio_id from public.configuracion_pos
   where cc_vencimiento_modo <> 'DIAS';

update public.configuracion_pos
   set cc_vencimiento_modo = 'DIAS'
 where cc_vencimiento_modo <> 'DIAS';

do $$
declare
  v_def text;
begin
  -- cc_deudas_vivas
  select pg_get_functiondef('public.cc_deudas_vivas(uuid, uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, '    select c.negocio_id, coalesce(cp.cc_plazo_mora, 30) as dias,
           cp.cc_vencimiento_modo as modo,
           cp.cc_dia_cierre as dia_cierre,
           cp.cc_dia_vencimiento as dia_vencimiento
', '    select c.negocio_id, coalesce(cp.cc_plazo_mora, 30) as dias
');
  v_def := replace(v_def, 'case when o.es_mora_huerfana then o.fecha
              else public.cc_vence_el(o.fecha, cl.modo, cl.dias, cl.dia_cierre, cl.dia_vencimiento) end',
    'case when o.es_mora_huerfana then o.fecha else o.fecha + cl.dias end');
  if position('cc_vence_el' in v_def) > 0 then
    raise exception 'cc_deudas_vivas: no se pudo revertir';
  end if;
  execute v_def;

  -- deuda_cc_vencida
  select pg_get_functiondef('public.deuda_cc_vencida(uuid)'::regprocedure) into v_def;
  v_def := replace(v_def, '    select c.id as cliente_id, coalesce(cp.cc_plazo_mora, 30) as dias,
           cp.cc_vencimiento_modo as modo,
           cp.cc_dia_cierre as dia_cierre,
           cp.cc_dia_vencimiento as dia_vencimiento
', '    select c.id as cliente_id, coalesce(cp.cc_plazo_mora, 30) as dias
');
  v_def := replace(v_def, '      pl.dias,
      public.cc_vence_el(d.fecha, pl.modo, pl.dias, pl.dia_cierre, pl.dia_vencimiento) as vence_el
    from debitos d', '      pl.dias
    from debitos d');
  v_def := replace(v_def, 'v.vence_el', 'v.fecha + v.dias');
  if position('cc_vence_el' in v_def) > 0 then
    raise exception 'deuda_cc_vencida: no se pudo revertir';
  end if;
  execute v_def;

  -- registrar_venta
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.proname = 'registrar_venta' and p.pronamespace = 'public'::regnamespace;
  v_def := replace(v_def, '      v_vencimiento := public.cc_vence_el_negocio(
                         v_negocio, (v_fecha_venta at time zone ''UTC'')::date);',
    '      v_vencimiento := (v_fecha_venta at time zone ''UTC'')::date
                       + coalesce((p_cc->>''plazo_mora'')::int, 30);');
  if position('cc_vence_el' in v_def) > 0 then
    raise exception 'registrar_venta: no se pudo revertir';
  end if;
  execute v_def;
end $$;

drop trigger trg_recachear_vencimientos_por_plazo on public.configuracion_pos;
create trigger trg_recachear_vencimientos_por_plazo
  after update of cc_plazo_mora on public.configuracion_pos
  for each row
  when (old.cc_plazo_mora is distinct from new.cc_plazo_mora)
  execute function public.recachear_vencimientos_por_plazo();

drop function public.cc_vence_el_negocio(uuid, date);
drop function public.cc_vence_el(date, text, integer, integer, integer);

alter table public.configuracion_pos
  drop constraint configuracion_pos_cc_cierre_requiere_dia_check,
  drop column cc_dia_vencimiento,
  drop column cc_dia_cierre,
  drop column cc_vencimiento_modo;

-- Re-cachear los vencimientos de quien estuvo en cierre mensual.
update public.clientes c
   set fecha_vencimiento_deuda = public.recalcular_vencimiento_cc(c.id)
 where c.negocio_id in (select negocio_id from _en_cierre)
   and c.fecha_vencimiento_deuda is distinct from public.recalcular_vencimiento_cc(c.id);
