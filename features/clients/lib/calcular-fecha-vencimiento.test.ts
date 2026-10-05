import { describe, it, expect } from "vitest";
import {
  calcularFechaVencimiento,
  calcularVencimientoCc,
  fechaOrigenParaVencimiento,
  type ReglaVencimientoCc,
} from "./calcular-fecha-vencimiento";

describe("calcularFechaVencimiento", () => {
  it("suma los días al día calendario de la fecha de venta", () => {
    expect(calcularFechaVencimiento("2026-07-18T14:46:00.000Z", 30)).toBe(
      "2026-08-17",
    );
  });

  it("cruza correctamente un fin de mes/año", () => {
    expect(calcularFechaVencimiento("2026-12-15T00:00:00.000Z", 30)).toBe(
      "2027-01-14",
    );
  });

  it("ignora la hora del timestamp, solo usa el día calendario UTC", () => {
    expect(calcularFechaVencimiento("2026-07-18T23:59:59.000Z", 1)).toBe(
      calcularFechaVencimiento("2026-07-18T00:00:00.000Z", 1),
    );
  });

  it("acepta un objeto Date directamente", () => {
    const fecha = new Date(Date.UTC(2026, 0, 1));
    expect(calcularFechaVencimiento(fecha, 30)).toBe("2026-01-31");
  });
});

// Los mismos casos que el guard de 20261005140000 sobre `cc_vence_el`.
describe("calcularVencimientoCc — espejo de cc_vence_el", () => {
  const casos: [string, ReglaVencimientoCc, string][] = [
    [
      "2026-09-05",
      { modo: "DIAS", plazoDias: 32, diaCierre: null, diaVencimiento: null },
      "2026-10-07",
    ],
    [
      "2026-09-05",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 5,
        diaVencimiento: 15,
      },
      "2026-10-15",
    ],
    [
      "2026-10-04",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 5,
        diaVencimiento: 15,
      },
      "2026-10-15",
    ],
    [
      "2026-09-04",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 5,
        diaVencimiento: 15,
      },
      "2026-09-15",
    ],
    [
      "2026-12-20",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 5,
        diaVencimiento: 15,
      },
      "2027-01-15",
    ],
    [
      "2026-09-20",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 5,
        diaVencimiento: null,
      },
      "2026-10-05",
    ],
    [
      "2026-09-20",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 25,
        diaVencimiento: 10,
      },
      "2026-10-10",
    ],
    [
      "2026-09-27",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 25,
        diaVencimiento: 10,
      },
      "2026-11-10",
    ],
    [
      "2026-09-20",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 1,
        diaVencimiento: 10,
      },
      "2026-10-10",
    ],
    [
      "2026-09-01",
      {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 1,
        diaVencimiento: 10,
      },
      "2026-10-10",
    ],
    [
      "2026-09-20",
      { modo: null, plazoDias: null, diaCierre: null, diaVencimiento: null },
      "2026-10-20",
    ],
  ];

  it.each(casos)("%s con %j vence %s", (fecha, regla, esperado) => {
    expect(calcularVencimientoCc(fecha, regla)).toBe(esperado);
  });
});

describe("fechaOrigenParaVencimiento — la inversa para importar", () => {
  const reglas: ReglaVencimientoCc[] = [
    { modo: "DIAS", plazoDias: 32, diaCierre: null, diaVencimiento: null },
    { modo: "CIERRE_MENSUAL", plazoDias: 32, diaCierre: 5, diaVencimiento: 15 },
    {
      modo: "CIERRE_MENSUAL",
      plazoDias: 32,
      diaCierre: 5,
      diaVencimiento: null,
    },
    {
      modo: "CIERRE_MENSUAL",
      plazoDias: 32,
      diaCierre: 25,
      diaVencimiento: 10,
    },
  ];

  it.each(reglas)("vuelve al mismo vencimiento con %j", (regla) => {
    // Un vencimiento que la regla puede producir: el de una compra cualquiera.
    const vence = calcularVencimientoCc("2026-09-17", regla);
    const origen = fechaOrigenParaVencimiento(vence, regla);
    expect(calcularVencimientoCc(origen, regla)).toBe(vence);
  });

  it("Colores: lo que vence el 15/10 nació, a más tardar, el 4/10", () => {
    expect(
      fechaOrigenParaVencimiento("2026-10-15", {
        modo: "CIERRE_MENSUAL",
        plazoDias: 32,
        diaCierre: 5,
        diaVencimiento: 15,
      }),
    ).toBe("2026-10-04");
  });
});
