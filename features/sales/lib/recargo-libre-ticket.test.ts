import { describe, expect, it } from "vitest";
import { etiquetaRecargoLibre } from "./recargo-libre-ticket";

describe("etiquetaRecargoLibre", () => {
  it("con porcentaje conocido lo muestra", () => {
    expect(etiquetaRecargoLibre({ recargoLibrePorcentaje: 10 })).toBe("Recargo (10%)");
    expect(etiquetaRecargoLibre({ recargoLibrePorcentaje: 7.5 })).toBe("Recargo (7,5%)");
  });

  it("sin porcentaje, solo 'Recargo': no inventa uno", () => {
    expect(etiquetaRecargoLibre({ recargoLibrePorcentaje: null })).toBe("Recargo");
    expect(etiquetaRecargoLibre({})).toBe("Recargo");
    expect(etiquetaRecargoLibre({ recargoLibrePorcentaje: 0 })).toBe("Recargo");
  });

  it("no se llama recargo de cuenta corriente: no es interés de fiar", () => {
    expect(etiquetaRecargoLibre({ recargoLibrePorcentaje: 10 })).not.toMatch(/cuenta/i);
  });
});
