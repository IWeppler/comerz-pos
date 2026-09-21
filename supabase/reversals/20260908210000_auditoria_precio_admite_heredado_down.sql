-- Revierte 20260908210000. Se puede, pero SOLO mientras no haya ninguna fila
-- que use lo que la migración habilitó.
--
-- Volver a poner NOT NULL con default 0 sobre columnas que ya tienen NULL
-- exige elegir qué escribir en su lugar, y la única opción sería 0 — que es
-- exactamente la ambigüedad que la migración vino a sacar: 0 significa "vale
-- cero" y deshacer un ajuste con ese 0 le pone precio cero a una variante que
-- en realidad heredaba. Antes que hacer eso en silencio, esto falla y dice por
-- qué.

do $$
declare
  v_nulls integer;
begin
  select count(*)
    into v_nulls
  from public.actualizaciones_precio_items
  where precio_anterior is null or precio_nuevo is null
     or costo_anterior is null or costo_nuevo is null;

  if v_nulls > 0 then
    raise exception
      'No se puede revertir 20260908210000: hay % fila(s) de auditoria que usan NULL para decir "heredaba del producto". Volver a NOT NULL las convertiria en 0, y deshacer ese lote dejaria variantes a precio cero.',
      v_nulls;
  end if;
end $$;

-- Primero la RPC vuelve a aplastar el NULL contra cero, porque con las
-- columnas NOT NULL no puede escribir otra cosa.
do $$
declare
  v_def text;
  v_ancla text;
  v_nuevo text;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'aprobar_orden_compra_impl';

  if v_def is null then
    raise exception 'GUARD: no existe public.aprobar_orden_compra_impl';
  end if;

  v_ancla :=
'            v_costo_viejo, v_costo_final,
            v_precio_viejo, v_precio_final';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el bloque de la fila de producto no aparece exactamente una vez';
  end if;
  v_nuevo :=
'            coalesce(v_costo_viejo, 0), coalesce(v_costo_final, 0),
            coalesce(v_precio_viejo, 0), coalesce(v_precio_final, 0)';
  v_def := replace(v_def, v_ancla, v_nuevo);

  v_ancla :=
'            pv.costo,
            case when pv.costo = v_costo_efectivo then v_costo_final else pv.costo end,
            pv.precio,
            case when pv.precio = v_precio_efectivo then v_precio_final else pv.precio end';
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'GUARD: el bloque de las filas de variante no aparece exactamente una vez';
  end if;
  v_nuevo :=
'            coalesce(pv.costo, 0),
            coalesce(case when pv.costo = v_costo_efectivo then v_costo_final else pv.costo end, 0),
            coalesce(pv.precio, 0),
            coalesce(case when pv.precio = v_precio_efectivo then v_precio_final else pv.precio end, 0)';
  v_def := replace(v_def, v_ancla, v_nuevo);

  execute v_def;
end $$;

alter table public.actualizaciones_precio_items
  alter column precio_anterior set default 0,
  alter column precio_nuevo    set default 0,
  alter column costo_anterior  set default 0,
  alter column costo_nuevo     set default 0;

alter table public.actualizaciones_precio_items
  alter column precio_anterior set not null,
  alter column precio_nuevo    set not null,
  alter column costo_anterior  set not null,
  alter column costo_nuevo     set not null;

comment on column public.actualizaciones_precio_items.precio_anterior is null;
comment on column public.actualizaciones_precio_items.precio_nuevo is null;
comment on column public.actualizaciones_precio_items.costo_anterior is null;
comment on column public.actualizaciones_precio_items.costo_nuevo is null;
