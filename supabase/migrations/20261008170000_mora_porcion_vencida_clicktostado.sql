-- ─────────────────────────────────────────────────────────────────────────────
-- ClickTostado: recargo por mora sobre la PORCIÓN VENCIDA, como Evens, Estilo
-- Bonito (20261008150000) y Librería Colores. Pedido de Ignacio, 8/10/2026: la
-- cláusula de aceleración (SALDO_COMPLETO) le cobra mora a compras que todavía
-- no vencieron. Con esto ningún comercio queda en SALDO_COMPLETO.
-- Solo configuración (la mora se materializa al cobrar). Su única mora cobrada
-- (FERNANDA GALVAN, $9.250) es igual con las dos bases: no hay nada que corregir.
-- Reversión: volver `recargo_mora_base` a 'SALDO_COMPLETO' en ClickTostado.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_filas int;
begin
  update public.configuracion_pos
     set recargo_mora_base = 'PORCION_VENCIDA'
   where negocio_id = '1844badf-1a9a-457c-bfee-4d10122337e8' -- ClickTostado
     and recargo_mora_base = 'SALDO_COMPLETO';
  get diagnostics v_filas = row_count;

  if v_filas <> 1 then
    raise exception 'Se esperaba 1 configuración en SALDO_COMPLETO, se actualizaron %', v_filas;
  end if;
end;
$$;
