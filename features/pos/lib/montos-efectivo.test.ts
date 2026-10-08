import { describe, expect, it } from "vitest";
import { montosRapidosEfectivo } from "./montos-efectivo";

describe("montos rápidos de efectivo", () => {
  it("propone importes redondos por encima del cobro", () => {
    expect(montosRapidosEfectivo(3700)).toEqual([4000, 5000, 10000, 20000]);
  });
  it("no repite el importe justo y contempla centavos", () => {
    expect(montosRapidosEfectivo(5000)).toEqual([6000, 10000, 20000, 50000]);
    expect(montosRapidosEfectivo(4000.5)[0]).toBe(5000);
  });
  it("ofrece cuatro importes distintos también para tickets grandes", () => {
    const montos = montosRapidosEfectivo(2500000);
    expect(montos).toHaveLength(4);
    expect(new Set(montos).size).toBe(4);
    expect(montos.every((monto) => monto > 2500000)).toBe(true);
  });
  it("descarta totales inválidos", () => {
    expect(montosRapidosEfectivo(NaN)).toEqual([]);
    expect(montosRapidosEfectivo(-1)).toEqual([]);
  });
});
