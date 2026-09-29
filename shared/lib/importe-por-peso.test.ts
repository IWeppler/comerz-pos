import { describe, it, expect } from "vitest";
import {
  cantidadParaImporte,
  importeDentroDeMargen,
  toleranciaImporte,
} from "./importe-por-peso";

describe("venta por importe de un producto por peso", () => {
  it("el caso que lo motivó: $1000 a $8.600/kg", () => {
    const cantidad = cantidadParaImporte(1000, 8600);
    // 116,28 g → 116 g, el gramo más cercano.
    expect(cantidad).toBe(0.116);
    // Cobrar exacto $1000 por 116 g está dentro del margen de un gramo.
    expect(importeDentroDeMargen(1000, cantidad!, 8600)).toBe(true);
  });

  it("el gramo más cercano siempre cae dentro del margen", () => {
    for (const precio of [450, 1200, 8600, 23999, 150000]) {
      for (const importe of [100, 1000, 2500, 7777]) {
        const cantidad = cantidadParaImporte(importe, precio);
        if (cantidad === null) continue;
        expect(importeDentroDeMargen(importe, cantidad, precio)).toBe(true);
      }
    }
  });

  it("un importe que no corresponde al peso se rechaza (el request modificado)", () => {
    // 116 g a $8.600 son $997,6: cobrar $1500 no es "leve margen".
    expect(importeDentroDeMargen(1500, 0.116, 8600)).toBe(false);
  });

  it("el margen es lo que vale un gramo, con piso de $1", () => {
    expect(toleranciaImporte(8600)).toBeCloseTo(8.6);
    expect(toleranciaImporte(450)).toBe(1);
  });

  it("un importe menor que un gramo no da peso vendible", () => {
    // $2 de algo a $8.600/kg son 0,23 g: redondea a cero.
    expect(cantidadParaImporte(2, 8600)).toBeNull();
  });

  it("datos inválidos no pasan", () => {
    expect(cantidadParaImporte(0, 8600)).toBeNull();
    expect(cantidadParaImporte(1000, 0)).toBeNull();
    expect(importeDentroDeMargen(1000, 0, 8600)).toBe(false);
  });
});
