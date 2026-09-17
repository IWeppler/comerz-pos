import { describe, expect, it } from "vitest";
import { detalleRenglon, nombreRenglon } from "./nombre-renglon";

describe("nombreRenglon", () => {
  it("con producto, el nombre del producto", () => {
    expect(nombreRenglon("Remera", { variante: "M", es_venta_libre: false })).toBe(
      "Remera",
    );
  });

  it("sin producto y marcado libre, la descripción tipeada", () => {
    expect(
      nombreRenglon(null, { variante: "12 globos sueltos", es_venta_libre: true }),
    ).toBe("12 globos sueltos");
  });

  it("sin producto y SIN marca, sigue siendo producto eliminado aunque tenga variante", () => {
    expect(
      nombreRenglon(undefined, { variante: "TALLE: 5 / COLOR: NEGRO" }),
    ).toBe("Producto eliminado");
    expect(
      nombreRenglon(null, { variante: "Rojo", es_venta_libre: false }),
    ).toBe("Producto eliminado");
  });
});

describe("detalleRenglon", () => {
  it("la variante en un renglón normal, la etiqueta en uno libre", () => {
    expect(detalleRenglon({ variante: "M / Rojo" })).toBe("M / Rojo");
    expect(detalleRenglon({ variante: "Piñata", es_venta_libre: true })).toBe(
      "Venta libre",
    );
  });
});
