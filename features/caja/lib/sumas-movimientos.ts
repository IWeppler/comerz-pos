/**
 * Las sumas del encabezado de Movimientos: cuánta plata hay en lo filtrado.
 *
 * Las calcula la BASE (`movimientos_financieros_negocio`, `20260929140000`)
 * sobre todo lo filtrado, antes de paginar: sumar en el navegador sería sumar
 * solo la página cargada.
 *
 * Los importes tienen signo, así que un solo número no alcanza cuando se
 * mezclan entradas y salidas: con "todos los tipos" el neto resta los gastos
 * de los cobros, y una transferencia entre cuentas propias son dos filas
 * (+ y −) que se anulan. Si todo va para el mismo lado (el caso típico:
 * "transferencias del sábado"), alcanza con el total; si no, se muestran
 * entradas, salidas y neto.
 */

export type SumasMovimientos = {
  neto: number;
  entradas: number;
  /** Negativo o cero, como viene del ledger. */
  salidas: number;
};

/** null si la base no mandó las sumas (migración sin aplicar): la pantalla
 * no inventa un total a partir de la página cargada. */
export function sumasDe(
  pagina:
    | {
        importe_total?: number | string | null;
        importe_entradas?: number | string | null;
        importe_salidas?: number | string | null;
      }
    | null
    | undefined,
): SumasMovimientos | null {
  if (!pagina || pagina.importe_total == null) return null;
  return {
    neto: Number(pagina.importe_total),
    entradas: Number(pagina.importe_entradas ?? 0),
    salidas: Number(pagina.importe_salidas ?? 0),
  };
}

/** true cuando hay plata para los dos lados y el neto solo confundiría. */
export function hayQueDesglosar(sumas: SumasMovimientos): boolean {
  return sumas.entradas !== 0 && sumas.salidas !== 0;
}
