import { describe, expect, it } from "vitest";
import type { TicketData } from "@/entities/ventas/types";
import { resumirVentaExitosa } from "./resumen-venta-exitosa";

const base: TicketData = {
  items: [
    { nombre: "Remera", variante: "M", cantidad: 3, precioUnitario: 5000 },
    { nombre: "Jean", variante: "40", cantidad: 2, precioUnitario: 1725 },
  ],
  total: 18450,
  metodoPago: "Efectivo",
  nroRecibo: "000184",
  clienteNombre: "Juan Pérez",
};

describe("resumirVentaExitosa", () => {
  it("venta pagada: título, total y ninguna segunda línea", () => {
    // "Cobrado $18.450" abajo de "$18.450" sería decir lo mismo dos veces.
    const r = resumirVentaExitosa({ ...base, estadoPago: "PAGADA" });
    expect(r.titulo).toBe("Venta realizada");
    expect(r.total).toBe("$18.450");
    expect(r.detalleCobro).toBeNull();
    expect(r.quedaPendiente).toBe(false);
  });

  it("venta parcialmente cobrada: cuánto entró y cuánto queda", () => {
    const r = resumirVentaExitosa({
      ...base,
      estadoPago: "PARCIAL",
      esFiadoDirecto: true,
      montoCobrado: 5450,
      montoPendiente: 13000,
    });
    expect(r.titulo).toBe("Venta realizada");
    expect(r.detalleCobro).toBe("Cobrado $5.450 · Queda $13.000");
    expect(r.quedaPendiente).toBe(true);
  });

  it("venta fiada entera: se REGISTRÓ, no se realizó", () => {
    // No entró plata: la palabra tiene que decirlo.
    const r = resumirVentaExitosa({
      ...base,
      estadoPago: "PENDIENTE",
      esFiadoDirecto: true,
      montoCobrado: 0,
      montoPendiente: 18450,
    });
    expect(r.titulo).toBe("Venta registrada");
    expect(r.contexto).toBe("5 artículos · Cuenta corriente");
    expect(r.detalleCobro).toBe("Queda pendiente $18.450");
    expect(r.quedaPendiente).toBe(true);
  });

  it("cuenta UNIDADES, no renglones", () => {
    // 3 + 2 = 5 artículos en 2 renglones: la trampa de `ventas.cantidad`.
    const r = resumirVentaExitosa(base);
    expect(r.contexto).toBe("5 artículos · Efectivo");
    expect(r.comprobante).toBe("#000184");
  });

  it("con una línea fraccionada cae a productos", () => {
    const r = resumirVentaExitosa({
      ...base,
      items: [{ nombre: "Jamón", variante: "", cantidad: 0.75 }],
      clienteNombre: undefined,
    });
    expect(r.contexto).toBe("1 producto · Efectivo");
  });

  it("con factura, el contexto dice la letra y el número, no el recibo", () => {
    const r = resumirVentaExitosa({
      ...base,
      fiscal: {
        tipo: "FACTURA_B",
        puntoVenta: 1,
        numero: 123,
        cae: "1",
        caeVencimiento: "2026-09-30",
        fechaComprobante: "2026-09-17",
        ambiente: "PRODUCCION",
        emisor: { razonSocial: "X", cuit: "1", condicionIva: "RI" },
        receptor: { razonSocial: null, docTipo: 99, docNro: "0", condicionIva: "CF" },
        neto: 1,
        ivaMonto: 0,
      } as unknown as TicketData["fiscal"],
    });
    expect(r.comprobante).toBe("FACTURA B 00001-00000123");
  });
});
