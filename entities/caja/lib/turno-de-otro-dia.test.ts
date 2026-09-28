import { describe, expect, it } from "vitest";
import {
  describirAperturaTurno,
  diaComercial,
  esTurnoDeOtroDia,
  fechaCierreTurnoOlvidado,
} from "./turno-de-otro-dia";

describe("diaComercial", () => {
  it("usa la hora de Argentina, no la de UTC", () => {
    // 21:30 del jueves 24 en Buenos Aires = 00:30 del viernes 25 en UTC.
    expect(diaComercial("2026-09-25T00:30:00Z")).toBe("2026-09-24");
    expect(diaComercial("2026-09-25T03:00:00Z")).toBe("2026-09-25");
  });
});

describe("esTurnoDeOtroDia", () => {
  it("un turno de la tarde sigue siendo del día hasta la medianoche argentina", () => {
    const apertura = "2026-09-25T19:41:00Z"; // vie 25 16:41
    expect(esTurnoDeOtroDia(apertura, new Date("2026-09-26T02:59:00Z"))).toBe(false); // vie 23:59
    expect(esTurnoDeOtroDia(apertura, new Date("2026-09-26T03:00:00Z"))).toBe(true); // sáb 00:00
  });

  it("el caso del 26/9: el turno del viernes a la tarde, a las 08:22 del sábado", () => {
    expect(
      esTurnoDeOtroDia("2026-09-25T19:41:00Z", new Date("2026-09-26T11:22:00Z")),
    ).toBe(true);
  });

  it("sin turno no hay nada que bloquear", () => {
    expect(esTurnoDeOtroDia(null)).toBe(false);
  });
});

describe("fechaCierreTurnoOlvidado", () => {
  it("cierra un minuto después del último movimiento (jueves 24: pago de las 12:17)", () => {
    const cierre = fechaCierreTurnoOlvidado(
      "2026-09-24T12:04:00Z",
      "2026-09-24T15:17:26Z",
      new Date("2026-09-25T11:14:00Z"),
    );
    expect(cierre.toISOString()).toBe("2026-09-24T15:18:26.000Z");
    expect(diaComercial(cierre)).toBe("2026-09-24");
  });

  it("sin movimientos, un minuto después de la apertura", () => {
    const cierre = fechaCierreTurnoOlvidado(
      "2026-09-24T12:04:00Z",
      null,
      new Date("2026-09-25T11:14:00Z"),
    );
    expect(cierre.toISOString()).toBe("2026-09-24T12:05:00.000Z");
  });

  it("nunca después de ahora", () => {
    const ahora = new Date("2026-09-25T11:14:00Z");
    const cierre = fechaCierreTurnoOlvidado("2026-09-24T12:04:00Z", "2026-09-25T11:13:30Z", ahora);
    expect(cierre.getTime()).toBe(ahora.getTime());
  });
});

describe("describirAperturaTurno", () => {
  it("día y hora en Argentina", () => {
    expect(describirAperturaTurno("2026-09-24T12:04:00Z")).toBe("jueves 24/9 a las 09:04");
  });
});
