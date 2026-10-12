-- Pagos en el checkout, T6: gracia de vencimiento para las órdenes de Mercado Pago.
--
-- La preference vence junto con la orden (`expiration_date_to = vence_en`),
-- pero un pago que la clienta hizo en el último minuto se REGISTRA después:
-- cuando llega el webhook o cuando alguien mira la orden (conciliación). Si en
-- ese hueco otra lectura vencía la orden, el stock volvía a la venta con la
-- mercadería ya cobrada. Las órdenes de MP vencen recién 30 minutos después de
-- su `vence_en`; las de transferencia, como siempre.
--
-- Se modifica el cuerpo VIVO de `liberar_ordenes_tienda_vencidas` con un
-- reemplazo que tiene que matchear una sola vez.
-- Reversión: supabase/reversals/20261012165722_tienda_gracia_mp.sql

do $$
declare
  v_def text;
  v_buscar constant text := E'       and vence_en < now()\n';
  v_nuevo constant text := E'       -- MP: 30 min de gracia para registrar un pago del último minuto (20261012180000).\n'
                        || E'       and vence_en + case when medio = ''TRANSFERENCIA'' then interval ''0''\n'
                        || E'                           else interval ''30 minutes'' end < now()\n';
  v_veces int;
begin
  v_def := pg_get_functiondef('public.liberar_ordenes_tienda_vencidas(uuid)'::regprocedure);
  v_veces := (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar);
  if v_veces <> 1 then
    raise exception 'LIBERAR_ANCLA: matchea % veces', v_veces;
  end if;
  execute replace(v_def, v_buscar, v_nuevo);

  v_def := pg_get_functiondef('public.liberar_ordenes_tienda_vencidas(uuid)'::regprocedure);
  if position('interval ''30 minutes''' in v_def) = 0
    or position('SECURITY DEFINER' in v_def) = 0
    or position('stock_liberado_en is null' in v_def) = 0
    or position('_devolver_stock_orden_tienda' in v_def) = 0
    or has_function_privilege('anon', 'public.liberar_ordenes_tienda_vencidas(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.liberar_ordenes_tienda_vencidas(uuid)', 'EXECUTE') then
    raise exception 'LIBERAR_GUARD';
  end if;
end $$;
