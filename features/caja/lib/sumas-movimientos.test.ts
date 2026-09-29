import { describe, expect, it } from "vitest";
import { hayQueDesglosar, sumasDe } from "./sumas-movimientos";

describe("sumasDe", () => {
  it("toma las sumas que manda la base (los cobros del sábado 26 en Evens)", () => {
    expect(
      sumasDe({
        importe_total: 1199022.5,
        importe_entradas: 1210022.5,
        importe_salidas: -11000,
      }),
    ).toEqual({ neto: 1199022.5, entradas: 1210022.5, salidas: -11000 });
  });

  it("acepta numeric como texto, que es como puede llegar de PostgREST", () => {
    expect(sumasDe({ importe_total: "100", importe_entradas: "100", importe_salidas: "0" }))
      .toEqual({ neto: 100, entradas: 100, salidas: 0 });
  });

  it("sin las sumas de la base no inventa un total", () => {
    expect(sumasDe({})).toBeNull();
    expect(sumasDe(null)).toBeNull();
  });
});

describe("hayQueDesglosar", () => {
  it("todo para el mismo lado: alcanza con el total", () => {
    expect(hayQueDesglosar({ neto: 500, entradas: 500, salidas: 0 })).toBe(false);
    expect(hayQueDesglosar({ neto: -300, entradas: 0, salidas: -300 })).toBe(false);
  });

  it("entradas y salidas mezcladas: se muestran las tres", () => {
    expect(hayQueDesglosar({ neto: 0, entradas: 40000, salidas: -40000 })).toBe(true);
  });
});
