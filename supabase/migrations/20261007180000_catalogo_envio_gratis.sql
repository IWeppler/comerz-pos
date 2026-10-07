-- M2. Aditiva; aplicar antes de publicar el código. No se aplica desde el agente.
begin;
alter table public.configuracion_pos
  add column envio_gratis_desde_monto numeric,
  add column envio_gratis_desde_unidades numeric,
  add column envio_gratis_alcance text not null default 'LOCAL',
  add constraint envio_gratis_monto_positivo check (envio_gratis_desde_monto is null or envio_gratis_desde_monto > 0),
  add constraint envio_gratis_unidades_positivo check (envio_gratis_desde_unidades is null or envio_gratis_desde_unidades > 0),
  add constraint envio_gratis_alcance_valido check (envio_gratis_alcance in ('LOCAL', 'TODOS'));
grant select (envio_gratis_desde_monto, envio_gratis_desde_unidades, envio_gratis_alcance) on public.configuracion_pos to anon;
do $$
begin
  if not has_column_privilege('anon', 'public.configuracion_pos', 'envio_gratis_desde_monto', 'select')
    or not has_column_privilege('anon', 'public.configuracion_pos', 'envio_gratis_desde_unidades', 'select')
    or not has_column_privilege('anon', 'public.configuracion_pos', 'envio_gratis_alcance', 'select') then
    raise exception 'Faltan GRANT públicos para el envío gratis';
  end if;
  if exists (select 1 from public.configuracion_pos where envio_gratis_desde_monto is not null or envio_gratis_desde_unidades is not null or envio_gratis_alcance <> 'LOCAL') then
    raise exception 'La migración no debe activar beneficios existentes';
  end if;
end $$;
commit;
