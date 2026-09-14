-- Vuelve a la firma de crear_pedido sin contexto; la columna queda (es
-- aditiva y opaca).
drop function if exists public.crear_pedido(jsonb, uuid, numeric, text, jsonb);
-- Reaplicar 20260915120000 para recuperar crear_pedido(jsonb, uuid, numeric, text).
