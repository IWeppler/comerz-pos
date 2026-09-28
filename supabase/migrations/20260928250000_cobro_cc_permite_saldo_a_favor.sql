-- ---------------------------------------------------------------------------
-- Saldo a favor, etapa B1: pago de más y seña.
--
-- `registrar_cobro_cc` (20260928210000) rechaza con COBRO_SUPERA_DEUDA todo
-- cobro mayor al saldo + mora, porque hasta el saldo con signo (20260928230000)
-- el excedente no tenía dónde quedar: el caché lo recortaba a cero y el libro
-- decía otra cosa. Ahora puede quedar como saldo a favor, así que el tope pasa
-- a ser un PEDIDO DE CONFIRMACIÓN y no una prohibición:
--
-- * Sin confirmar, sigue rechazando igual. Es lo que frena el cobro duplicado
--   (los dos del 21/7/2026 saldaban de más) y el monto mal tipeado.
-- * Con `p_pago->>'permitir_saldo_a_favor' = true` —que la pantalla manda solo
--   si la cajera marcó "dejar $X a favor"— el excedente queda como saldo
--   negativo. Una seña es el mismo camino con deuda cero.
--
-- Va dentro de `p_pago` y no como parámetro nuevo para no cambiar la firma.
-- El crédito sigue siendo UNA fila: `corregir_metodo_pago_cobro_cc` exige un
-- solo CREDITO por cobro, y el libro ya compensa solo deuda y saldo a favor.
-- ---------------------------------------------------------------------------

do $cobro$
declare
  v_def text := pg_get_functiondef('public.registrar_cobro_cc(jsonb, jsonb)'::regprocedure);
  v_viejo constant text :=
E'  v_deuda := round(v_saldo + v_mora, 2);\n  if round(v_monto, 2) > v_deuda then';
  v_nuevo constant text :=
E'  v_deuda := round(v_saldo + v_mora, 2);\n'
|| E'  -- Desde 20260928250000 el excedente puede quedar como saldo a favor, pero\n'
|| E'  -- solo si quien cobra lo confirmó: sin eso sigue siendo el freno contra el\n'
|| E'  -- cobro duplicado y el monto mal tipeado.\n'
|| E'  if round(v_monto, 2) > v_deuda\n'
|| E'     and not coalesce((p_pago->>''permitir_saldo_a_favor'')::boolean, false) then';
  n int;
begin
  n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if n <> 1 then
    raise exception 'GUARD: el tope de registrar_cobro_cc aparece % veces (se esperaba 1)', n;
  end if;

  execute replace(v_def, v_viejo, v_nuevo);

  if pg_get_functiondef('public.registrar_cobro_cc(jsonb, jsonb)'::regprocedure)
       !~ 'permitir_saldo_a_favor' then
    raise exception 'GUARD: registrar_cobro_cc quedó sin la confirmación de saldo a favor';
  end if;
  if pg_get_functiondef('public.registrar_cobro_cc(jsonb, jsonb)'::regprocedure)
       ~* 'greatest\s*\(\s*0' then
    raise exception 'GUARD: registrar_cobro_cc no puede recortar el saldo a cero';
  end if;
end;
$cobro$;
