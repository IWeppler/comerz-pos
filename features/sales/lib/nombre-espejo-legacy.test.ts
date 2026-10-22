import { describe, expect, it } from "vitest";
import { nombreEspejoLegacy } from "./nombre-espejo-legacy";

describe("nombreEspejoLegacy", () => {
  it("usa el nombre actual de la variante aunque el ticket diga otro", () => {
    expect(
      nombreEspejoLegacy("Celeste / U", "TALLE: U / COLOR: CELESTE"),
    ).toBe("Celeste / U");
  });

  it("sin variante resuelta, vuelve al texto del ticket", () => {
    expect(nombreEspejoLegacy(undefined, "Talle 2")).toBe("Talle 2");
    expect(nombreEspejoLegacy(null, "Talle 2")).toBe("Talle 2");
  });
});
