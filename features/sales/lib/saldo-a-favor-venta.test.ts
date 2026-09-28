import { describe, it, expect } from "vitest";
import {
  baseRecargoCuentaCorriente,
  mensajeSaldoAFavorInsuficiente,
  saldoAFavorAplicable,
} from "./saldo-a-favor-venta";

describe("saldoAFavorAplicable", () => {
  it("usa todo lo que tiene si la compra es más grande", () => {
    expect(saldoAFavorAplicable(10000, 25000)).toBe(10000);
  });

  it("nunca más que la compra: el resto le sigue quedando a favor", () => {
    expect(saldoAFavorAplicable(30000, 20000)).toBe(20000);
  });

  it("sin saldo a favor no aplica nada", () => {
    expect(saldoAFavorAplicable(0, 20000)).toBe(0);
    expect(saldoAFavorAplicable(-5000, 20000)).toBe(0);
  });
});

describe("baseRecargoCuentaCorriente", () => {
  it("el recargo de cuenta corriente no se cobra sobre la parte pagada con saldo a favor", () => {
    // Compra de 20.000, 5.000 a favor, el resto fiado al 15%: el recargo va
    // sobre 15.000 (2.250), no sobre 20.000 (3.000).
    const base = baseRecargoCuentaCorriente(20000, 5000);
    expect(base).toBe(15000);
    expect((base * 15) / 100).toBe(2250);
  });

  it("sin saldo a favor es el subtotal de siempre", () => {
    expect(baseRecargoCuentaCorriente(20000, 0)).toBe(20000);
  });

  it("nunca negativa", () => {
    expect(baseRecargoCuentaCorriente(10000, 12000)).toBe(0);
  });
});

describe("mensajeSaldoAFavorInsuficiente", () => {
  it("traduce el rechazo de la base con lo disponible", () => {
    const mensaje = mensajeSaldoAFavorInsuficiente({
      message: "SALDO_A_FAVOR_INSUFICIENTE",
      details: '{"monto": 50000, "disponible": 10000.00}',
    });
    expect(mensaje).toContain("$10.000");
  });

  it("sin detalle legible, sin números", () => {
    expect(
      mensajeSaldoAFavorInsuficiente({
        message: "SALDO_A_FAVOR_INSUFICIENTE",
        details: null,
      }),
    ).toContain("no tiene saldo a favor suficiente");
  });

  it("otro error no es asunto suyo", () => {
    expect(mensajeSaldoAFavorInsuficiente({ message: "VENTA_SIN_RENGLONES" })).toBeNull();
  });
});
