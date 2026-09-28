import { describe, it, expect } from "vitest";
import {
  cobroSuperaDeuda,
  excedenteSobreDeuda,
  mensajeCobroSuperaDeuda,
} from "./tope-cobro-cc";

describe("excedenteSobreDeuda", () => {
  it("lo que sobra queda a favor", () => {
    expect(excedenteSobreDeuda(15000, 10350)).toBe(4650);
  });

  it("una seña sin deuda queda entera a favor", () => {
    expect(excedenteSobreDeuda(5000, 0)).toBe(5000);
  });

  it("pagar justo o menos no deja nada", () => {
    expect(excedenteSobreDeuda(10350, 10350)).toBe(0);
    expect(excedenteSobreDeuda(5000, 10350)).toBe(0);
  });

  it("una deuda negativa (ya tiene saldo a favor) cuenta como cero", () => {
    expect(excedenteSobreDeuda(2000, -3000)).toBe(2000);
  });
});

describe("cobroSuperaDeuda", () => {
  it("el caso real: el segundo cobro de SILVINA RODRIGUEZ con la deuda ya en cero", () => {
    // 21/7/2026: $10.350 dos veces a 14 segundos. El primero saldaba todo.
    expect(cobroSuperaDeuda(10350, 0)).toBe(true);
  });

  it("pagar exactamente lo que debe se permite", () => {
    expect(cobroSuperaDeuda(10350, 10350)).toBe(false);
  });

  it("pagar una parte se permite", () => {
    expect(cobroSuperaDeuda(5000, 10350)).toBe(false);
  });

  it("un decimal de más por la mora calculada no lo frena", () => {
    // Deuda con mora: 104.825 + 15.723,75. El modal redondea distinto que la
    // base y manda 120548.750000001.
    expect(cobroSuperaDeuda(120548.750000001, 120548.75)).toBe(false);
  });

  it("un centavo de más sí lo frena", () => {
    expect(cobroSuperaDeuda(120548.76, 120548.75)).toBe(true);
  });
});

describe("mensajeCobroSuperaDeuda", () => {
  it("traduce el rechazo de la base con los dos números", () => {
    const mensaje = mensajeCobroSuperaDeuda({
      message: "COBRO_SUPERA_DEUDA",
      details: '{"deuda": 7557.50, "monto": 8000}',
    });
    expect(mensaje).toContain("$8.000");
    expect(mensaje).toContain("$7.557,5");
  });

  it("sin detalle legible dice lo mismo sin números", () => {
    expect(
      mensajeCobroSuperaDeuda({ message: "COBRO_SUPERA_DEUDA", details: "" }),
    ).toBe(
      "El cobro supera lo que el cliente debe. Revisá el monto, o marcá que el resto queda a favor.",
    );
  });

  it("otro error no es asunto suyo", () => {
    expect(mensajeCobroSuperaDeuda({ message: "CLIENTE_NO_ENCONTRADO" })).toBeNull();
    expect(mensajeCobroSuperaDeuda(null)).toBeNull();
  });
});
