import { describe, expect, it } from "vitest";
import {
  estadoVisiblePresupuesto,
  formatearNumeroPresupuesto,
} from "./estado";

describe("estadoVisiblePresupuesto", () => {
  it("vigente hasta el último día inclusive, en hora argentina", () => {
    // 6/10 a las 23:30 de Argentina = 7/10 02:30 UTC: todavía es el 6.
    const ultimaNoche = new Date("2026-10-07T02:30:00Z");
    expect(estadoVisiblePresupuesto("VIGENTE", "2026-10-06", ultimaNoche)).toBe(
      "VIGENTE",
    );
  });

  it("vencida al día siguiente", () => {
    const alOtroDia = new Date("2026-10-07T03:30:00Z");
    expect(estadoVisiblePresupuesto("VIGENTE", "2026-10-06", alOtroDia)).toBe(
      "VENCIDO",
    );
  });

  it("los estados cerrados no vencen", () => {
    const lejos = new Date("2030-01-01T12:00:00Z");
    expect(estadoVisiblePresupuesto("RECHAZADO", "2026-10-06", lejos)).toBe(
      "RECHAZADO",
    );
    expect(estadoVisiblePresupuesto("ACEPTADO", "2026-10-06", lejos)).toBe(
      "ACEPTADO",
    );
  });

  it("un estado desconocido no se muestra como vigente", () => {
    expect(estadoVisiblePresupuesto("RARO", "2099-01-01")).toBe("ANULADO");
  });
});

describe("formatearNumeroPresupuesto", () => {
  it("rellena a cuatro dígitos", () => {
    expect(formatearNumeroPresupuesto(7)).toBe("#0007");
    expect(formatearNumeroPresupuesto(12345)).toBe("#12345");
  });
});
