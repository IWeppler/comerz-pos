-- Reversión de 20261012162839_tienda_cobrar_orden.sql
-- Saca las funciones, el turno de conciliación y el CHECK de métodos
-- inactivos. NO borra los métodos `uso_tienda` ni su cuenta: tienen ventas y
-- movimientos colgados (son historia). Sin el CHECK alguien podría activarlos
-- desde Métodos de pago y aparecerían en el POS: revisar antes de revertir.

drop function public.orden_tienda_publica(text);
drop function public.cancelar_orden_tienda(uuid);
drop function public.confirmar_transferencia_orden(uuid);
drop function public._registrar_venta_orden_tienda(uuid, uuid, text, uuid, jsonb);
drop function public.metodo_pago_tienda(uuid, text);
drop function public.tomar_turno_conciliacion_mp(uuid, integer);
drop table public.conciliaciones_mp;
alter table public.metodos_pago drop constraint metodos_pago_uso_tienda_inactivo;
