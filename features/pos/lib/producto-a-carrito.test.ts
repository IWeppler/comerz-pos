import { describe, expect, it } from "vitest";
import { productoCargadoAProducto } from "./producto-a-carrito";

describe("productoCargadoAProducto", () => {
  it("conserva la unidad de medida antes de que el catálogo se refresque", () => {
    const producto = productoCargadoAProducto({
      id: "producto-1",
      nombre: "Crema",
      tipo: "Alimentos",
      precio: 8_000,
      unidad_medida: "KG",
      variantes: [
        {
          id: "variante-1",
          nombre_display: "Único",
          precio: null,
          stock: 2.5,
        },
      ],
    });

    expect(producto.unidad_medida).toBe("KG");
  });
});
