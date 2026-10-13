-- Reversión de 20261012221503_hito_primeros_pasos_salteados.sql.
delete from public.hitos_activacion where hito = 'PRIMEROS_PASOS_SALTEADOS';
alter table public.hitos_activacion drop constraint hitos_activacion_hito_check;
alter table public.hitos_activacion add constraint hitos_activacion_hito_check check (hito in (
  'POS_ABIERTO','CAMINO_VENTA_LIBRE','CAMINO_IMPORTACION','CAMINO_CARGA_RAPIDA','CAMINO_CARGA_MANUAL','PRIMERA_VENTA_FESTEJADA'));
do $$
declare v_def text := pg_get_functiondef('public.registrar_hito_activacion(text)'::regprocedure);
begin
  execute replace(v_def, '''PRIMERA_VENTA_FESTEJADA'',''PRIMEROS_PASOS_SALTEADOS'')', '''PRIMERA_VENTA_FESTEJADA'')');
end $$;
