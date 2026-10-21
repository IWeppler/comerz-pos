import { describe, expect, it } from "vitest";
import { calcularConciliacion, type DatosConciliacion } from "./conciliacion";

const base: DatosConciliacion = {
  ventasTotal: 1000,
  ventasCount: 10,
  cobradoEnVenta: 600,
  fiadoDelPeriodo: 400,
  ccCreditos: 500,
  ccCobrosRegistrados: 450,
  ccCreditosVinculadosVenta: 50,
  ventasConMovimientoStock: 10,
};

const porId = (chequeos: ReturnType<typeof calcularConciliacion>, id: string) =>
  chequeos.find((c) => c.id === id)!;

describe("calcularConciliacion", () => {
  it("cierra V1 cuando lo cobrado más lo fiado es el total", () => {
    expect(porId(calcularConciliacion(base), "V1").estado).toBe("CIERRA");
  });

  it("no cierra V1 y muestra la diferencia si falta fiado imputado", () => {
    const c = porId(calcularConciliacion({ ...base, fiadoDelPeriodo: 350 }), "V1");
    expect(c.estado).toBe("NO_CIERRA");
    expect(c.diferencia).toBe(50);
  });

  it("tolera centavos: una diferencia de $0,50 no es un error", () => {
    const c = porId(calcularConciliacion({ ...base, cobradoEnVenta: 599.5 }), "V1");
    expect(c.estado).toBe("CIERRA");
  });

  it("C1 cierra cuando cada crédito tiene origen", () => {
    expect(porId(calcularConciliacion(base), "C1").estado).toBe("CIERRA");
  });

  it("C1 muestra el crédito sin clasificar como diferencia, sin esconderlo", () => {
    const c = porId(
      calcularConciliacion({ ...base, ccCreditos: 507.5 }),
      "C1",
    );
    expect(c.estado).toBe("NO_CIERRA");
    expect(c.diferencia).toBe(7.5);
  });

  it("S1 cuenta las ventas sin movimiento de stock, sin inventar un cierre", () => {
    const c = porId(
      calcularConciliacion({ ...base, ventasConMovimientoStock: 7 }),
      "S1",
    );
    expect(c.estado).toBe("NO_CIERRA");
    expect(c.diferencia).toBe(3);
    expect(c.explicacion).toContain("3 ventas");
  });

  it("K1 es SIN_DATO: no cierra ni falla, porque todavía no se cruza", () => {
    const k = porId(calcularConciliacion(base), "K1");
    expect(k.estado).toBe("SIN_DATO");
    expect(k.esperado).toBeNull();
    expect(k.diferencia).toBeNull();
  });

  it("devuelve los cuatro chequeos en orden", () => {
    expect(calcularConciliacion(base).map((c) => c.id)).toEqual(["V1", "C1", "S1", "K1"]);
  });
});
