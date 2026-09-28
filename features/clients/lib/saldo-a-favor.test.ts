import { describe, it, expect } from "vitest";
import { deudaDe, saldoAFavorDe } from "./saldo-a-favor";

describe("saldo con signo", () => {
  it("positivo es deuda y no hay saldo a favor", () => {
    expect(deudaDe(10350)).toBe(10350);
    expect(saldoAFavorDe(10350)).toBe(0);
  });

  it("negativo es saldo a favor y no hay deuda", () => {
    // Una seña de $21.850 sin deuda previa.
    expect(deudaDe(-21850)).toBe(0);
    expect(saldoAFavorDe(-21850)).toBe(21850);
  });

  it("cero no es ninguna de las dos", () => {
    expect(deudaDe(0)).toBe(0);
    expect(saldoAFavorDe(0)).toBe(0);
  });

  it("acepta lo que devuelve PostgREST (numeric como texto) y null", () => {
    expect(deudaDe("7557.50")).toBe(7557.5);
    expect(saldoAFavorDe("-1450.00")).toBe(1450);
    expect(deudaDe(null)).toBe(0);
    expect(saldoAFavorDe(undefined)).toBe(0);
  });

  it("sumar deuda no descuenta los saldos a favor", () => {
    const saldos = [10000, -5000, 2500];
    expect(saldos.reduce((acc, s) => acc + deudaDe(s), 0)).toBe(12500);
  });
});
