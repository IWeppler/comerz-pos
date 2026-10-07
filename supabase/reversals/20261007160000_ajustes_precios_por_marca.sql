-- Revertir el código junto con esta migración: la UI usa las dos RPC.
BEGIN;
DROP FUNCTION public.aplicar_ajuste_precios(uuid,text,text,text,text,text,numeric,text,uuid[],jsonb);
DROP FUNCTION public.revertir_ajuste_precios(uuid);
DROP FUNCTION public.calcular_ajuste_precio(numeric,numeric,text,text,numeric,text);
DROP FUNCTION public.normalizar_marca_precios(text);
ALTER TABLE public.actualizaciones_precio DROP COLUMN alcance_valor;
COMMIT;
