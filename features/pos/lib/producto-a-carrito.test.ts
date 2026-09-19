import { describe, expect, it } from "vitest";
import {
  formaElegidaDeLinea,
  formaInicialDeLinea,
  productoCargadoAProducto,
} from "./producto-a-carrito";

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

describe("formas de venta", () => {
  const producto = {
    producto_presentaciones: [
      {
        id: "balde",
        producto_id: "producto-1",
        variante_id: null,
        nombre: "Balde 4,7 kg",
        factor: 4.7,
        regla_precio: "FIJO" as const,
        precio: 45_000,
        costo: null,
        sku: null,
        es_default: false,
        visible_catalogo: true,
        activa: true,
        orden: 0,
      },
    ],
  };

  it("sin default deja la decisión pendiente en la unidad base", () => {
    const forma = formaInicialDeLinea(producto, undefined, 12_000);
    expect(forma.presentacionId).toBeNull();
    expect(forma.presentaciones).toHaveLength(1);
  });

  it("aplica la presentación elegida desde el selector visual", () => {
    const forma = formaElegidaDeLinea(producto, undefined, 12_000, "balde");
    expect(forma).toMatchObject({
      presentacionId: "balde",
      presentacionNombre: "Balde 4,7 kg",
      factor: 4.7,
      precio: 45_000,
    });
  });
});
