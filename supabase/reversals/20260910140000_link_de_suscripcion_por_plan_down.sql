-- Revierte 20260910140000. La función vuelve a la forma de 20260910130000
-- (sin `plan_link`), y se pierde el link cargado en cada plan.
alter table public.planes drop column if exists link_suscripcion;
drop function if exists public.ciclo_de_vida_negocios();
