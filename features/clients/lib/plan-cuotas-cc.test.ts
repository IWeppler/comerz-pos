import { describe, expect, it } from "vitest";
import {
  armarPlanCuotasCc,
  mensajeRechazoPlanCuotas,
  tasaParaCuotas,
  vencimientosMensuales,
} from "./plan-cuotas-cc";

describe("mensajeRechazoPlanCuotas", () => {
  it("traduce cada rechazo de la base", () => {
    expect(mensajeRechazoPlanCuotas({ message: "PLAN_CUOTAS_OFFLINE" })).toContain("conexión");
    expect(mensajeRechazoPlanCuotas({ message: "PLAN_CUOTAS_TASA_DISTINTA" })).toContain("Recargá");
    expect(mensajeRechazoPlanCuotas({ message: "PLAN_CUOTAS_INTERES_DISTINTO" })).toContain("Recargá");
    expect(mensajeRechazoPlanCuotas({ message: "PLAN_CUOTAS_INVALIDO" })).toContain("Configuración");
  });

  it("otro error no es del plan", () => {
    expect(mensajeRechazoPlanCuotas({ message: "VENTA_SIN_RENGLONES" })).toBeNull();
    expect(mensajeRechazoPlanCuotas(null)).toBeNull();
  });
});

// Los mismos casos van en el guard de la migración contra la RPC.
describe("vencimientosMensuales", () => {
  it("un mes por cuota, mismo día", () => {
    expect(vencimientosMensuales("2026-10-19", 3)).toEqual([
      "2026-11-19",
      "2026-12-19",
      "2027-01-19",
    ]);
  });

  it("fin de mes: se cuenta desde la venta, no encadenado", () => {
    expect(vencimientosMensuales("2027-01-31", 4)).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
    ]);
  });

  it("año bisiesto", () => {
    expect(vencimientosMensuales("2028-01-30", 1)).toEqual(["2028-02-29"]);
  });

  it("cruza más de un año", () => {
    const v = vencimientosMensuales("2026-12-15", 13);
    expect(v[0]).toBe("2027-01-15");
    expect(v[11]).toBe("2027-12-15");
    expect(v[12]).toBe("2028-01-15");
  });
});

describe("tasaParaCuotas", () => {
  const tasas = [
    { cuotas: 3, pct: 10 },
    { cuotas: 6, pct: 20 },
  ];

  it("devuelve la tasa configurada", () => {
    expect(tasaParaCuotas(tasas, 6)).toEqual({ cuotas: 6, pct: 20 });
  });

  it("una cantidad no configurada no tiene tasa (no cae a un default)", () => {
    expect(tasaParaCuotas(tasas, 12)).toBeNull();
    expect(tasaParaCuotas(null, 3)).toBeNull();
  });
});

describe("armarPlanCuotasCc", () => {
  it("interés sobre lo financiado y la suma de cuotas = deuda", () => {
    const p = armarPlanCuotasCc(900_000, { cuotas: 6, pct: 20 }, "2026-10-19");
    expect(p.interes).toBe(180_000);
    expect(p.totalFinanciado).toBe(1_080_000);
    expect(p.detalle).toHaveLength(6);
    expect(p.detalle.every((c) => c.monto === 180_000)).toBe(true);
    expect(p.detalle[0]).toEqual({ numero: 1, monto: 180_000, venceEl: "2026-11-19" });
    expect(p.detalle[5].venceEl).toBe("2027-04-19");
  });

  it("los centavos que sobran van a la última cuota", () => {
    const p = armarPlanCuotasCc(100_000, { cuotas: 3, pct: 0 }, "2026-10-19");
    expect(p.detalle.map((c) => c.monto)).toEqual([33_333.33, 33_333.33, 33_333.34]);
    const suma = p.detalle.reduce((s, c) => s + Math.round(c.monto * 100), 0);
    expect(suma).toBe(Math.round(p.totalFinanciado * 100));
  });

  it("tasa 0 no agrega interés", () => {
    const p = armarPlanCuotasCc(50_000, { cuotas: 2, pct: 0 }, "2026-10-19");
    expect(p.interes).toBe(0);
    expect(p.totalFinanciado).toBe(50_000);
  });
});
