-- Revierte 20260910150000. Saca los links solo si son los que puso esa
-- migración: si alguien los cambió después, el valor nuevo se respeta.
update public.planes
   set link_suscripcion = null
 where link_suscripcion in ('https://mpago.la/2U2MnGh', 'https://mpago.la/1LFRiSv');
