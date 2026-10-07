import { describe, expect, it } from "vitest";
import { codigoCuponValido, normalizarCodigoCupon } from "./codigo-cupon";

describe("código de cupón", () => {
  it("normaliza espacios y mayúsculas y conserva null como automático", () => {
    expect(normalizarCodigoCupon(" verano 10 ")).toBe("VERANO10");
    expect(normalizarCodigoCupon("  ")).toBeNull();
    expect(normalizarCodigoCupon(null)).toBeNull();
  });
  it("acepta solo 4–20 caracteres ASCII alfanuméricos", () => {
    for (const codigo of [null, "AB12", "A".repeat(20)]) expect(codigoCuponValido(codigo)).toBe(true);
    for (const codigo of ["ABC", "A".repeat(21), "AÑO10", "OFF-10", "off10"]) expect(codigoCuponValido(codigo)).toBe(false);
  });
});
