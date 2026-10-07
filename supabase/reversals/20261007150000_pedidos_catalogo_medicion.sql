-- Reversión de 20261007150000_pedidos_catalogo_medicion.sql. A MANO.
-- Los eventos PEDIDO_CATALOGO ya guardados quedan en eventos_uso (son datos de
-- uso, no estorban). El catálogo sigue andando: la llamada falla y se ignora.

drop function if exists public.registrar_pedido_catalogo(numeric, integer, numeric, text, text, boolean);
drop function if exists public.metricas_pedidos_catalogo();
