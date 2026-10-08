-- ─────────────────────────────────────────────────────────────────────────────
-- Evens y Estilo Bonito: recargo por mora sobre la PORCIÓN VENCIDA.
--
-- Por qué (8/10/2026): auditoría de CELESTE SCHOFER (Evens). Con
-- SALDO_COMPLETO, $201,25 vencidos el 26/9 dispararon $18.828,75 de mora (15%
-- sobre todo el saldo, compras que vencían en octubre incluidas), y el 7/10 se
-- cobraron $6.555 de mora sobre una compra hecha 40 segundos antes del cobro.
-- La regla que vale (Ignacio con Evelyn): cada venta vence en su plazo y
-- recarga UNA vez, sobre lo que queda sin pagar de ella. Es PORCION_VENCIDA,
-- que ya usa Librería Colores desde el 5/10 (20261005120000).
--
-- Solo configuración; la mora no se aplica sola (se materializa al cobrar),
-- así que no hay nada que recalcular. Los vencimientos no dependen de la base.
-- Lo ya cobrado queda como está.
-- Reversión: volver `recargo_mora_base` a 'SALDO_COMPLETO' en los dos negocios.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_filas int;
begin
  update public.configuracion_pos
     set recargo_mora_base = 'PORCION_VENCIDA'
   where negocio_id in (
           '44468525-8381-4c83-a558-eb7209e386b5', -- Evens Indumentaria
           '055a0286-a7ff-46f4-9910-ba4941140db6'  -- Estilo Bonito
         )
     and recargo_mora_base = 'SALDO_COMPLETO';
  get diagnostics v_filas = row_count;

  if v_filas <> 2 then
    raise exception 'Se esperaban 2 configuraciones en SALDO_COMPLETO, se actualizaron %', v_filas;
  end if;
end;
$$;
