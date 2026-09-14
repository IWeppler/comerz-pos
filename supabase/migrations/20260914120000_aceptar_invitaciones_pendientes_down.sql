-- Vuelve a la aceptación solo por token del link. Las invitaciones ya
-- aceptadas por email quedan como están.
drop function if exists public.aceptar_invitaciones_pendientes();
