/**
 * La aritmética del arqueo de caja.
 *
 * Vive acá y no dentro del `useMemo` del dashboard porque es la cuenta que
 * decide si a una vendedora le falta plata en el cajón, y una cuenta así tiene
 * que poder probarse sin montar un componente.
 *
 * El bug que la trajo acá: el 22/8/2026 Ninja Camisetas mostraba −320.000 de
 * efectivo esperado después de 6 devoluciones, cuando al cajón le faltaban
 * 25.000. Las ventas anuladas se excluían de los ingresos PERO su egreso de
 * devolución se seguía restando, así que cada anulación pegaba dos veces.
 */

export interface MovimientoCaja {
  tipo: "INGRESO" | "EGRESO";
  /** Lo que decide si toca el cajón físico. */
  metodo_tipo: string;
  monto: number;
  comision: number;
  neto: number;
  /** La venta se anuló. Cambia en qué totales entra, no si es real. */
  anulada?: boolean;
  /** Las transferencias que entran al cajón son ingresos físicos, no ventas. */
  afecta_facturacion?: boolean;
}

export interface TotalesTurno {
  fondoInicial: number;
  /** Para cuadrar el cajón. INCLUYE anuladas. */
  ingresosEfectivo: number;
  ingresosDigitalesBruto: number;
  comisionesRetenidas: number;
  ingresosDigitalesNeto: number;
  totalEgresos: number;
  efectivoEsperado: number;
  /** Lo que se vendió. SIN anuladas. */
  totalFacturado: number;
}

const esEfectivo = (m: MovimientoCaja) => m.metodo_tipo === "EFECTIVO";
const esIngreso = (m: MovimientoCaja) => m.tipo === "INGRESO";
const sumar = (movs: MovimientoCaja[], campo: keyof MovimientoCaja) =>
  movs.reduce((acc, m) => acc + (Number(m[campo]) || 0), 0);

/**
 * Dos preguntas distintas sobre los mismos movimientos, y por eso dos totales
 * que NO se pueden derivar uno del otro:
 *
 * - `efectivoEsperado` = "¿cuánta plata tiene que haber en el cajón?".
 *   Cuenta las ventas anuladas en efectivo, porque esa plata entró de verdad;
 *   lo que la saca es el egreso de devolución, que ya viene en la lista. No
 *   contarlas ADEMÁS de restar el egreso es restar dos veces lo mismo.
 *
 * - `totalFacturado` = "¿cuánto se vendió?". No cuenta ninguna anulada.
 *
 * Las anuladas cobradas por medios digitales quedan afuera de los dos: no
 * tocan el cajón, y `anular_venta` no les genera egreso porque se devuelven
 * por donde entraron. Sumarlas mostraría como cobrado algo ya devuelto.
 */
export function calcularTotalesTurno(
  movimientos: MovimientoCaja[],
  fondoInicial: number,
): TotalesTurno {
  const efectivoArqueo = movimientos.filter((m) => esIngreso(m) && esEfectivo(m));
  const efectivoFacturado = efectivoArqueo.filter(
    (m) => !m.anulada && m.afecta_facturacion !== false,
  );
  const digitales = movimientos.filter(
    (m) => esIngreso(m) && !esEfectivo(m) && !m.anulada,
  );
  const egresos = movimientos.filter((m) => m.tipo === "EGRESO");

  const ingresosEfectivo = sumar(efectivoArqueo, "monto");
  const ingresosDigitalesBruto = sumar(digitales, "monto");
  const totalEgresos = sumar(egresos, "monto");

  return {
    fondoInicial,
    ingresosEfectivo,
    ingresosDigitalesBruto,
    comisionesRetenidas: sumar(digitales, "comision"),
    ingresosDigitalesNeto: sumar(digitales, "neto"),
    totalEgresos,
    efectivoEsperado: fondoInicial + ingresosEfectivo - totalEgresos,
    totalFacturado: sumar(efectivoFacturado, "monto") + ingresosDigitalesBruto,
  };
}
