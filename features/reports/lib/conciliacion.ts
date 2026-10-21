/**
 * Conciliación del período: comprobaciones que cruzan fuentes distintas y
 * dicen si CIERRAN o no, y por qué.
 *
 * Regla de honestidad: un chequeo que no cierra NO se corrige en silencio. Se
 * muestra con la diferencia y la explicación. Un chequeo sin datos suficientes
 * queda como SIN_DATO, nunca como CIERRA.
 *
 * Las identidades salen de medir la base (Evens, 90 días, solo lectura):
 *  - V1: cada venta = lo cobrado en la venta + lo que quedó en cuenta corriente.
 *    Cierra en las 1.484 ventas medidas.
 *  - C1: cada crédito de cuenta corriente es un cobro registrado (pago) o una
 *    anulación/devolución de fiado (vinculado a la venta, sin pago). Medido: los
 *    310 pagos coinciden al peso; quedó 1 crédito de $7.557 sin clasificar.
 *  - S1: cada venta debería tener su movimiento de stock. Medido: 419 de 1.484
 *    no lo tienen, así que el stock no se puede conciliar desde los movimientos.
 */

export interface DatosConciliacion {
  /** Σ `ventas.total` de las ventas no anuladas del período. */
  ventasTotal: number;
  ventasCount: number;
  /** Σ pagos de venta (no anulados) de esas ventas. */
  cobradoEnVenta: number;
  /** Σ débitos de cuenta corriente ligados a esas ventas: lo fiado. */
  fiadoDelPeriodo: number;
  /** Σ créditos de cuenta corriente (no anulados) registrados en el período. */
  ccCreditos: number;
  /** Σ cobros de deuda registrados como pago en el período. */
  ccCobrosRegistrados: number;
  /** Créditos ligados a una venta que no vienen de un pago (anulación/devolución de fiado). */
  ccCreditosVinculadosVenta: number;
  /** Ventas del período con al menos un movimiento de stock de tipo VENTA. */
  ventasConMovimientoStock: number;
}

export type EstadoChequeo = "CIERRA" | "NO_CIERRA" | "SIN_DATO";

export interface Chequeo {
  id: "V1" | "C1" | "S1" | "K1";
  titulo: string;
  esperado: number | null;
  observado: number | null;
  /** esperado − observado. Null si no hay datos. */
  diferencia: number | null;
  estado: EstadoChequeo;
  explicacion: string;
}

/** Tolerancia en pesos: redondeos de centavos no son un error. */
export const TOLERANCIA_PESOS = 1;

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function calcularConciliacion(d: DatosConciliacion): Chequeo[] {
  const chequeos: Chequeo[] = [];

  // V1. Venta = cobrado en la venta + fiado.
  {
    const esperado = redondear(d.ventasTotal);
    const observado = redondear(d.cobradoEnVenta + d.fiadoDelPeriodo);
    const diferencia = redondear(esperado - observado);
    chequeos.push({
      id: "V1",
      titulo: "Ventas = cobrado en la venta + fiado",
      esperado,
      observado,
      diferencia,
      estado: Math.abs(diferencia) <= TOLERANCIA_PESOS ? "CIERRA" : "NO_CIERRA",
      explicacion:
        Math.abs(diferencia) <= TOLERANCIA_PESOS
          ? `Las ${d.ventasCount} ventas del período están completas: lo cobrado más lo fiado suma el total.`
          : "Hay ventas con pagos sin registrar o fiado sin imputar a la venta. Revisar las ventas con diferencia.",
    });
  }

  // C1. Créditos de cuenta corriente = cobros de deuda + anulaciones/devoluciones de fiado.
  {
    const esperado = redondear(d.ccCreditos);
    const observado = redondear(d.ccCobrosRegistrados + d.ccCreditosVinculadosVenta);
    const diferencia = redondear(esperado - observado);
    chequeos.push({
      id: "C1",
      titulo: "Créditos de cuenta corriente = cobros de deuda + anulaciones de fiado",
      esperado,
      observado,
      diferencia,
      estado: Math.abs(diferencia) <= TOLERANCIA_PESOS ? "CIERRA" : "NO_CIERRA",
      explicacion:
        Math.abs(diferencia) <= TOLERANCIA_PESOS
          ? "Cada crédito de la cuenta corriente tiene su origen: un cobro registrado o una anulación de fiado."
          : "Hay créditos de cuenta corriente sin origen registrado. Su monto es la diferencia: revisar los movimientos de esos clientes.",
    });
  }

  // S1. Cada venta tiene su movimiento de stock.
  {
    const esperado = d.ventasCount;
    const observado = d.ventasConMovimientoStock;
    const diferencia = esperado - observado;
    chequeos.push({
      id: "S1",
      titulo: "Cada venta tiene su movimiento de stock",
      esperado,
      observado,
      diferencia,
      estado: diferencia === 0 ? "CIERRA" : "NO_CIERRA",
      explicacion:
        diferencia === 0
          ? "Todas las ventas bajaron el stock: el inventario se puede conciliar desde los movimientos."
          : `${diferencia} ventas no tienen movimiento de stock. Por eso el stock no se puede conciliar con las ventas desde los movimientos: el número de stock es el que se cargó, no el que se derivó de las ventas.`,
    });
  }

  // K1. Caja: todavía no se cruza con esta herramienta.
  chequeos.push({
    id: "K1",
    titulo: "Cobros en efectivo = movimientos de caja",
    esperado: null,
    observado: null,
    diferencia: null,
    estado: "SIN_DATO",
    explicacion:
      "Pendiente: falta cruzar los cobros en efectivo con los movimientos de cada turno. Hasta entonces, la caja se controla con el arqueo.",
  });

  return chequeos;
}
