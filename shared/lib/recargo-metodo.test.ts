import { describe, expect, it } from "vitest";
import {
  calcularPagosConRecargo,
  calcularRecargoMonto,
  etiquetaRecargo,
} from "./recargo-metodo";

const EFECTIVO = { id: "efec", nombre: "Efectivo", recargo_porcentaje: 0 };
const TARJETA = { id: "tarj", nombre: "Tarjeta", recargo_porcentaje: 15 };
const METODOS = [EFECTIVO, TARJETA];

describe("calcularRecargoMonto", () => {
  it("redondea al peso entero", () => {
    // 9.500 * 15% = 1.425 exacto; 9.505 * 15% = 1.425,75 -> 1.426
    expect(calcularRecargoMonto(9500, 15)).toBe(1425);
    expect(calcularRecargoMonto(9505, 15)).toBe(1426);
  });

  it("no cobra recargo sin porcentaje ni sobre base cero", () => {
    expect(calcularRecargoMonto(10000, 0)).toBe(0);
    expect(calcularRecargoMonto(0, 15)).toBe(0);
  });

  it("trata valores nulos o inválidos como sin recargo", () => {
    expect(calcularRecargoMonto(10000, NaN)).toBe(0);
    expect(calcularRecargoMonto(NaN, 15)).toBe(0);
  });
});

describe("calcularPagosConRecargo", () => {
  it("aplica el recargo solo a la porción del método que lo tiene", () => {
    const totales = calcularPagosConRecargo(
      [
        { metodoPagoId: "efec", montoAsignado: 5000 },
        { metodoPagoId: "tarj", montoAsignado: 5000 },
      ],
      METODOS,
    );

    expect(totales.totalBase).toBe(10000);
    expect(totales.totalRecargo).toBe(750);
    expect(totales.totalACobrar).toBe(10750);
    expect(totales.pagos[0].montoBruto).toBe(5000);
    expect(totales.pagos[1].montoBruto).toBe(5750);
  });

  it("mantiene la invariante monto_bruto = base + recargo en cada pago", () => {
    const { pagos } = calcularPagosConRecargo(
      [{ metodoPagoId: "tarj", montoAsignado: 12345 }],
      METODOS,
    );

    expect(pagos[0].montoBruto).toBe(pagos[0].montoBase + pagos[0].recargoMonto);
  });

  it("elimina residuos binarios de una venta fraccionada antes de persistir", () => {
    const { pagos } = calcularPagosConRecargo(
      [{ metodoPagoId: "tarj", montoAsignado: (0.1 + 0.2) * 100 }],
      METODOS,
    );

    expect(pagos[0]).toMatchObject({
      montoBase: 30,
      recargoMonto: 5,
      montoBruto: 35,
    });
    expect(pagos[0].montoBruto).toBe(
      pagos[0].montoBase + pagos[0].recargoMonto,
    );
  });

  it("trata un método desconocido como sin recargo, sin romper la venta", () => {
    const totales = calcularPagosConRecargo(
      [{ metodoPagoId: "metodo-borrado", montoAsignado: 8000 }],
      METODOS,
    );

    expect(totales.totalRecargo).toBe(0);
    expect(totales.totalACobrar).toBe(8000);
  });

  it("acepta montos que llegan como string desde el formulario", () => {
    const totales = calcularPagosConRecargo(
      [{ metodoPagoId: "tarj", montoAsignado: "1000" }],
      METODOS,
    );

    expect(totales.totalRecargo).toBe(150);
  });
});

describe("etiquetaRecargo", () => {
  it("nombra el método cuando hay uno solo con recargo", () => {
    const { pagos } = calcularPagosConRecargo(
      [
        { metodoPagoId: "efec", montoAsignado: 5000 },
        { metodoPagoId: "tarj", montoAsignado: 5000 },
      ],
      METODOS,
    );

    expect(etiquetaRecargo(pagos, METODOS)).toBe("Recargo Tarjeta (15%)");
  });

  it("agrupa cuando hay varios métodos con recargo", () => {
    const metodos = [
      TARJETA,
      { id: "mp", nombre: "Mercado Pago", recargo_porcentaje: 5 },
    ];
    const { pagos } = calcularPagosConRecargo(
      [
        { metodoPagoId: "tarj", montoAsignado: 1000 },
        { metodoPagoId: "mp", montoAsignado: 1000 },
      ],
      metodos,
    );

    expect(etiquetaRecargo(pagos, metodos)).toBe("Recargo por método de pago");
  });

  it("no devuelve etiqueta si nadie cobró recargo", () => {
    const { pagos } = calcularPagosConRecargo(
      [{ metodoPagoId: "efec", montoAsignado: 5000 }],
      METODOS,
    );

    expect(etiquetaRecargo(pagos, METODOS)).toBe("");
  });
});
