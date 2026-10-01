-- Reversión de 20261001150000_corregir_variante.sql
-- La función es nueva y aditiva: deshacerla es borrarla. Lo que ya corrigió
-- o fusionó queda como está (está en producto_variantes_auditoria).
drop function if exists public.corregir_variante(uuid, jsonb, text, jsonb, boolean);
