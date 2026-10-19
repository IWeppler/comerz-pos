import { describe, expect, it } from "vitest";
import { planCuotasDesdeMovimientos } from "./plan-cuotas-ticket";

const cuota = (n: number, total: number, monto: string, recargo: string, vence: string) => ({
  cuota_numero: n,
  cuotas_total: total,
  monto,
  monto_recargo: recargo,
  recargo_porcentaje: "20.00",
  vence_el: vence,
});

describe("planCuotasDesdeMovimientos", () => {
  it("arma el plan ordenado por número, como lo devuelve PostgREST (numeric en texto)", () => {
    const plan = planCuotasDesdeMovimientos([
      cuota(2, 3, "40000.00", "3333.33", "2026-12-19"),
      cuota(1, 3, "40000.00", "3333.33", "2026-11-19"),
      cuota(3, 3, "40000.00", "3333.34", "2027-01-19"),
    ]);
    expect(plan).toEqual({
      cuotas: 3,
      pct: 20,
      interes: 10000,
      detalle: [
        { numero: 1, monto: 40000, venceEl: "2026-11-19" },
        { numero: 2, monto: 40000, venceEl: "2026-12-19" },
        { numero: 3, monto: 40000, venceEl: "2027-01-19" },
      ],
    });
  });

  it("un fiado común no tiene plan", () => {
    expect(
      planCuotasDesdeMovimientos([
        { cuota_numero: null, cuotas_total: null, monto: "5000", monto_recargo: "0", recargo_porcentaje: "4.8", vence_el: null },
      ]),
    ).toBeNull();
    expect(planCuotasDesdeMovimientos([])).toBeNull();
    expect(planCuotasDesdeMovimientos(null)).toBeNull();
  });
});
