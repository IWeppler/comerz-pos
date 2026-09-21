-- Revierte 20260910120000. Borra el registro de envíos Y las bajas: si se
-- vuelve a aplicar, hay que tener presente que las bajas no se recuperan.
drop function if exists public.dar_de_baja_mails(uuid);
drop table if exists public.email_bajas;
drop table if exists public.envios_email;
