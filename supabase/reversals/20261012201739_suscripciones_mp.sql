-- Reversión de 20261012201739_suscripciones_mp.sql.
-- Antes: sacar del código las llamadas (webhook de suscripciones, acciones de débito).
-- Los pagos ya registrados quedan en pagos_suscripcion (sin la columna mp_payment_id).
drop function if exists public.registrar_pago_suscripcion_mp(text, text, numeric, date);
drop index if exists public.pagos_suscripcion_mp_payment_unico;
alter table public.pagos_suscripcion drop column if exists mp_payment_id;
drop table if exists public.suscripciones_mp;
