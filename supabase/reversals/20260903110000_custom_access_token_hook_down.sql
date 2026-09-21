-- Rollback de 20260903110000_custom_access_token_hook.
--
-- NO se aplica solo: es un archivo para correr a mano si hay que volver atrás.
--
-- ⚠ ANTES DE CORRERLO: DESREGISTRAR EL HOOK EN EL DASHBOARD
-- (Authentication → Hooks → Customize Access Token). Si el hook sigue
-- registrado y esta función no existe, cada emisión de token llama a algo que
-- no está — y el modo de falla es que Auth deje de emitir tokens, o sea que
-- NADIE pueda loguearse ni refrescar en los cuatro comercios.
--
-- Ese es el único orden seguro:
--   1. desregistrar en el dashboard
--   2. recién ahí, correr esto
--
-- QUÉ PASA DESPUÉS. Los tokens vuelven a salir sin el claim `comerz`. El
-- middleware no se rompe: cae al fallback contra `contexto_sesion()`, que es
-- exactamente como funcionaba antes de todo esto. Se pierde el ahorro de
-- ~346 ms por request, no la funcionalidad. Por eso el fallback se escribió
-- permanente y no como andamio.
--
-- Los tokens YA EMITIDOS con el claim siguen siendo válidos hasta que expiren
-- (60 min) y el middleware los sigue leyendo bien: el claim no deja de ser
-- cierto porque el hook ya no esté.
--
-- NO se toca `security.es_super_admin(uuid)`: es de 20260903100000, es un
-- cambio independiente y bueno por sí mismo, y `security.is_super_admin()`
-- depende de ella. Para revertir eso hay que correr el `_down` de aquella.

begin;

drop function if exists public.custom_access_token_hook(jsonb);

commit;
