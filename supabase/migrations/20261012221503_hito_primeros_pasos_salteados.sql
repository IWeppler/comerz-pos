-- Activación: "Saltear tutorial" en Primeros pasos.
--
-- El dueño puede saltear la pantalla de Primeros pasos y ver el panel de
-- siempre. Queda guardado POR NEGOCIO (no en el navegador): desde otro
-- dispositivo tampoco vuelve a aparecer. Es un hito más de la lista cerrada.
-- `registrar_hito_activacion` se modifica desde su cuerpo VIVO.
-- Reversión: supabase/reversals/20261012221503_hito_primeros_pasos_salteados.sql

alter table public.hitos_activacion drop constraint hitos_activacion_hito_check;
alter table public.hitos_activacion add constraint hitos_activacion_hito_check check (hito in (
  'POS_ABIERTO','CAMINO_VENTA_LIBRE','CAMINO_IMPORTACION','CAMINO_CARGA_RAPIDA','CAMINO_CARGA_MANUAL',
  'PRIMERA_VENTA_FESTEJADA','PRIMEROS_PASOS_SALTEADOS'));

do $$
declare
  v_def text := pg_get_functiondef('public.registrar_hito_activacion(text)'::regprocedure);
  v_buscar constant text := '''PRIMERA_VENTA_FESTEJADA'')';
  v_veces int;
begin
  v_veces := (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar);
  if v_veces <> 1 then raise exception 'HITO_ANCLA: matchea % veces', v_veces; end if;
  execute replace(v_def, v_buscar, '''PRIMERA_VENTA_FESTEJADA'',''PRIMEROS_PASOS_SALTEADOS'')');
  v_def := pg_get_functiondef('public.registrar_hito_activacion(text)'::regprocedure);
  if position('PRIMEROS_PASOS_SALTEADOS' in v_def) = 0
    or position('SECURITY DEFINER' in v_def) = 0
    or has_function_privilege('anon', 'public.registrar_hito_activacion(text)', 'EXECUTE') then
    raise exception 'HITO_GUARD';
  end if;
end $$;
