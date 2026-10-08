-- Manual, luego de revertir embudo_activacion_autonoma. Conserva cambios ajenos.
do $$
declare firma text; cuerpo text; filtro text; ancla text;
begin
  foreach firma in array array['public.estado_activacion()','public.estado_activacion_de(uuid)'] loop
    cuerpo := pg_get_functiondef(firma::regprocedure);
    filtro := case when firma='public.estado_activacion()' then 'security.current_negocio_id()' else 'p_negocio' end;
    ancla := E'\n      ''venta_libre_elegida'', exists (select 1 from public.hitos_activacion h where h.negocio_id = ' || filtro || ' and h.hito = ''CAMINO_VENTA_LIBRE''),';
    if length(cuerpo)-length(replace(cuerpo,ancla,''))<>length(ancla) then raise exception 'REVERSA_HITOS_ANCLA'; end if;
    execute replace(cuerpo,ancla,'');
  end loop;
end $$;
drop function public.registrar_hito_activacion(text);
drop table public.hitos_activacion;
