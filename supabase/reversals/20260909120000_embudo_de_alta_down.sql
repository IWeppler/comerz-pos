-- Revierte 20260909120000. La función es solo lectura y no la escribe nadie:
-- borrarla no puede perder un dato, y el embudo se reconstruye entero desde
-- `auth.users` el día que se vuelva a crear.
--
-- Lo que sí rompe es el panel de /admincomerz, que la lee. Bajar esta
-- migración exige bajar también el código.
drop function if exists public.embudo_de_alta();
