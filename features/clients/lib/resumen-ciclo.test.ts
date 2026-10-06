import { describe, expect, it } from "vitest";
import {
  corteResumenCc,
  montoHastaCorte,
  movimientosHastaCorte,
  type MovimientoResumenCc,
} from "./resumen-ciclo";
import type { ReglaVencimientoCc } from "./calcular-fecha-vencimiento";

// Librería Colores desde 20261005170000: cierre 1, vence 15.
const COLORES: ReglaVencimientoCc = {
  modo: "CIERRE_MENSUAL",
  plazoDias: 32,
  diaCierre: 1,
  diaVencimiento: 15,
};

const DIAS: ReglaVencimientoCc = {
  modo: "DIAS",
  plazoDias: 30,
  diaCierre: null,
  diaVencimiento: null,
};

describe("corteResumenCc", () => {
  it("en modo días no recorta", () => {
    expect(
      corteResumenCc(DIAS, "2026-10-06", [{ venceEl: "2026-10-20", vivo: 100 }]),
    ).toBeNull();
  });

  it("sin deuda no recorta", () => {
    expect(corteResumenCc(COLORES, "2026-10-06", [])).toBeNull();
  });

  it("con deuda del ciclo corta en el vencimiento del ciclo, deuda vieja incluida", () => {
    expect(
      corteResumenCc(COLORES, "2026-10-06", [
        { venceEl: "2026-09-15", vivo: 500 },
        { venceEl: "2026-10-15", vivo: 1000 },
        { venceEl: "2026-11-15", vivo: 300 },
      ]),
    ).toBe("2026-10-15");
  });

  it("solo con deuda vieja también corta en el ciclo", () => {
    expect(
      corteResumenCc(COLORES, "2026-10-06", [
        { venceEl: "2026-09-15", vivo: 500 },
        { venceEl: "2026-11-15", vivo: 300 },
      ]),
    ).toBe("2026-10-15");
  });

  it("después del vencimiento (impagos) el ciclo sigue hasta el próximo cierre", () => {
    expect(
      corteResumenCc(COLORES, "2026-10-20", [
        { venceEl: "2026-10-15", vivo: 1000 },
        { venceEl: "2026-11-15", vivo: 300 },
      ]),
    ).toBe("2026-10-15");
  });

  it("si solo debe del mes que viene, el corte es ese vencimiento", () => {
    expect(
      corteResumenCc(COLORES, "2026-10-06", [
        { venceEl: "2026-10-15", vivo: 0 },
        { venceEl: "2026-11-15", vivo: 300 },
      ]),
    ).toBe("2026-11-15");
  });
});

describe("montoHastaCorte", () => {
  it("suma lo que vence hasta el corte, sin lo del mes que viene", () => {
    expect(
      montoHastaCorte(
        [
          { venceEl: "2026-09-15", vivo: 500.1 },
          { venceEl: "2026-10-15", vivo: 1000.2 },
          { venceEl: "2026-11-15", vivo: 300 },
        ],
        "2026-10-15",
      ),
    ).toBe(1500.3);
  });
});

describe("movimientosHastaCorte", () => {
  const movs: MovimientoResumenCc[] = [
    { fecha: "2026-09-10", concepto: "Compra", tipo: "DEBITO", monto: 1000, saldo: 1500, vence_el: "2026-10-15" },
    { fecha: "2026-10-02", concepto: "Compra", tipo: "DEBITO", monto: 300, saldo: 1800, vence_el: "2026-11-15" },
    { fecha: "2026-10-03", concepto: "Pago", tipo: "CREDITO", monto: 200, saldo: 1600, vence_el: null },
    { fecha: "2026-10-05", concepto: "Mora", tipo: "DEBITO", monto: 50, saldo: 1650, vence_el: "2026-10-15" },
  ];

  it("saca los cargos del mes que viene y recalcula el saldo", () => {
    const out = movimientosHastaCorte(movs, 500, "2026-10-15");
    expect(out.map((m) => [m.concepto, m.saldo])).toEqual([
      ["Compra", 1500],
      ["Pago", 1300],
      ["Mora", 1350],
    ]);
  });

  it("un cargo sin vencimiento conocido se muestra", () => {
    const out = movimientosHastaCorte(
      [{ fecha: "2026-10-02", concepto: "Compra", tipo: "DEBITO", monto: 300, saldo: 300, vence_el: null }],
      0,
      "2026-10-15",
    );
    expect(out).toHaveLength(1);
  });
});
