-- La pestaña Movimientos muestra cuántos movimientos hay y cuánta plata suman,
-- respetando los filtros ("las transferencias del sábado: 23, $412.500").
--
-- La suma tiene que salir de la BASE y no de la pantalla: la tabla pagina, así
-- que sumar en el navegador sería sumar solo la página visible. Se calcula
-- sobre `agrupado` —lo mismo que cuenta `total`—, antes de paginar.
--
-- Tres números y no uno, porque los importes tienen signo: con "todos los
-- tipos" entran cobros y salen gastos, y una transferencia entre cuentas
-- propias son dos filas (+ y −) que se anulan. El neto solo no alcanza para
-- leer eso; entradas y salidas sí.
--
-- Aditivo: la respuesta suma `importe_total`, `importe_entradas` e
-- `importe_salidas`; nadie que no las lea cambia. Se parchea el cuerpo VIVO
-- (`pg_get_functiondef` + `replace`), no se reescribe desde un archivo, con
-- guard de que cada reemplazo matchea exactamente una vez.

do $$
declare
  v_def text;
  v_nuevo text;
  v_viejo_contado constant text :=
    'contado as (select a.*, count(*) over () as total from agrupado a)';
  v_nuevo_contado constant text :=
    'contado as (select a.*, count(*) over () as total, '
    || 'sum(a.importe) over () as importe_total, '
    || 'sum(a.importe) filter (where a.importe > 0) over () as importe_entradas, '
    || 'sum(a.importe) filter (where a.importe < 0) over () as importe_salidas '
    || 'from agrupado a)';
  v_viejo_json constant text :=
    'jsonb_build_object(''total'', coalesce(max(f.total), 0), ''filas'',';
  v_nuevo_json constant text :=
    'jsonb_build_object(''total'', coalesce(max(f.total), 0), '
    || '''importe_total'', coalesce(max(f.importe_total), 0), '
    || '''importe_entradas'', coalesce(max(f.importe_entradas), 0), '
    || '''importe_salidas'', coalesce(max(f.importe_salidas), 0), ''filas'',';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'movimientos_financieros_negocio'
     and p.pronamespace = 'public'::regnamespace;

  if v_def is null then
    raise exception 'movimientos_financieros_negocio no existe';
  end if;

  if (length(v_def) - length(replace(v_def, v_viejo_contado, ''))) / length(v_viejo_contado) <> 1 then
    raise exception 'El CTE contado no aparece exactamente una vez: el cuerpo vivo cambió';
  end if;
  if (length(v_def) - length(replace(v_def, v_viejo_json, ''))) / length(v_viejo_json) <> 1 then
    raise exception 'El jsonb_build_object de salida no aparece exactamente una vez: el cuerpo vivo cambió';
  end if;

  v_nuevo := replace(replace(v_def, v_viejo_contado, v_nuevo_contado), v_viejo_json, v_nuevo_json);
  execute v_nuevo;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.proname = 'movimientos_financieros_negocio'
     and p.pronamespace = 'public'::regnamespace;
  if position('importe_entradas' in v_def) = 0 or position('SECURITY DEFINER' in v_def) = 0
     or position('caja.ver_movimientos' in v_def) = 0 then
    raise exception 'El parche no quedó aplicado o se perdió el permiso';
  end if;
end $$;
