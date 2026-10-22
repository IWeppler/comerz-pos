/**
 * Cómo dice un comprobante lo que pasó con la cuenta corriente. Una sola
 * regla para el WhatsApp, el ticket impreso y el PDF.
 *
 * POR QUÉ EXISTE. El 22/10/2026 Carla (Encanto) mandó por WhatsApp una venta
 * fiada de $172.700 con entrega de $70.000. El mensaje listaba renglones que
 * sumaban $157.000 —el recargo de cuenta corriente no aparecía en ningún
 * lado— y cerraba en negrita con "Anticipo cobrado" y "Saldo pendiente", sin
 * vencimiento: se leyó como un aviso de saldo y no como la venta. Terminó en
 * un cobro cargado por error y una anulación.
 *
 * Dos decisiones:
 * - El recargo por fiar es un renglón propio antes del total, para que los
 *   números cierren. Con plan en cuotas es el interés del plan.
 * - El cierre dice lo que pasó en palabras de mostrador: cuánto pagó al
 *   comprar y cuánto queda en su cuenta, con el vencimiento. Con plan no va
 *   vencimiento: cada cuota trae el suyo.
 */

/** Menos de cinco centavos es cero: mismo umbral que `getTicketFinancialSummary`. */
const PESO_MINIMO = 0.05;

export function etiquetaRecargoCuentaCorriente(datos: {
  recargoCcPorcentaje?: number | null;
  planCuotas?: { cuotas: number; pct: number } | null;
}): string {
  if (datos.planCuotas) {
    return `Financiación ${datos.planCuotas.cuotas} cuotas (${formatearPorcentaje(datos.planCuotas.pct)}%)`;
  }
  const pct = Number(datos.recargoCcPorcentaje ?? 0);
  return pct > 0
    ? `Recargo cuenta corriente (${formatearPorcentaje(pct)}%)`
    : "Recargo cuenta corriente";
}

export interface LineaCuentaCorriente {
  etiqueta: string;
  monto: number;
  /** "vence el 21/11/2026", o null. */
  detalle: string | null;
}

/**
 * Las líneas del cierre de un comprobante fiado. "Pagó al comprar" solo si
 * entró plata: en un fiado entero, "$0" es ruido.
 */
export function lineasCuentaCorriente(datos: {
  montoCobrado: number;
  montoPendiente: number;
  /** "YYYY-MM-DD", la fecha de vencimiento de la venta. */
  venceEl?: string | null;
  tienePlanCuotas?: boolean;
}): LineaCuentaCorriente[] {
  const lineas: LineaCuentaCorriente[] = [];
  if (datos.montoCobrado > PESO_MINIMO) {
    lineas.push({ etiqueta: "Pagó al comprar", monto: datos.montoCobrado, detalle: null });
  }
  lineas.push({
    etiqueta: "Queda en su cuenta",
    monto: datos.montoPendiente,
    detalle:
      datos.venceEl && !datos.tienePlanCuotas
        ? `vence el ${fechaDiaMesAnio(datos.venceEl)}`
        : null,
  });
  return lineas;
}

/** "2026-11-21" (o un timestamp que empiece así) → "21/11/2026". */
function fechaDiaMesAnio(fecha: string): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-");
  return `${dia}/${mes}/${anio}`;
}

function formatearPorcentaje(pct: number): string {
  return Number(pct).toLocaleString("es-AR", { maximumFractionDigits: 2 });
}
