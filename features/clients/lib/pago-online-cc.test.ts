import { describe, expect, it } from "vitest";
import { descripcionMora, opcionesPagoCc } from "./pago-online-cc";

describe("opcionesPagoCc", () => {
  it("con algo vencido y algo por vencer: lo vencido y todo, mora en los dos", () => {
    expect(opcionesPagoCc({ saldo: 100000, vencido: 30000, mora: 4500, montoCiclo: null })).toEqual([
      { alcance: "VENCIDO", etiqueta: "Pagar lo vencido", capital: 30000, mora: 4500, total: 34500 },
      { alcance: "TOTAL", etiqueta: "Pagar todo", capital: 100000, mora: 4500, total: 104500 },
    ]);
  });

  it("sin nada vencido, o con todo vencido, un solo botón", () => {
    expect(opcionesPagoCc({ saldo: 50000, vencido: 0, mora: 0, montoCiclo: null }).map((o) => o.alcance)).toEqual([
      "TOTAL",
    ]);
    expect(opcionesPagoCc({ saldo: 50000, vencido: 50000, mora: 7500, montoCiclo: null })).toEqual([
      { alcance: "TOTAL", etiqueta: "Pagar todo", capital: 50000, mora: 7500, total: 57500 },
    ]);
  });

  it("con cierre mensual el parcial es lo del mes", () => {
    const [parcial] = opcionesPagoCc({ saldo: 316950, vencido: 0, mora: 0, montoCiclo: 14800 });
    expect(parcial).toMatchObject({ alcance: "CICLO", etiqueta: "Pagar lo del mes", total: 14800 });
  });

  it("sin deuda o con saldo a favor no hay botón", () => {
    expect(opcionesPagoCc({ saldo: 0, vencido: 0, mora: 0, montoCiclo: null })).toEqual([]);
    expect(opcionesPagoCc({ saldo: -2000, vencido: 0, mora: 0, montoCiclo: null })).toEqual([]);
  });

  it("lo vencido nunca supera el saldo", () => {
    expect(opcionesPagoCc({ saldo: 1000, vencido: 5000, mora: 0, montoCiclo: null })).toHaveLength(1);
  });
});

describe("descripcionMora", () => {
  it("dice sobre qué se calculó", () => {
    expect(
      descripcionMora({ recargo_mora_tipo: "PORCENTAJE", recargo_mora_valor: 15, recargo_mora_base: "PORCION_VENCIDA" }),
    ).toBe("Recargo por mora (15% sobre la deuda vencida)");
    expect(descripcionMora({ recargo_mora_tipo: "PORCENTAJE", recargo_mora_valor: 10 })).toBe(
      "Recargo por mora (10% sobre el saldo adeudado)",
    );
    expect(descripcionMora({ recargo_mora_tipo: "MONTO_FIJO", recargo_mora_valor: 500 })).toBe(
      "Recargo por mora (monto fijo por venta vencida)",
    );
  });
});
