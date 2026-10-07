import { describe, expect, it } from "vitest";
import casos from "./ajuste-precios-casos.json";
import { calcularAjuste, productosSinCostoParaRecargo, validarReglaPrecio, type ReglaPrecio } from "./ajuste-precios";

describe("ajuste de precios (espejo SQL)", () => {
  it.each(casos)("$operacion $campo $redondeo sobre $precio", (c) => {
    expect(calcularAjuste(c.costo, c.precio, { ...c, alcance: "TODOS" } as ReglaPrecio))
      .toEqual({ costo: c.nuevoCosto, precio: c.nuevoPrecio });
  });
  const regla: ReglaPrecio = { alcance: "TODOS", campo: "PRECIO", operacion: "AUMENTAR_PORCENTAJE", valor: 10, redondeo: "SIN_REDONDEO" };
  it.each([NaN, Infinity, -1, 0.123, 1e10])("rechaza porcentajes inválidos: %s", (valor) => expect(validarReglaPrecio({ ...regla, valor })).not.toBeNull());
  it("rechaza alcances y operaciones desconocidos", () => {
    expect(validarReglaPrecio({ ...regla, alcance: "REMITO" })).not.toBeNull();
    expect(validarReglaPrecio({ ...regla, operacion: "REMITO" })).not.toBeNull();
    expect(validarReglaPrecio({ ...regla, alcance: "MARCA", valorAlcance: " " })).not.toBeNull();
    expect(validarReglaPrecio({ ...regla, operacion: "REDUCIR_PORCENTAJE", valor: 101 })).not.toBeNull();
    expect(validarReglaPrecio({ ...regla, operacion: "FIJAR_MARGEN", campo: "COSTO" })).not.toBeNull();
  });
});

describe("productosSinCostoParaRecargo", () => {
  const prod = (nombre: string, precio_costo: number | string | null) => ({ nombre, precio_costo });

  it("solo frena el recargo sobre costo", () => {
    expect(productosSinCostoParaRecargo({ operacion: "AUMENTAR_PORCENTAJE" }, [prod("A", null)])).toBeNull();
    expect(productosSinCostoParaRecargo({ operacion: "FIJAR_MARGEN" }, [prod("A", "100.00")])).toBeNull();
  });

  it("nombra los productos sin costo (null, 0 o vacío) y dice cuántos más", () => {
    const msg = productosSinCostoParaRecargo({ operacion: "FIJAR_MARGEN" }, [
      prod("Goma", null), prod("Birome", 0), prod("Cuaderno", "0.00"), prod("Lápiz", 50),
      prod("Regla", null), prod("Tijera", null), prod("Abrochadora", null),
    ]);
    expect(msg).toContain("6 productos no tienen costo cargado");
    expect(msg).toContain("Abrochadora, Birome, Cuaderno, Goma, Regla");
    expect(msg).toContain("y 1 más");
    expect(msg).not.toContain("Lápiz");
  });
});
