-- Reversa de Etapa 2.
-- Borra solo el espejo financiero. venta_pagos, egresos, Caja y cierres no se
-- modifican porque nunca dejaron de ser las fuentes de verdad.

begin;

drop trigger if exists trg_egresos_bitacora_financiera on public.egresos;
drop trigger if exists trg_venta_pagos_bitacora_financiera on public.venta_pagos;
drop trigger if exists trg_movimientos_financieros_inmutable
  on public.movimientos_financieros;

drop function if exists public.registrar_bitacora_egreso();
drop function if exists public.snapshot_financiero_egreso(public.egresos);
drop function if exists public.registrar_bitacora_venta_pago();
drop function if exists public.snapshot_financiero_venta_pago(public.venta_pagos);
drop function if exists public.importe_financiero_venta_pago(text, numeric, numeric);
drop function if exists public.cuenta_actual_venta_pago(uuid, text, integer, uuid);
drop function if exists public.impedir_mutacion_movimiento_financiero();

drop table if exists public.movimientos_financieros;

commit;
