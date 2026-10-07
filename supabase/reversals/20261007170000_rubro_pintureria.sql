BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.configuracion_pos WHERE rubro = 'pintureria') THEN
    RAISE EXCEPTION 'Hay comercios de Pinturería: reclasificarlos antes de revertir';
  END IF;
END $$;
DO $$
DECLARE
  v_rpc regprocedure := 'public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure;
  v_def text;
  v_ancla text := 'CASE WHEN p_rubro IN (''indumentaria'',''electro'',''alimentos'',''farmacia'',''ferreteria'',''quioscos'',''cotillon'',''otros'',''pintureria'') THEN p_rubro ELSE ''indumentaria'' END';
  v_original text := 'CASE WHEN p_rubro = ''electro'' THEN ''electro'' ELSE ''indumentaria'' END';
BEGIN
  SELECT pg_get_functiondef(v_rpc) INTO v_def;
  IF (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 THEN
    RAISE EXCEPTION 'El alta cambió: revisar su reversión';
  END IF;
  EXECUTE replace(v_def, v_ancla, v_original);
END $$;
ALTER TABLE public.configuracion_pos DROP CONSTRAINT configuracion_pos_rubro_check;
ALTER TABLE public.configuracion_pos ADD CONSTRAINT configuracion_pos_rubro_check
  CHECK (rubro IN ('indumentaria','electro','alimentos','farmacia','ferreteria','quioscos','cotillon','otros'));
COMMIT;
