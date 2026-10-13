import { describe, expect, it } from "vitest";
import { leerPrecioTipeado, precioEfectivo } from "./precio-efectivo";

describe("precio efectivo", () => {
  it("el acordado manda; sin acordar, el de lista", () => {
    expect(precioEfectivo(30000, 50000)).toBe(30000);
    expect(precioEfectivo(null, 50000)).toBe(50000);
    expect(precioEfectivo(undefined, 50000)).toBe(50000);
  });
  it("0 acordado es cortesía, no 'sin acordar'", () => {
    expect(precioEfectivo(0, 50000)).toBe(0);
  });
});

describe("leer el precio tipeado", () => {
  it("acepta puntos de miles, $ y coma decimal", () => {
    expect(leerPrecioTipeado("30.000")).toBe(30000);
    expect(leerPrecioTipeado("$ 30000")).toBe(30000);
    expect(leerPrecioTipeado("30000,5")).toBe(30000.5);
  });
  it("vacío vuelve al precio de lista; basura no es un precio", () => {
    expect(leerPrecioTipeado("  ")).toBeNull();
    expect(leerPrecioTipeado("treinta")).toBeUndefined();
    expect(leerPrecioTipeado("-5")).toBeUndefined();
  });
});
