-- Pagos en el checkout: datos completos para transferir.
--
-- La página de la orden mostraba solo alias y titular. La clienta, para
-- transferir desde cualquier banco, necesita además el CVU y el CUIT del
-- titular (los bancos lo muestran para confirmar el destino).
--
--   1. `configuracion_pos.transferencia_cvu` (22 dígitos) y
--      `transferencia_cuit` (11 dígitos). Null = no cargado: no se adivina
--      desde el CUIT fiscal (puede no ser el titular de la cuenta de MP).
--      Sin GRANT a anon: solo los lee `orden_tienda_publica` (DEFINER).
--   2. `orden_tienda_publica` devuelve `cvu` y `cuit` con la misma regla que
--      alias y titular: solo transferencia y solo mientras espera el pago.
--      Se modifica el cuerpo VIVO con reemplazos que matchean una sola vez.
-- Reversión: supabase/reversals/20261012184748_tienda_datos_transferencia.sql

alter table public.configuracion_pos
  add column transferencia_cvu text
    constraint configuracion_pos_transferencia_cvu_check check (transferencia_cvu is null or transferencia_cvu ~ '^[0-9]{22}$'),
  add column transferencia_cuit text
    constraint configuracion_pos_transferencia_cuit_check check (transferencia_cuit is null or transferencia_cuit ~ '^[0-9]{11}$');

comment on column public.configuracion_pos.transferencia_cvu is
  'CVU de la cuenta de Mercado Pago conectada, para la página de la orden. Lo carga el comercio en Cobros.';
comment on column public.configuracion_pos.transferencia_cuit is
  'CUIT del titular de la cuenta que recibe la transferencia. No se copia del CUIT fiscal: puede ser otra persona.';

do $$
declare
  v_def text;
  v_reemplazos text[][] := array[
    array[
      E'c.alias_mercadopago_tienda, c.transferencia_titular\n',
      E'c.alias_mercadopago_tienda, c.transferencia_titular,\n         c.transferencia_cvu, c.transferencia_cuit\n'
    ],
    array[
      E'                    then v_config.transferencia_titular end,\n',
      E'                    then v_config.transferencia_titular end,\n'
      || E'    ''cvu'', case when v_orden.medio = ''TRANSFERENCIA'' and v_orden.estado = ''PENDIENTE_PAGO''\n'
      || E'                then v_config.transferencia_cvu end,\n'
      || E'    ''cuit'', case when v_orden.medio = ''TRANSFERENCIA'' and v_orden.estado = ''PENDIENTE_PAGO''\n'
      || E'                 then v_config.transferencia_cuit end,\n'
    ]
  ];
  v_veces int;
  i int;
begin
  v_def := pg_get_functiondef('public.orden_tienda_publica(text)'::regprocedure);
  for i in 1 .. array_length(v_reemplazos, 1) loop
    v_veces := (length(v_def) - length(replace(v_def, v_reemplazos[i][1], ''))) / length(v_reemplazos[i][1]);
    if v_veces <> 1 then
      raise exception 'ORDEN_PUBLICA_ANCLA %: matchea % veces', i, v_veces;
    end if;
    v_def := replace(v_def, v_reemplazos[i][1], v_reemplazos[i][2]);
  end loop;
  execute v_def;

  v_def := pg_get_functiondef('public.orden_tienda_publica(text)'::regprocedure);
  if position('transferencia_cvu' in v_def) = 0
    or position('''cuit''' in v_def) = 0
    or position('SECURITY DEFINER' in v_def) = 0
    or position('security.negocio_publico()' in v_def) = 0
    or not has_function_privilege('anon', 'public.orden_tienda_publica(text)', 'EXECUTE')
    or has_column_privilege('anon', 'public.configuracion_pos', 'transferencia_cvu', 'SELECT')
    or has_column_privilege('anon', 'public.configuracion_pos', 'transferencia_cuit', 'SELECT') then
    raise exception 'ORDEN_PUBLICA_GUARD';
  end if;
end $$;
