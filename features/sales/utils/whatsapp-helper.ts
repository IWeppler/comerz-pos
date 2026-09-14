import { ConfiguracionPOS } from "@/entities/config/types";
import { TicketData } from "@/entities/ventas/types";
import {
  formatTicketMoney,
  getTicketFinancialSummary,
} from "../ui/ticket-utils";
import {
  fechaCorta,
  numeroComprobanteFiscal,
  tituloComprobante,
} from "@/shared/lib/comprobante-fiscal-ticket";

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
    mensaje += `${item.cantidad}x ${item.nombre} (${item.variante})\n`;
    mensaje += `   ${formatTicketMoney(precioUnitario * item.cantidad)}\n`;
  });

  if (ticket.descuentoMonto && ticket.descuentoMonto > 0) {
    mensaje += `--------------------------------\n`;
    mensaje += `Subtotal: ${formatTicketMoney(subtotal)}\n`;
    mensaje += `Descuento (${ticket.promocionNombre}): -${formatTicketMoney(ticket.descuentoMonto)}\n`;
  }

  mensaje += `--------------------------------\n`;
  // Con qué lista se cobró. Va ANTES del total porque es lo que lo explica;
  // en una venta a precio base no se escribe nada.
  if (ticket.listaPrecioNombre) {
    mensaje += `Lista: ${ticket.listaPrecioNombre}\n`;
  }
  mensaje += `*TOTAL COMPROBANTE: ${formatTicketMoney(ticket.total)}*\n`;

  if (esFiado) {
    mensaje += `*Anticipo cobrado:* ${formatTicketMoney(montoCobrado)}\n`;
    mensaje += `*Saldo pendiente:* ${formatTicketMoney(montoPendiente)}\n`;
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
