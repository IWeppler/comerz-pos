import { describe, expect, it } from "vitest";
import { categoriaCarrito, detalleVarianteCarrito } from "./detalle-renglon-carrito";

describe("detalleVarianteCarrito", () => {
  it("nombra cada atributo cuando la línea los trae", () => {
    expect(
      detalleVarianteCarrito({ variante: "Negro / 40", atributosVariante: { Talle: "40", Color: "Negro" } }),
    ).toBe("Talle 40 · Color Negro");
  });

  it("sin atributos cae al texto de la variante (carritos viejos)", () => {
    expect(detalleVarianteCarrito({ variante: "Negro / 40" })).toBe("Negro / 40");
  });

  it("una variante única o una venta libre no muestran nada", () => {
    expect(detalleVarianteCarrito({ variante: "Unico" })).toBeNull();
    expect(detalleVarianteCarrito({ variante: "Único", atributosVariante: {} })).toBeNull();
    expect(detalleVarianteCarrito({ variante: "Algo", ventaLibre: true })).toBeNull();
  });
});

describe("categoriaCarrito", () => {
  it("separa las listas con espacio y oculta las genéricas", () => {
    expect(categoriaCarrito({ tipo: "CAMISETAS,BUZOS,CAMPERAS" })).toBe("CAMISETAS, BUZOS, CAMPERAS");
    expect(categoriaCarrito({ tipo: "Camperas" })).toBe("Camperas");
    expect(categoriaCarrito({ tipo: "General" })).toBeNull();
    expect(categoriaCarrito({ tipo: "" })).toBeNull();
  });
});
