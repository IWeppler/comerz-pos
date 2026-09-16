import { describe, expect, it } from "vitest";
import {
  acumularUnidad,
  etiquetaFraccionado,
  listarFraccionado,
  nuevoAcumuladorUnidades,
} from "./unidades-vendidas";

describe("unidades vendidas: piezas y fraccionado aparte", () => {
  it("el caso de Librería Colores: 1.165 piezas + 0,129 kg + 0,077 kg", () => {
    const acc = nuevoAcumuladorUnidades();
    acumularUnidad(acc, 1165, "UNIDAD");
    acumularUnidad(acc, 0.129, "GRAMO"); // nueces
    acumularUnidad(acc, 0.077, "KG"); // rocklets
    expect(acc.piezas).toBe(1165);
    expect(listarFraccionado(acc)).toEqual([
      { unidad: "GRAMO", cantidad: 0.129 },
      { unidad: "KG", cantidad: 0.077 },
    ]);
  });

  it("sin unidad declarada (null) cuenta como pieza", () => {
    const acc = nuevoAcumuladorUnidades();
    acumularUnidad(acc, 3, null);
    acumularUnidad(acc, 2, undefined);
    expect(acc.piezas).toBe(5);
    expect(listarFraccionado(acc)).toEqual([]);
  });

  it("no suma entre unidades distintas", () => {
    const acc = nuevoAcumuladorUnidades();
    acumularUnidad(acc, 0.5, "KG");
    acumularUnidad(acc, 2, "METRO");
    acumularUnidad(acc, 1.5, "KG");
    expect(listarFraccionado(acc)).toEqual([
      { unidad: "KG", cantidad: 2 },
      { unidad: "METRO", cantidad: 2 },
    ]);
  });

  it("etiqueta: '+ 0,206 kg · 3 m', null si no hay", () => {
    expect(etiquetaFraccionado([])).toBeNull();
    expect(
      etiquetaFraccionado([
        { unidad: "KG", cantidad: 0.206 },
        { unidad: "METRO", cantidad: 3 },
      ]),
    ).toBe("+ 0,206 kg · 3 m");
  });
});
