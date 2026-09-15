import { describe, expect, it } from "vitest";
import { decidirModoEntrega } from "./entregar-archivo";

describe("decidirModoEntrega", () => {
  it("celular que sabe compartir archivos: hoja nativa", () => {
    expect(
      decidirModoEntrega({ puedeCompartirArchivo: true, punteroGrueso: true }),
    ).toBe("compartir");
  });

  it("PC con Chrome en Windows, que también sabe compartir: descarga igual", () => {
    expect(
      decidirModoEntrega({ puedeCompartirArchivo: true, punteroGrueso: false }),
    ).toBe("descargar");
  });

  it("celular cuyo navegador no comparte archivos: descarga", () => {
    expect(
      decidirModoEntrega({ puedeCompartirArchivo: false, punteroGrueso: true }),
    ).toBe("descargar");
  });

  it("PC sin Web Share: descarga", () => {
    expect(
      decidirModoEntrega({ puedeCompartirArchivo: false, punteroGrueso: false }),
    ).toBe("descargar");
  });
});
