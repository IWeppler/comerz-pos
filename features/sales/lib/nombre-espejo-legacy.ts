/**
 * A qué fila del espejo `productos_stock` vuelve una unidad que entra por
 * anulación o devolución.
 *
 * El espejo se busca por TEXTO (`producto_id` + `variante`), y
 * `ajustar_stock_legacy` hace upsert: si el texto no existe, crea una fila
 * nueva en vez de fallar. `ventas_items.variante` es el nombre congelado el día
 * de la venta; si después el talle se renombró, devolver por ese texto deja la
 * unidad en una fila fantasma y el talle real un número abajo (Evens, REMERA
 * CARE: espejo en -1 y la unidad en "TALLE: U / COLOR: CELESTE", 22/10/2026).
 *
 * Por eso manda el nombre ACTUAL de la variante (`nombre_display`, resuelto
 * por `variante_id`), que es el que escribe la venta. El texto del ticket queda
 * solo para los renglones sin variante.
 */
export function nombreEspejoLegacy(
  nombreActual: string | null | undefined,
  textoTicket: string,
): string {
  return nombreActual ?? textoTicket;
}
