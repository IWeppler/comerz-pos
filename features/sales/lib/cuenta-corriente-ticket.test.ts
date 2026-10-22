import { describe, expect, it } from "vitest";
import {
  etiquetaRecargoCuentaCorriente,
  lineasCuentaCorriente,
} from "./cuenta-corriente-ticket";

describe("etiquetaRecargoCuentaCorriente", () => {
  it("dice el porcentaje del recargo por fiar", () => {
    expect(etiquetaRecargoCuentaCorriente({ recargoCcPorcentaje: 10 })).toBe(
      "Recargo cuenta corriente (10%)",
    );
    expect(etiquetaRecargoCuentaCorriente({ recargoCcPorcentaje: 4.8 })).toBe(
      "Recargo cuenta corriente (4,8%)",
    );
  });

  it("sin porcentaje conocido no inventa uno", () => {
    expect(etiquetaRecargoCuentaCorriente({ recargoCcPorcentaje: null })).toBe(
      "Recargo cuenta corriente",
    );
  });

  it("con plan en cuotas es la financiación del plan", () => {
    expect(
      etiquetaRecargoCuentaCorriente({
        recargoCcPorcentaje: 10,
        planCuotas: { cuotas: 3, pct: 15 },
      }),
    ).toBe("Financiación 3 cuotas (15%)");
  });
});

describe("lineasCuentaCorriente", () => {
  it("venta de Encanto: lo que pagó al comprar y lo que queda, con vencimiento", () => {
    expect(
      lineasCuentaCorriente({
        montoCobrado: 70000,
        montoPendiente: 102700,
        venceEl: "2026-11-21",
      }),
    ).toEqual([
      { etiqueta: "Pagó al comprar", monto: 70000, detalle: null },
      { etiqueta: "Queda en su cuenta", monto: 102700, detalle: "vence el 21/11/2026" },
    ]);
  });

  it("fiado entero: no escribe 'Pagó al comprar $0'", () => {
    expect(
      lineasCuentaCorriente({ montoCobrado: 0, montoPendiente: 61600, venceEl: null }),
    ).toEqual([{ etiqueta: "Queda en su cuenta", monto: 61600, detalle: null }]);
  });

  it("con plan en cuotas no lleva vencimiento: cada cuota trae el suyo", () => {
    const [queda] = lineasCuentaCorriente({
      montoCobrado: 0,
      montoPendiente: 90000,
      venceEl: "2026-11-21",
      tienePlanCuotas: true,
    });
    expect(queda.detalle).toBeNull();
  });

  it("acepta un timestamp como vencimiento", () => {
    const [queda] = lineasCuentaCorriente({
      montoCobrado: 0,
      montoPendiente: 1,
      venceEl: "2026-11-21T00:00:00+00:00",
    });
    expect(queda.detalle).toBe("vence el 21/11/2026");
  });
});
