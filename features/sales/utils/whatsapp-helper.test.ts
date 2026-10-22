import { describe, expect, it } from "vitest";
import type { ConfiguracionPOS } from "@/entities/config/types";
import type { TicketData } from "@/entities/ventas/types";
import { buildWhatsappMessage } from "./whatsapp-helper";

const config = { posName: "Encanto", mensaje_ticket: "¡Gracias!" } as ConfiguracionPOS;

/** La venta de Encanto del 22/10/2026: fiada con entrega y 10% de recargo. */
const ventaEncanto: TicketData = {
  items: [
    { nombre: "Bermuda Blanca Cruzada", variante: "Blanco / 40", cantidad: 1, precioUnitario: 33000 },
    { nombre: "Babucha Rústica", variante: "40", cantidad: 1, precioUnitario: 58000 },
    { nombre: "Cinto", variante: "", cantidad: 1, precioUnitario: 20000 },
    { nombre: "Remera lunares", variante: "", cantidad: 1, precioUnitario: 24000 },
    { nombre: "Remera cangrejo", variante: "", cantidad: 1, precioUnitario: 22000 },
  ],
  total: 172700,
  metodoPago: "Efectivo",
  nroRecibo: "00001-00000009",
  fecha: "22/10/26 09:41",
  recargoCcMonto: 15700,
  recargoCcPorcentaje: 10,
  venceEl: "2026-11-21",
  estadoPago: "PARCIAL",
  montoCobrado: 70000,
  montoPendiente: 102700,
  esFiadoDirecto: true,
};

describe("buildWhatsappMessage", () => {
  const mensaje = buildWhatsappMessage(ventaEncanto, config, 157000);

  it("muestra el recargo de cuenta corriente para que los renglones cierren con el total", () => {
    expect(mensaje).toContain("Subtotal: $157.000");
    expect(mensaje).toContain("Recargo cuenta corriente (10%): +$15.700");
    expect(mensaje).toContain("*TOTAL COMPROBANTE: $172.700*");
  });

  it("cierra con lo que pagó y lo que queda, con vencimiento", () => {
    expect(mensaje).toContain("Pagó al comprar: $70.000");
    expect(mensaje).toContain("Queda en su cuenta: $102.700 (vence el 21/11/2026)");
    expect(mensaje).not.toContain("Saldo pendiente");
  });

  it("la venta libre sale sin paréntesis vacíos", () => {
    expect(mensaje).toContain("1x Cinto\n");
    expect(mensaje).not.toContain("()");
  });

  it("una venta pagada sin recargos no agrega subtotal", () => {
    const pagada = buildWhatsappMessage(
      { items: ventaEncanto.items.slice(0, 1), total: 33000, metodoPago: "Efectivo", nroRecibo: "1" },
      config,
      33000,
    );
    expect(pagada).not.toContain("Subtotal");
    expect(pagada).toContain("*Medio de pago:* Efectivo");
  });
});
