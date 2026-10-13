-- Reversión de 20261013142607_notificaciones_estados.sql (correr a mano).
-- Vuelve `mis_notificaciones`, `notificaciones_sin_leer` y `categoria_notificacion`
-- a su versión de N1 (supabase/migrations/20261013100000_notificaciones_base.sql:
-- copiar esas tres definiciones y correrlas) y borra los estados. Los triggers de N2
-- quedan usando `pesos_ar`, que es equivalente al `_monto_ar` borrado.
drop function if exists public._estados_notificaciones(uuid);
-- Después de borrar la función de arriba, `mis_notificaciones` y
-- `notificaciones_sin_leer` fallan hasta reponer las de N1: correr las dos
-- definiciones de N1 en la MISMA transacción que este drop.
