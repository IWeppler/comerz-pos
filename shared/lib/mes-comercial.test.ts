import { describe, expect, it } from "vitest";
import { rangoMesComercial } from "./mes-comercial";

describe("rangoMesComercial", () => {
  it("arranca a las 00:00 argentinas del día 1 (03:00 UTC)", () => {
    const r = rangoMesComercial(new Date("2026-10-23T15:00:00Z"));
    expect(r.desde).toBe("2026-10-01T03:00:00.000Z");
    expect(r.hasta).toBe("2026-11-01T03:00:00.000Z");
  });

  it("la noche del último día todavía es del mes que termina", () => {
    // 31/10 22:30 en Argentina = 01/11 01:30 UTC.
    const r = rangoMesComercial(new Date("2026-11-01T01:30:00Z"));
    expect(r.desde).toBe("2026-10-01T03:00:00.000Z");
  });

  it("diciembre cierra en enero del año siguiente", () => {
    const r = rangoMesComercial(new Date("2026-12-15T12:00:00Z"));
    expect(r.desde).toBe("2026-12-01T03:00:00.000Z");
    expect(r.hasta).toBe("2027-01-01T03:00:00.000Z");
  });
});
