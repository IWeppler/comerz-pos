-- Reversión de 20261012162746_tienda_crear_orden.sql
-- Saca las funciones. NO toca órdenes ni stock: si ya hay órdenes pendientes
-- con stock apartado, primero hay que vencerlas o cancelarlas (si no, ese
-- stock queda descontado sin nadie que lo devuelva). Por eso aborta.
-- Si 20261012162839 está aplicada, revertir esa primero.

do $$
begin
  if exists (select 1 from public.ordenes_tienda where estado in ('PENDIENTE_PAGO', 'EN_PROCESO') and stock_liberado_en is null) then
    raise exception 'REVERSION_ORDEN: hay órdenes con stock apartado; vencerlas o cancelarlas antes';
  end if;
end $$;

drop function public.crear_orden_tienda(uuid, jsonb, jsonb);
drop function public.opciones_cobro_online();
drop function public.liberar_ordenes_tienda_vencidas(uuid);
drop function public._devolver_stock_orden_tienda(uuid, uuid);
