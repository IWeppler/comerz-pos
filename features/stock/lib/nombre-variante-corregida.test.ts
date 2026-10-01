import { describe, expect, it } from "vitest";
import { nombreDeVarianteCorregida } from "./nombre-variante-corregida";

describe("nombreDeVarianteCorregida", () => {
  it("conserva el formato del remito (propiedad: valor)", () => {
    expect(
      nombreDeVarianteCorregida(
        { Color: "Rosado", Memoria: "12/256" },
        "Color: Rosado / Memoria: 12/257",
      ),
    ).toBe("Color: Rosado / Memoria: 12/256");
  });

  it("conserva el formato de la grilla (solo valores)", () => {
    expect(
      nombreDeVarianteCorregida({ Memoria: "8/256gb", Color: "Negro" }, "8/257gb / Negro"),
    ).toBe("8/256gb / Negro");
  });
});
