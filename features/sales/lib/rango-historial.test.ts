import { describe, it, expect } from "vitest";
import {
  desdeRangoHistorial,
  normalizarRangoHistorial,
  etiquetaRangoHistorial,
} from "./rango-historial";

describe("normalizarRangoHistorial", () => {
  it("acepta los rangos conocidos", () => {
    expect(normalizarRangoHistorial("90")).toBe("90");
    expect(normalizarRangoHistorial("todo")).toBe("todo");
  });

  it("lo desconocido o ausente cae a 7 días, nunca a todo", () => {
    expect(normalizarRangoHistorial(undefined)).toBe("7");
    expect(normalizarRangoHistorial("15")).toBe("7");
    expect(normalizarRangoHistorial(["todo"])).toBe("7");
  });
});

describe("desdeRangoHistorial", () => {
  it("todo el historial no tiene piso", () => {
    expect(desdeRangoHistorial("todo")).toBeNull();
  });

  it("30 días incluye hoy y arranca a las 00:00 argentinas de hace 29", () => {
    // 4/10/2026 15:00 en Argentina.
    const ahora = new Date("2026-10-04T18:00:00Z");
    expect(desdeRangoHistorial("30", ahora)).toBe("2026-09-05T03:00:00.000Z");
  });

  it("usa el día comercial argentino, no el UTC", () => {
    // 4/10 a las 23:30 en Argentina ya es 5/10 en UTC: sigue siendo el 4.
    const ahora = new Date("2026-10-05T02:30:00Z");
    expect(desdeRangoHistorial("30", ahora)).toBe("2026-09-05T03:00:00.000Z");
  });

  it("a la medianoche argentina ya cuenta el día nuevo", () => {
    const ahora = new Date("2026-10-05T03:00:00Z"); // 5/10 00:00 AR
    expect(desdeRangoHistorial("30", ahora)).toBe("2026-09-06T03:00:00.000Z");
  });

  it("último año", () => {
    const ahora = new Date("2026-10-04T18:00:00Z");
    expect(desdeRangoHistorial("365", ahora)).toBe("2025-10-05T03:00:00.000Z");
  });
});

describe("etiquetaRangoHistorial", () => {
  it("nombra el rango", () => {
    expect(etiquetaRangoHistorial("30")).toBe("Últimos 30 días");
  });
});

describe("default de 7 días", () => {
  it("incluye hoy y arranca a las 00:00 argentinas de hace 6", () => {
    const ahora = new Date("2026-10-04T18:00:00Z");
    expect(desdeRangoHistorial("7", ahora)).toBe("2026-09-28T03:00:00.000Z");
  });
});
