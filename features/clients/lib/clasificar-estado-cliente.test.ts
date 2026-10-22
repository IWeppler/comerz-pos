import { describe, expect, it } from "vitest";
import { clasificarEstadoCliente } from "./clasificar-estado-cliente";

describe("clasificarEstadoCliente", () => {
  it("sin saldo está al día, aunque la fecha haya pasado", () => {
    expect(clasificarEstadoCliente(0, 30)).toBe("al_dia");
    expect(clasificarEstadoCliente(-500, null)).toBe("al_dia");
  });

  it("vencido desde el día siguiente al vencimiento", () => {
    expect(clasificarEstadoCliente(1000, 1)).toBe("vencido");
  });

  it("por vencer: vence hoy o dentro de 5 días", () => {
    expect(clasificarEstadoCliente(1000, 0)).toBe("por_vencer");
    expect(clasificarEstadoCliente(1000, -5)).toBe("por_vencer");
  });

  it("con deuda: vence más adelante o no tiene fecha", () => {
    expect(clasificarEstadoCliente(1000, -6)).toBe("con_deuda");
    expect(clasificarEstadoCliente(1000, null)).toBe("con_deuda");
  });
});
