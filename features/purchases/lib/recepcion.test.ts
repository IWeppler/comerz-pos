import { describe, expect, it } from "vitest";
import {
  cantidadEfectiva,
  completarConFaltantes,
  conCantidadRecibida,
  entraAlStock,
  grupoNoVino,
  MOTIVO_DESCARTE_ANTERIOR,
  MOTIVO_NO_VINO,
  type LineaRecepcion,
} from "./recepcion";

describe("cantidadEfectiva", () => {
  it("sin ajuste es lo del remito", () => {
    expect(cantidadEfectiva({ cantidad: 10 })).toBe(10);
    expect(cantidadEfectiva({ cantidad: 10, cantidad_recibida: null })).toBe(10);
  });
  it("con ajuste es lo recibido, también 0", () => {
    expect(cantidadEfectiva({ cantidad: 10, cantidad_recibida: 8 })).toBe(8);
    expect(cantidadEfectiva({ cantidad: 10, cantidad_recibida: 0 })).toBe(0);
  });
});

describe("entraAlStock / grupoNoVino", () => {
  it("un renglón en 0 no entra", () => {
    expect(entraAlStock({ cantidad: 5, cantidad_recibida: 0 })).toBe(false);
  });
  it("el grupo no vino solo si NINGUNA línea entra", () => {
    expect(
      grupoNoVino([
        { cantidad: 5, cantidad_recibida: 0 },
        { cantidad: 3 },
      ]),
    ).toBe(false);
    expect(
      grupoNoVino([
        { cantidad: 5, cantidad_recibida: 0 },
        { cantidad: 3, cantidad_recibida: 0 },
      ]),
    ).toBe(true);
    expect(grupoNoVino([])).toBe(false);
  });
});

describe("conCantidadRecibida", () => {
  it("guarda el ajuste con su motivo", () => {
    expect(conCantidadRecibida({ cantidad: 10 }, 0, MOTIVO_NO_VINO)).toEqual({
      cantidad: 10,
      cantidad_recibida: 0,
      motivo_ajuste: MOTIVO_NO_VINO,
    });
  });
  it("volver al número del remito limpia el ajuste", () => {
    expect(
      conCantidadRecibida(
        { cantidad: 10, cantidad_recibida: 8, motivo_ajuste: "x" },
        10,
        "y",
      ),
    ).toEqual({ cantidad: 10, cantidad_recibida: null, motivo_ajuste: null });
  });
  it("nunca negativo", () => {
    const linea: LineaRecepcion = { cantidad: 10 };
    expect(conCantidadRecibida(linea, -4, "x").cantidad_recibida).toBe(0);
  });
});

describe("completarConFaltantes", () => {
  const originales: LineaRecepcion[] = [
    { id: "a", cantidad: 1 },
    { id: "b", cantidad: 2 },
    { id: "c", cantidad: 3 },
  ];
  it("los renglones que el borrador sacó vuelven como no recibidos", () => {
    const res = completarConFaltantes<LineaRecepcion>([{ id: "a", cantidad: 1 }], originales);
    expect(res.map((l) => [l.id, cantidadEfectiva(l), l.motivo_ajuste])).toEqual([
      ["a", 1, undefined],
      ["b", 0, MOTIVO_DESCARTE_ANTERIOR],
      ["c", 0, MOTIVO_DESCARTE_ANTERIOR],
    ]);
  });
  it("un borrador completo queda igual", () => {
    expect(completarConFaltantes(originales, originales)).toBe(originales);
  });
});
