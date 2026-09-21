begin;
drop trigger if exists trg_egresos_validar_cuenta_origen on public.egresos;
drop function if exists public.validar_cuenta_origen_egreso();
drop function if exists public.flujo_caja_turno(uuid);
-- No se revierte efectivo_actual_turnos/calcular_egresos_turno automáticamente:
-- restaurarlos exige reaplicar sus migraciones originales para no perder fixes.
commit;
