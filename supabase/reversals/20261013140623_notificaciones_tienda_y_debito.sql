-- Reversión de 20261013140623_notificaciones_tienda_y_debito.sql (correr a mano).
-- Los avisos ya escritos quedan en `notificaciones` (son historia; se borran solos
-- a los 60 días).
drop trigger if exists trg_notificar_debito_cobrado on public.pagos_suscripcion;
drop trigger if exists trg_notificar_orden_tienda on public.ordenes_tienda;
drop function if exists public._notificar_debito_cobrado();
drop function if exists public._notificar_orden_tienda();
drop function if exists public._monto_ar(numeric);
drop function if exists public._notificar(uuid, text, text, text, text, text, jsonb);
