/**
 * Lo que paga un comercio por mes: su precio acordado o, si no tiene, el de
 * lista de su plan. Espejo de `coalesce(n.precio_acordado, precio_mensual)` en
 * las RPC del panel de Comerz (20261012200111): el MRR que se calcula acá y el
 * de la base tienen que dar lo mismo.
 *
 * `0` acordado es un valor (cortesía total), no "sin acordar".
 */
export function precioEfectivo(precioAcordado: number | null | undefined, precioLista: number): number {
  return precioAcordado ?? precioLista;
}

/** "30.000" / "$ 30000" / "30000,50" → 30000 / 30000 / 30000.5. Vacío → null. NaN → undefined. */
export function leerPrecioTipeado(texto: string): number | null | undefined {
  const limpio = texto.trim().replace(/[$\s]/g, "");
  if (limpio === "") return null;
  const numero = Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(numero) && numero >= 0 ? numero : undefined;
}
