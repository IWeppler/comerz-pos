import { describe, expect, it } from "vitest";
import {
  calcularOpcion,
  leerTasas,
  opcionesDeFinanciacion,
  validarTasas,
} from "./cuotas";

describe("calcularOpcion", () => {
  it("sin recargo reparte el total y el centavo que sobra va a la última cuota", () => {
    const o = calcularOpcion(10_000, { cuotas: 3, pct: 0 });
    expect(o.montoCuota).toBe(3333.33);
    expect(o.ultimaCuota).toBe(3333.34);
    expect(o.montoCuota * 2 + o.ultimaCuota).toBeCloseTo(10_000, 2);
    expect(o.totalFinal).toBe(10_000);
  });

  it("el recargo va sobre lo financiado, no sobre el anticipo", () => {
    const o = calcularOpcion(100_000, { cuotas: 4, pct: 10 }, 20_000);
    expect(o.financiado).toBe(80_000);
    expect(o.recargo).toBe(8_000);
    expect(o.totalFinanciado).toBe(88_000);
    expect(o.montoCuota).toBe(22_000);
    expect(o.ultimaCuota).toBe(22_000);
    expect(o.totalFinal).toBe(108_000);
  });

  it("redondea el recargo al centavo", () => {
    const o = calcularOpcion(999.99, { cuotas: 1, pct: 12.5 });
    expect(o.recargo).toBe(125);
    expect(o.ultimaCuota).toBe(1124.99);
  });

  it("un anticipo mayor que el total no deja nada financiado ni negativo", () => {
    const o = calcularOpcion(5_000, { cuotas: 3, pct: 10 }, 9_000);
    expect(o.anticipo).toBe(5_000);
    expect(o.financiado).toBe(0);
    expect(o.montoCuota).toBe(0);
    expect(o.totalFinal).toBe(5_000);
  });

  it("la suma de las cuotas es exacta con montos que no dividen", () => {
    const o = calcularOpcion(8_900, { cuotas: 7, pct: 15 });
    const suma = Math.round((o.montoCuota * 6 + o.ultimaCuota) * 100);
    expect(suma).toBe(Math.round(o.totalFinanciado * 100));
    expect(o.ultimaCuota).toBeGreaterThanOrEqual(o.montoCuota);
  });
});

describe("leerTasas", () => {
  it("ordena por cuotas y descarta lo que no tiene forma de tasa", () => {
    expect(
      leerTasas([
        { cuotas: 6, pct: 20 },
        { cuotas: 3, pct: 10 },
        { cuotas: 1.5, pct: 1 },
        { cuotas: 2, pct: -1 },
        "basura",
      ]),
    ).toEqual([
      { cuotas: 3, pct: 10 },
      { cuotas: 6, pct: 20 },
    ]);
  });

  it("un jsonb que no es array es sin financiación", () => {
    expect(leerTasas(null)).toEqual([]);
    expect(leerTasas({ cuotas: 3 })).toEqual([]);
  });

  it("opcionesDeFinanciacion arma una opción por tasa", () => {
    const o = opcionesDeFinanciacion(1_000, [{ cuotas: 2, pct: 0 }]);
    expect(o).toHaveLength(1);
    expect(o[0].montoCuota).toBe(500);
  });
});

describe("validarTasas", () => {
  it("acepta, redondea el porcentaje y ordena", () => {
    expect(
      validarTasas([
        { cuotas: "6", pct: "20.555" },
        { cuotas: 3, pct: 0 },
      ]),
    ).toEqual({
      ok: true,
      tasas: [
        { cuotas: 3, pct: 0 },
        { cuotas: 6, pct: 20.56 },
      ],
    });
  });

  it("vacío es válido: el negocio no financia", () => {
    expect(validarTasas([])).toEqual({ ok: true, tasas: [] });
  });

  it("nombra la fila mala en vez de descartarla", () => {
    const r = validarTasas([{ cuotas: 3, pct: 10 }, { cuotas: 0, pct: 5 }]);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Fila 2") });
  });

  it("rechaza cuotas repetidas, fraccionadas y porcentajes negativos", () => {
    expect(validarTasas([{ cuotas: 3, pct: 1 }, { cuotas: 3, pct: 2 }]).ok).toBe(false);
    expect(validarTasas([{ cuotas: 2.5, pct: 1 }]).ok).toBe(false);
    expect(validarTasas([{ cuotas: 2, pct: -1 }]).ok).toBe(false);
    expect(validarTasas([{ cuotas: 2, pct: "abc" }]).ok).toBe(false);
    expect(validarTasas("nada").ok).toBe(false);
  });
});
