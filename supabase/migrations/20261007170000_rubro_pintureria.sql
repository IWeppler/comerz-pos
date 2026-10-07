-- Rubro operativo PINTURERÍA (7/10/2026). Detalle: docs/stock-y-catalogo.md
-- ("Pinturería"). Reversión: supabase/reversals/20261007170000_rubro_pintureria.sql
--
-- Además arregla el alta: `crear_negocio_con_owner` guardaba indumentaria a todo
-- rubro operativo que no fuera electro (Mimo farmacia, LyM MAKEUP cosmética y
-- "prueba 6" gastronomía quedaron en indumentaria; los tres cancelados y sin
-- productos, por eso no se reclasifican).
--
-- Adición de rubro sin reclasificar comercios existentes.
DO $$
DECLARE v_def text; v_valores text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO STRICT v_def FROM pg_constraint
    WHERE conrelid = 'public.configuracion_pos'::regclass AND conname = 'configuracion_pos_rubro_check';
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_valores FROM regexp_matches(v_def, '''([^'']+)''', 'g') m;
  IF v_valores IS DISTINCT FROM ARRAY['alimentos','cotillon','electro','farmacia','ferreteria','indumentaria','otros','quioscos'] THEN
    RAISE EXCEPTION 'El CHECK de rubros cambió: revisar antes de reemplazarlo';
  END IF;
END $$;

-- El alta todavía fuerza indumentaria salvo electro. Parche sobre el cuerpo
-- VIVO, sin reemplazar permisos, membresías, cuentas ni métodos de pago.
DO $$
DECLARE
  v_rpc regprocedure := 'public.crear_negocio_con_owner(text,text,text,text,text,text,text,text,text)'::regprocedure;
  v_anterior text; v_actual text;
  v_ancla text := 'CASE WHEN p_rubro = ''electro'' THEN ''electro'' ELSE ''indumentaria'' END';
  v_nuevo text := 'CASE WHEN p_rubro IN (''indumentaria'',''electro'',''alimentos'',''farmacia'',''ferreteria'',''quioscos'',''cotillon'',''otros'',''pintureria'') THEN p_rubro ELSE ''indumentaria'' END';
BEGIN
  SELECT pg_get_functiondef(v_rpc) INTO v_anterior;
  IF (length(v_anterior) - length(replace(v_anterior, v_ancla, ''))) / length(v_ancla) <> 1 THEN
    RAISE EXCEPTION 'El alta cambió: el CASE de rubro no matchea exactamente una vez';
  END IF;
  IF position('SECURITY DEFINER' IN v_anterior) = 0 OR position('auth.uid()' IN v_anterior) = 0
    OR position('public.rol_permisos' IN v_anterior) = 0 OR position('public.metodos_pago' IN v_anterior) = 0
    OR position('public.usuarios_negocios' IN v_anterior) = 0 THEN
    RAISE EXCEPTION 'El alta no conserva sus controles y siembra esperados';
  END IF;
  EXECUTE replace(v_anterior, v_ancla, v_nuevo);
  SELECT pg_get_functiondef(v_rpc) INTO v_actual;
  IF replace(v_actual, v_nuevo, v_ancla) IS DISTINCT FROM v_anterior THEN
    RAISE EXCEPTION 'El alta cambió fuera del CASE de rubro';
  END IF;
END $$;

ALTER TABLE public.configuracion_pos DROP CONSTRAINT configuracion_pos_rubro_check;
ALTER TABLE public.configuracion_pos ADD CONSTRAINT configuracion_pos_rubro_check
  CHECK (rubro IN ('indumentaria','electro','alimentos','farmacia','ferreteria','quioscos','cotillon','otros','pintureria'));

DO $$
DECLARE v_valores text[];
BEGIN
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_valores FROM pg_constraint c,
    LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') m
    WHERE c.conrelid = 'public.configuracion_pos'::regclass AND c.conname = 'configuracion_pos_rubro_check' AND c.convalidated;
  IF v_valores IS DISTINCT FROM ARRAY['alimentos','cotillon','electro','farmacia','ferreteria','indumentaria','otros','pintureria','quioscos'] THEN
    RAISE EXCEPTION 'El CHECK no conserva los nueve rubros';
  END IF;
END $$;
