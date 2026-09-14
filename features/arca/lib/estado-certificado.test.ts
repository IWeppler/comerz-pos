import { describe, expect, it } from "vitest";
import { estadoCertificado } from "./estado-certificado";

const hoy = new Date("2026-09-14T12:00:00Z");

describe("estadoCertificado", () => {
  it("vigente lejos del vencimiento", () => {
    expect(estadoCertificado("2028-09-13T00:00:00Z", hoy)).toEqual({
      estado: "vigente",
      dias: 729,
    });
  });
  it("avisa a 30 días o menos", () => {
    expect(estadoCertificado("2026-10-14T12:00:00Z", hoy)).toEqual({
      estado: "por_vencer",
      dias: 30,
    });
    expect(estadoCertificado("2026-09-15T00:00:00Z", hoy)?.estado).toBe("por_vencer");
  });
  it("vencido cuenta los días desde que venció", () => {
    expect(estadoCertificado("2026-09-10T12:00:00Z", hoy)).toEqual({
      estado: "vencido",
      dias: 4,
    });
  });
  it("sin fecha o fecha inválida: null", () => {
    expect(estadoCertificado(null, hoy)).toBeNull();
    expect(estadoCertificado("ayer", hoy)).toBeNull();
  });
});
