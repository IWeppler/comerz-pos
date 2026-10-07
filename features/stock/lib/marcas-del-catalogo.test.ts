import { describe, expect, it } from "vitest";
import { agruparMarcas, normalizarMarca } from "./marcas-del-catalogo";

describe("marcas del catálogo", () => {
  it.each([null, "", " \t\n "])("no inventa una marca para %s", (marca) => expect(normalizarMarca(marca)).toBeNull());
  it("agrupa mayúsculas, acentos y espacios, con la escritura más frecuente", () => {
    expect(agruparMarcas([{ marca: " SAMSUNG " }, { marca: "Samsung" }, { marca: "Samsung" },
      { marca: " ÁLBÁ   Color " }, { marca: "alba color" }, { marca: null }, { marca: " " }]))
      .toEqual([{ clave: "alba color", nombre: "alba color", cantidad: 2 }, { clave: "samsung", nombre: "Samsung", cantidad: 3 }]);
  });
  it("conserva signos literales y letras que NFD no descompone", () => {
    expect(normalizarMarca("A_% Straße")).toBe("a_% straße");
  });
});
