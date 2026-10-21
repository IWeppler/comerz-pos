import { describe, expect, it } from "vitest";
import {
  acumularUnidad,
  piezasDeVenta,
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

describe("piezasDeVenta", () => {
  it("un ticket con kilos y piezas cuenta solo las piezas", () => {
    // ventas.cantidad daría 5 (2 kg + 3 alfajores). Las piezas son 3.
    const items = [
      { cantidad: 2, producto: { unidad_medida: "KG" } },
      { cantidad: 3, producto: { unidad_medida: "UNIDAD" } },
    ];
    expect(piezasDeVenta(items)).toBe(3);
  });

  it("acepta la relación de producto como lista de un elemento", () => {
    expect(piezasDeVenta([{ cantidad: 4, producto: [{ unidad_medida: "UNIDAD" }] }])).toBe(4);
  });

  it("una venta sin renglones cargados cuenta 0, no inventa un número", () => {
    expect(piezasDeVenta(undefined)).toBe(0);
    expect(piezasDeVenta([])).toBe(0);
  });
});
