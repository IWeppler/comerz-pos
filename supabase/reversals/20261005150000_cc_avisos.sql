-- Reversión de 20261005150000_cc_avisos.sql. Correr a mano.
-- Antes: revertir la pantalla de avisos (fase 3).
-- OJO: borra el registro de avisos enviados. Si hay que conservarlo, copiarlo
-- antes al schema `archivo`.

drop function if exists public.cc_deuda_por_vencimiento();
drop table if exists public.cc_avisos;
