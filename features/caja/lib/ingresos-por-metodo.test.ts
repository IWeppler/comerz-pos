import { describe, expect, it } from "vitest";
import { ingresosPorMetodo } from "./ingresos-por-metodo";

describe("ingresosPorMetodo", () => {
  it("agrupa el bruto de ingresos por nombre de método y excluye egresos", () => {
    expect(ingresosPorMetodo([
      { tipo: "INGRESO", metodo: "Visa", monto: 12000 },
      { tipo: "EGRESO", metodo: "Visa", monto: 3000 },
      { tipo: "INGRESO", metodo: "Efectivo", monto: 8000 },
      { tipo: "INGRESO", metodo: "Visa", monto: 5000 },
    ])).toEqual([
      { metodo: "Visa", cantidad: 2, monto: 17000 },
      { metodo: "Efectivo", cantidad: 1, monto: 8000 },
    ]);
  });
});
