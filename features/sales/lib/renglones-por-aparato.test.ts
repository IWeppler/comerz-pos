import { describe, expect, it } from "vitest";
import { renglonesPorAparato } from "./renglones-por-aparato";

const a56 = { nombre: "A56", cantidad: 2, precioFinal: 1000000, descuentoMonto: 0 };
const funda = { nombre: "Funda", cantidad: 3, precioFinal: 5000, descuentoMonto: 0 };

describe("renglonesPorAparato", () => {
  it("deja igual lo que no tiene aparatos", () => {
    expect(renglonesPorAparato([funda], new Map())).toEqual([
      { item: funda, cantidad: 3, unidadSerieId: null },
    ]);
  });

  it("parte dos aparatos iguales en dos renglones de cantidad 1, cada uno con su IMEI", () => {
    const filas = renglonesPorAparato([funda, a56], new Map([[1, ["u1", "u2"]]]));
    expect(filas).toEqual([
      { item: funda, cantidad: 3, unidadSerieId: null },
      { item: a56, cantidad: 1, unidadSerieId: "u1" },
      { item: a56, cantidad: 1, unidadSerieId: "u2" },
    ]);
    // La plata no cambia: precio y descuento son por unidad.
    const total = (fs: typeof filas) =>
      fs.reduce((s, f) => s + f.item.precioFinal * f.cantidad, 0);
    expect(total(filas)).toBe(funda.precioFinal * 3 + a56.precioFinal * 2);
  });

  it("lo que no tiene IMEI queda en un renglón aparte sin unidad", () => {
    const tres = { ...a56, cantidad: 3 };
    expect(renglonesPorAparato([tres], new Map([[0, ["u1"]]]))).toEqual([
      { item: tres, cantidad: 1, unidadSerieId: "u1" },
      { item: tres, cantidad: 2, unidadSerieId: null },
    ]);
  });

  it("frena si llegan más aparatos que unidades vendidas", () => {
    expect(() =>
      renglonesPorAparato([{ ...a56, cantidad: 1 }], new Map([[0, ["u1", "u2"]]])),
    ).toThrow();
  });
});
