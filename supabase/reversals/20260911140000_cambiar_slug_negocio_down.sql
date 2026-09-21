-- Vuelve a dejar el slug como algo que solo el super admin puede tocar.
drop function if exists public.cambiar_slug_negocio(text);
