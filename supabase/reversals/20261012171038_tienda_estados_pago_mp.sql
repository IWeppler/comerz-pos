-- Reversión de 20261012171038_tienda_estados_pago_mp.sql.
-- Antes de correrla, sacar las llamadas a `aplicar_pago_mp_orden` del código
-- (webhook y conciliación), o fallan con "function does not exist".
-- Las órdenes que quedaron en EN_PROCESO / REVISAR / PAGADA_SIN_STOCK no se tocan.
drop function if exists public.aplicar_pago_mp_orden(uuid, uuid, text, jsonb);
