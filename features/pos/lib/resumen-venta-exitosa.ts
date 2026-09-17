import type { TicketData } from "@/entities/ventas/types";
import { getTicketFinancialSummary } from "@/features/sales/ui/ticket-utils";
import {
  numeroComprobanteFiscal,
  tituloComprobante,
} from "@/shared/lib/comprobante-fiscal-ticket";

const formatearPesos = (valor: number) =>
  `$${Number(valor || 0).toLocaleString("es-AR")}`;

/** Menos de cinco centavos es cero: mismo umbral que `getTicketFinancialSummary`. */
const PESO_MINIMO = 0.05;

export type ResumenVentaExitosa = {
  /**
   * "Venta realizada" cuando entró plata —toda o parte— y "Venta registrada"
   * cuando no entró nada. La palabra importa: una venta fiada entera no se
   * "realizó" en el sentido de la caja, se anotó.
   */
  titulo: string;
  /** El total del ticket, con recargos adentro. Es el número grande. */
  total: string;
  /**
   * La segunda línea, SOLO cuando hay algo que decir además del total:
   * cuánto entró y cuánto quedó debiendo. En una venta pagada es null —
   * "Cobrado $18.450" abajo de "$18.450" es decir lo mismo dos veces.
   */
  detalleCobro: string | null;
  /** Hay saldo que la clienta todavía debe. Decide el color del estado. */
  quedaPendiente: boolean;
  /** "5 artículos · Efectivo": qué se llevó y cómo pagó, para leer de reojo. */
  contexto: string;
  /** "Factura B 00001-00000123" o "#000184": lo que se le dice al cliente. */
  comprobante: string;
};

/**
 * Lo que se muestra al terminar una venta, y nada más.
 *
 * Es la contraparte de `getTicketFinancialSummary` para la pantalla de éxito
 * del POS: esa función dice cuánto se cobró y cuánto queda; esta decide qué de
 * eso merece estar en la pantalla que la vendedora ve entre venta y venta. Tres
 * casos, en orden de cuánto hay que leer:
 *
 * - Pagada: título + total. No hay segunda línea.
 * - Parcial: título + total + "Cobrado X · Queda Y".
 * - Fiada entera: título distinto ("registrada") + total + "Queda pendiente X".
 *
 * Es pura para poder testearla contra los tres casos sin montar nada.
 */
export function resumirVentaExitosa(ticket: TicketData): ResumenVentaExitosa {
  const { montoCobrado, montoPendiente } = getTicketFinancialSummary(ticket);
  const quedaPendiente = montoPendiente > PESO_MINIMO;
  const entroPlata = montoCobrado > PESO_MINIMO;

  let detalleCobro: string | null = null;
  if (quedaPendiente && entroPlata) {
    detalleCobro = `Cobrado ${formatearPesos(montoCobrado)} · Queda ${formatearPesos(montoPendiente)}`;
  } else if (quedaPendiente) {
    detalleCobro = `Queda pendiente ${formatearPesos(montoPendiente)}`;
  }

  return {
    titulo: quedaPendiente && !entroPlata ? "Venta registrada" : "Venta realizada",
    total: formatearPesos(ticket.total),
    detalleCobro,
    quedaPendiente,
    // Con fiado entero no entró plata por ningún método: `metodoPago` trae el
    // que quedó seleccionado en el paso de pago, que no es cómo se pagó.
    contexto: `${describirArticulos(ticket)} · ${
      quedaPendiente && !entroPlata ? "Cuenta corriente" : ticket.metodoPago
    }`,
    comprobante: ticket.fiscal
      ? `${tituloComprobante(ticket.fiscal.tipo)} ${numeroComprobanteFiscal(ticket.fiscal)}`
      : `#${ticket.nroRecibo}`,
  };
}

/**
 * UNIDADES, no renglones: tres remeras en una línea son 3 artículos. Es la
 * misma trampa de `ventas.cantidad` (ver CLAUDE.md), que durante meses guardó
 * `items.length`. Si alguna línea es fraccionada (0,75 kg), contar "artículos"
 * no tiene sentido y se cae a la cantidad de productos.
 */
function describirArticulos(ticket: TicketData): string {
  const unidades = ticket.items.reduce((acc, item) => acc + item.cantidad, 0);
  if (!Number.isInteger(unidades)) {
    const n = ticket.items.length;
    return `${n} ${n === 1 ? "producto" : "productos"}`;
  }
  return `${unidades} ${unidades === 1 ? "artículo" : "artículos"}`;
}
