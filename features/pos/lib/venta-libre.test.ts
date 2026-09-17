import { describe, expect, it } from "vitest";
import {
  crearLineaVentaLibre,
  esIdVentaLibre,
  validarVentaLibre,
} from "./venta-libre";

describe("validarVentaLibre", () => {
  it("normaliza la descripción y redondea el precio al centavo", () => {
    const r = validarVentaLibre({
      descripcion: "  Globos   sueltos x12 ",
      precio: "1500,505",
    });
    expect(r).toEqual({
      ok: true,
      valor: { descripcion: "Globos sueltos x12", precio: 1500.51 },
    });
  });

  it("acepta el precio como número", () => {
    const r = validarVentaLibre({ descripcion: "Piñata", precio: 12000 });
    expect(r.ok).toBe(true);
  });

  it("rechaza descripción vacía", () => {
    expect(validarVentaLibre({ descripcion: "   ", precio: 100 }).ok).toBe(
      false,
    );
    expect(validarVentaLibre({ descripcion: null, precio: 100 }).ok).toBe(false);
  });

  it("rechaza precio cero, negativo, no numérico o absurdo", () => {
    for (const precio of [0, -5, "abc", "", NaN, Infinity, 1e9]) {
      expect(validarVentaLibre({ descripcion: "x", precio }).ok).toBe(false);
    }
  });

  it("rechaza descripciones más largas que el máximo", () => {
    expect(
      validarVentaLibre({ descripcion: "a".repeat(121), precio: 1 }).ok,
    ).toBe(false);
    expect(
      validarVentaLibre({ descripcion: "a".repeat(120), precio: 1 }).ok,
    ).toBe(true);
  });
});

describe("crearLineaVentaLibre", () => {
  it("arma una línea marcada, sin variante real y con un id local no-uuid", () => {
    const linea = crearLineaVentaLibre({ descripcion: "Piñata", precio: 12000 });
    expect(linea.ventaLibre).toBe(true);
    expect(linea.varianteId).toBeUndefined();
    expect(esIdVentaLibre(linea.productoId)).toBe(true);
    expect(linea.nombre).toBe("Piñata");
    expect(linea.variante).toBe("Piñata");
    expect(linea.precio).toBe(12000);
    expect(linea.cantidad).toBe(1);
  });

  it("misma descripción a distinto precio son dos líneas (clave distinta)", () => {
    const a = crearLineaVentaLibre({ descripcion: "Globos", precio: 500 });
    const b = crearLineaVentaLibre({ descripcion: "Globos", precio: 600 });
    expect(`${a.productoId}|${a.variante}`).not.toBe(
      `${b.productoId}|${b.variante}`,
    );
  });

  it("un uuid real no es venta libre", () => {
    expect(esIdVentaLibre("106f0b93-9211-47f9-945f-4691d634f6f3")).toBe(false);
    expect(esIdVentaLibre(undefined)).toBe(false);
  });
});
