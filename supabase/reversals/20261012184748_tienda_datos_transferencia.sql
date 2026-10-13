-- Reversión de 20261012184748_tienda_datos_transferencia.sql.
-- Primero saca cvu/cuit de orden_tienda_publica (cuerpo vivo), después las columnas.
do $$
declare
  v_def text := pg_get_functiondef('public.orden_tienda_publica(text)'::regprocedure);
begin
  v_def := replace(v_def,
    E'c.alias_mercadopago_tienda, c.transferencia_titular,\n         c.transferencia_cvu, c.transferencia_cuit\n',
    E'c.alias_mercadopago_tienda, c.transferencia_titular\n');
  v_def := replace(v_def,
    E'    ''cvu'', case when v_orden.medio = ''TRANSFERENCIA'' and v_orden.estado = ''PENDIENTE_PAGO''\n'
    || E'                then v_config.transferencia_cvu end,\n'
    || E'    ''cuit'', case when v_orden.medio = ''TRANSFERENCIA'' and v_orden.estado = ''PENDIENTE_PAGO''\n'
    || E'                 then v_config.transferencia_cuit end,\n', '');
  if position('transferencia_cvu' in v_def) > 0 then raise exception 'REVERSION_INCOMPLETA'; end if;
  execute v_def;
end $$;
alter table public.configuracion_pos drop column transferencia_cvu, drop column transferencia_cuit;
