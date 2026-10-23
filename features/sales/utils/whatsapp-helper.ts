import { ConfiguracionPOS } from "@/entities/config/types";
import { TicketData } from "@/entities/ventas/types";
import { etiquetaRecargoLibre } from "@/features/sales/lib/recargo-libre-ticket";
import {
  formatTicketMoney,
  getTicketFinancialSummary,
} from "../ui/ticket-utils";
import {
  fechaCorta,
  numeroComprobanteFiscal,
  tituloComprobante,
} from "@/shared/lib/comprobante-fiscal-ticket";
import {
  etiquetaRecargoCuentaCorriente,
  lineasCuentaCorriente,
} from "../lib/cuenta-corriente-ticket";

export function buildWhatsappMessage(
  ticket: TicketData,
  config: ConfiguracionPOS | null,
  subtotal: number,
) {
  const nombreComercio = config?.posName || "Mi Comercio";
  const mensajeDespedida = config?.mensaje_ticket || "Gracias por su compra!";
  const { esFiado, montoCobrado, montoPendiente, pagosDesglosados } =
    getTicketFinancialSummary(ticket);

  let mensaje = `*${nombreComercio.toUpperCase()}*\n\n`;
  if (ticket.fiscal) {
    mensaje += `*${tituloComprobante(ticket.fiscal.tipo)}:* ${numeroComprobanteFiscal(ticket.fiscal)}\n`;
    mensaje += `*CAE:* ${ticket.fiscal.cae} (vto. ${fechaCorta(ticket.fiscal.caeVencimiento)})\n`;
  } else {
    mensaje += `*Comprobante:* #${ticket.nroRecibo}\n`;
  }
  mensaje += `*Fecha:* ${
    ticket.fecha ||
    new Date().toLocaleString("es-AR", {
      dateStyle: "short",
      timeStyle: "short",
    })
  }\n`;
  mensaje += `--------------------------------\n`;

  ticket.items.forEach((item) => {
    const precioUnitario = item.precioUnitario || item.precio || 0;
    // La venta libre llega con variante vacía: sin paréntesis vacíos.
    mensaje += item.variante
      ? `${item.cantidad}x ${item.nombre} (${item.variante})\n`
      : `${item.cantidad}x ${item.nombre}\n`;
    if (item.imei) mensaje += `   IMEI: ${item.imei}\n`;
    mensaje += `   ${formatTicketMoney(precioUnitario * item.cantidad)}\n`;
  });

  // Todo lo que separa la suma de los renglones del total va como renglón
  // propio: si no, los números no cierran (ver cuenta-corriente-ticket.ts).
  const hayDescuento = (ticket.descuentoMonto ?? 0) > 0;
  const hayRecargoMetodo = (ticket.recargoMetodoMonto ?? 0) > 0;
  const hayRecargoCc = (ticket.recargoCcMonto ?? 0) > 0;
  const hayRecargoLibre = (ticket.recargoLibreMonto ?? 0) > 0;
  if (hayDescuento || hayRecargoMetodo || hayRecargoCc || hayRecargoLibre) {
    mensaje += `--------------------------------\n`;
    mensaje += `Subtotal: ${formatTicketMoney(subtotal)}\n`;
  }
  if (hayDescuento) {
    mensaje += `Descuento (${ticket.promocionNombre}): -${formatTicketMoney(ticket.descuentoMonto)}\n`;
  }
  if (hayRecargoMetodo) {
    mensaje += `${ticket.recargoMetodoEtiqueta || "Recargo método de pago"}: +${formatTicketMoney(ticket.recargoMetodoMonto)}\n`;
  }
  if (hayRecargoCc) {
    mensaje += `${etiquetaRecargoCuentaCorriente(ticket)}: +${formatTicketMoney(ticket.recargoCcMonto)}\n`;
  }
  if (hayRecargoLibre) {
    mensaje += `${etiquetaRecargoLibre(ticket)}: +${formatTicketMoney(ticket.recargoLibreMonto)}\n`;
  }

  mensaje += `--------------------------------\n`;
  // Con qué lista se cobró. Va ANTES del total porque es lo que lo explica;
  // en una venta a precio base no se escribe nada.
  if (ticket.listaPrecioNombre) {
    mensaje += `Lista: ${ticket.listaPrecioNombre}\n`;
  }
  mensaje += `*TOTAL COMPROBANTE: ${formatTicketMoney(ticket.total)}*\n`;

  if (esFiado) {
    mensaje += `\n`;
    lineasCuentaCorriente({
      montoCobrado,
      montoPendiente,
      venceEl: ticket.venceEl,
      tienePlanCuotas: !!ticket.planCuotas,
    }).forEach((l) => {
      mensaje += `${l.etiqueta}: ${formatTicketMoney(l.monto)}${l.detalle ? ` (${l.detalle})` : ""}\n`;
    });
    if (ticket.planCuotas) {
      mensaje += `\n*${ticket.planCuotas.cuotas} cuotas* (incluye ${ticket.planCuotas.pct}% de financiación):\n`;
      ticket.planCuotas.detalle.forEach((c) => {
        mensaje += `${c.numero}. vence ${c.venceEl.split("-").reverse().join("/")}: ${formatTicketMoney(c.monto)}\n`;
      });
    }
  } else if (pagosDesglosados.length > 0) {
    mensaje += `\n*Medios de pago:*\n`;
    pagosDesglosados.forEach((p) => {
      mensaje += `- ${p.nombre}: ${formatTicketMoney(p.monto)}\n`;
    });
  } else {
    mensaje += `*Medio de pago:* ${ticket.metodoPago}\n`;
  }

  mensaje += `\n${mensajeDespedida}`;

  return mensaje;
}
