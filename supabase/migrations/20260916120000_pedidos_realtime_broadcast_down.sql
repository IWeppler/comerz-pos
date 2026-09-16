-- Vuelve al polling: sin trigger no hay mensajes, sin policy no hay canal.
drop trigger if exists trg_pedidos_broadcast on public.pedidos;
drop function if exists public.pedidos_broadcast_cambio();
drop policy if exists "pedidos_broadcast_miembros" on realtime.messages;
