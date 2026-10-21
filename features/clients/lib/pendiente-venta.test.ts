import { describe, expect, it } from "vitest";
import { pendienteDeVenta, sumarVivoPorVenta } from "./pendiente-venta";

describe("sumarVivoPorVenta", () => {
  it("suma el saldo vivo de cada venta y deja afuera lo que no es de una venta", () => {
    const mapa = sumarVivoPorVenta([
      { venta_id: "v1", vivo: 100 },
      { venta_id: "v1", vivo: "50.5" },
      { venta_id: "v2", vivo: 0 },
      { venta_id: null, vivo: 999 }, // mora huérfana: no es de una venta
    ]);
    expect(mapa.get("v1")).toBe(150.5);
    expect(mapa.has("v2")).toBe(false);
    expect(mapa.size).toBe(1);
  });
});

describe("pendienteDeVenta", () => {
  it("usa el saldo de la cuenta corriente, aunque el campo congelado diga otra cosa", () => {
    // La venta quedó pendiente por $1.000 al vender y el cliente ya pagó todo:
    // la cuenta corriente dice 0 y eso es lo que se muestra.
    expect(pendienteDeVenta({ pendiente_actual: 0, monto_pendiente: 1000 })).toBe(0);
  });

  it("si la cuenta corriente no respondió, cae al campo congelado", () => {
    expect(pendienteDeVenta({ pendiente_actual: null, monto_pendiente: 800 })).toBe(800);
  });

  it("sin ningún dato, es 0 y no negativo", () => {
    expect(pendienteDeVenta({})).toBe(0);
    expect(pendienteDeVenta({ monto_pendiente: -5 })).toBe(0);
  });
});
