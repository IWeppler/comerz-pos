-- Reversión de 20261022180000_cobro_cc_mercadopago.sql.
--
-- Los cobros ya registrados por Mercado Pago (filas de venta_pagos, movimientos y
-- recibos) NO se tocan: son plata que entró. Se borran los intentos, la RPC y el
-- negocio de sistema, y las tres funciones de cobro vuelven a leer solo la sesión.
-- Si hay avisos COBRO_CC_ONLINE en la campana, el CHECK viejo no los admite: se
-- borran antes.

begin;

drop function public.aplicar_pago_mp_cobro_cc(uuid, uuid, text, jsonb);

do $reversion$
declare
  v_def text;
  v_fn text;
  v_nuevo text := 'coalesce(security.current_negocio_id(), public._negocio_de_sistema())';
begin
  foreach v_fn in array array['registrar_cobro_cc', 'registrar_recibo_cobro_cc', 'recibo_cobro_cc'] loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if (length(v_def) - length(replace(v_def, v_nuevo, ''))) / length(v_nuevo) <> 1 then
      raise exception '%: no se encontró el reemplazo de 20261022180000', v_fn;
    end if;
    execute replace(v_def, v_nuevo, 'security.current_negocio_id()');
  end loop;
end
$reversion$;

drop function public._negocio_de_sistema();

delete from public.notificaciones where tipo = 'COBRO_CC_ONLINE';
alter table public.notificaciones drop constraint notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check
  check (tipo in ('STOCK_AGOTADO', 'ORDEN_PAGADA', 'ORDEN_REVISAR', 'ORDEN_SIN_STOCK', 'DEBITO_COBRADO'));

alter table public.eventos_pago drop column cobro_cc_id;
drop table public.cobros_cc_online;

commit;
