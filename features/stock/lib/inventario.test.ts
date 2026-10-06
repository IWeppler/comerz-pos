import { describe, expect, it } from "vitest";
import {
  coincideBusquedaInventario,
  compararTexto,
  nivelStock,
} from "./inventario";

describe("nivelStock", () => {
  it("cero o negativo es agotado", () => {
    expect(nivelStock(0)).toBe("agotado");
    expect(nivelStock(-2)).toBe("agotado");
  });
  it("menos de 5 es bajo, también con decimales (venta por peso)", () => {
    expect(nivelStock(4)).toBe("bajo");
    expect(nivelStock(0.5)).toBe("bajo");
  });
  it("5 o más es normal", () => {
    expect(nivelStock(5)).toBe("normal");
  });
});

describe("coincideBusquedaInventario", () => {
  const remera = {
    nombre: "Remera Algodón",
    marca: "Kosiuko",
    modelo: null,
    producto_variantes: [{ sku: "REM-001-M" }, { sku: null }],
  };

  it("búsqueda vacía matchea todo", () => {
    expect(coincideBusquedaInventario(remera, "  ")).toBe(true);
  });
  it("nombre sin tildes ni mayúsculas", () => {
    expect(coincideBusquedaInventario(remera, "algodon")).toBe(true);
  });
  it("marca", () => {
    expect(coincideBusquedaInventario(remera, "kosi")).toBe(true);
  });
  it("SKU de una variante", () => {
    expect(coincideBusquedaInventario(remera, "rem-001")).toBe(true);
  });
  it("lo que no está no matchea", () => {
    expect(coincideBusquedaInventario(remera, "pantalon")).toBe(false);
  });
});

describe("compararTexto", () => {
  it("ordena en español sin distinguir tildes", () => {
    expect(["Óleos", "Accesorios", "lápices"].sort(compararTexto)).toEqual([
      "Accesorios",
      "lápices",
      "Óleos",
    ]);
  });
  it("lo vacío va al final", () => {
    expect(["", "Zapatos", null].sort(compararTexto)).toEqual([
      "Zapatos",
      "",
      null,
    ]);
  });
});
