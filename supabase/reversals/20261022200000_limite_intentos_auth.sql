-- Reversión de 20261022200000_limite_intentos_auth.sql.
-- El código (shared/lib/limite-auth.ts) falla abierto sin estas funciones: el
-- login sigue andando, sin límite, y loguea el error.

begin;

drop function if exists public.auth_cupo_disponible(text, text[], int[], int, boolean);
drop function if exists public.auth_registrar_intento(text, text[]);
drop table if exists public.intentos_auth;

commit;
