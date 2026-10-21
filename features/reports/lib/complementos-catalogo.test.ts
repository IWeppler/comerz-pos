import { describe, it, expect } from "vitest";
import {
  seleccionarAsociaciones,
  confianzaDelPar,
  MAX_ASOCIACIONES,
  type ParComplementario,
} from "./complementos-catalogo";

function par(
  id: string,
  over: Partial<ParComplementario> = {},
): ParComplementario {
  return {
    producto_a_id: `a-${id}`,
    producto_a: `A${id}`,
    producto_b_id: `b-${id}`,
    producto_b: `B${id}`,
    ventas_juntas: 3,
    ventas_a: 10,
    ventas_b: 10,
    activo: false,
    publicables: true,
    ...over,
  };
}

describe("confianzaDelPar", () => {
  it("usa el producto menos vendido como base", () => {
    expect(confianzaDelPar(par("x", { ventas_juntas: 3, ventas_a: 30, ventas_b: 6 }))).toBe(0.5);
  });

  it("sin ventas del menos vendido da 0, no división por cero", () => {
    expect(confianzaDelPar(par("x", { ventas_juntas: 3, ventas_a: 0, ventas_b: 5 }))).toBe(0);
  });
});

describe("seleccionarAsociaciones", () => {
  it("descarta pares con 2 compras juntas: son coincidencia", () => {
    expect(seleccionarAsociaciones([par("1", { ventas_juntas: 2 })])).toEqual([]);
  });

  it("descarta pares con confianza menor a 20% aunque tengan 3 juntas", () => {
    // 3 de 40 del menos vendido = 7,5%
    const debil = par("1", { ventas_juntas: 3, ventas_a: 40, ventas_b: 40 });
    expect(seleccionarAsociaciones([debil])).toEqual([]);
  });

  it("descarta pares no publicables (un producto oculto no se puede mostrar)", () => {
    expect(seleccionarAsociaciones([par("1", { publicables: false })])).toEqual([]);
  });

  it("acepta el umbral exacto: 3 juntas y 20% de confianza", () => {
    const justo = par("1", { ventas_juntas: 3, ventas_a: 15, ventas_b: 15 });
    expect(seleccionarAsociaciones([justo])).toHaveLength(1);
  });

  it("ordena por compras juntas y después por confianza", () => {
    const pares = [
      par("bajo", { ventas_juntas: 3, ventas_a: 15, ventas_b: 15 }),
      par("alto", { ventas_juntas: 5, ventas_a: 20, ventas_b: 20 }),
      par("medio", { ventas_juntas: 3, ventas_a: 10, ventas_b: 10 }),
    ];
    const orden = seleccionarAsociaciones(pares).map((p) => p.producto_a);
    expect(orden).toEqual(["Aalto", "Amedio", "Abajo"]);
  });

  it("las activadas van primero aunque sean débiles", () => {
    const activa = par("act", { activo: true, ventas_juntas: 2, ventas_a: 200, ventas_b: 200 });
    const sugerida = par("sug", { ventas_juntas: 9, ventas_a: 12, ventas_b: 12 });
    const orden = seleccionarAsociaciones([sugerida, activa]).map((p) => p.producto_a);
    expect(orden).toEqual(["Aact", "Asug"]);
  });

  it("corta en el máximo, default 5", () => {
    const muchas = Array.from({ length: 9 }, (_, i) =>
      par(String(i), { ventas_juntas: 3 + i, ventas_a: 10, ventas_b: 10 }),
    );
    expect(seleccionarAsociaciones(muchas)).toHaveLength(MAX_ASOCIACIONES);
    expect(MAX_ASOCIACIONES).toBe(5);
  });

  it("sin pares devuelve lista vacía", () => {
    expect(seleccionarAsociaciones([])).toEqual([]);
  });
});
