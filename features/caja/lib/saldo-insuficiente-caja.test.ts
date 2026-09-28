import { describe, expect, it } from "vitest";
import { mensajeSaldoInsuficienteCaja } from "./saldo-insuficiente-caja";

describe("mensajeSaldoInsuficienteCaja", () => {
  it("ignora otros errores", () => {
    expect(mensajeSaldoInsuficienteCaja(null)).toBeNull();
    expect(
      mensajeSaldoInsuficienteCaja({ message: "EGRESO_DE_CAJA_REQUIERE_TURNO_ABIERTO" }),
    ).toBeNull();
  });

  it("muestra disponible y monto cuando la base los manda (caso 26/9 El Nono Cacho)", () => {
    const mensaje = mensajeSaldoInsuficienteCaja({
      message: "SALDO_INSUFICIENTE_CAJA",
      details: JSON.stringify({ disponible: 125799.3, monto: 150000 }),
    });
    expect(mensaje).toContain("125.799");
    expect(mensaje).toContain("150.000");
  });

  it("sin details legibles, avisa igual sin inventar números", () => {
    const mensaje = mensajeSaldoInsuficienteCaja({
      message: "SALDO_INSUFICIENTE_CAJA",
      details: null,
    });
    expect(mensaje).toContain("no hay efectivo suficiente");
    expect(mensaje).not.toMatch(/\$/);
  });
});
