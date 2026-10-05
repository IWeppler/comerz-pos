import { describe, expect, it } from "vitest";
import {
  avisoDelDia,
  cicloVigente,
  tipoAvisoDelDia,
  type DeudaPorVencimiento,
} from "./avisos-cc";
import type { ReglaVencimientoCc } from "./calcular-fecha-vencimiento";

// Regla de ejemplo: cierre el 5, vence el 15. (Colores usa cierre 1 desde
// 20261005170000; los casos no cambian de forma.)
const COLORES: ReglaVencimientoCc = {
  modo: "CIERRE_MENSUAL",
  plazoDias: 32,
  diaCierre: 5,
  diaVencimiento: 15,
};

describe("cicloVigente", () => {
  it("el día del cierre arranca el ciclo nuevo", () => {
    expect(cicloVigente(COLORES, "2026-10-05")).toEqual({
      cierre: "2026-10-05",
      venceEl: "2026-10-15",
    });
  });

  it("antes del cierre sigue el ciclo del mes anterior", () => {
    expect(cicloVigente(COLORES, "2026-10-04")).toEqual({
      cierre: "2026-09-05",
      venceEl: "2026-09-15",
    });
  });

  it("cruza el año", () => {
    expect(cicloVigente(COLORES, "2027-01-02")).toEqual({
      cierre: "2026-12-05",
      venceEl: "2026-12-15",
    });
  });

  it("vencimiento menor que el cierre: vence el mes siguiente", () => {
    const regla = { ...COLORES, diaCierre: 25, diaVencimiento: 10 };
    expect(cicloVigente(regla, "2026-10-05")).toEqual({
      cierre: "2026-09-25",
      venceEl: "2026-10-10",
    });
  });

  it("sin día de vencimiento, vence el día del cierre", () => {
    const regla = { ...COLORES, diaVencimiento: null };
    expect(cicloVigente(regla, "2026-10-07")).toEqual({
      cierre: "2026-10-05",
      venceEl: "2026-10-05",
    });
  });

  it("en modo días no hay ciclo", () => {
    expect(
      cicloVigente(
        { modo: "DIAS", plazoDias: 32, diaCierre: null, diaVencimiento: null },
        "2026-10-05",
      ),
    ).toBeNull();
  });
});

describe("tipoAvisoDelDia — Colores, ciclo del 5/10", () => {
  const ciclo = { cierre: "2026-10-05", venceEl: "2026-10-15" };

  it.each([
    ["2026-10-05", "CIERRE"],
    ["2026-10-12", "CIERRE"],
    ["2026-10-13", "PREVIO"],
    ["2026-10-15", "PREVIO"],
    ["2026-10-16", "MORA"],
    ["2026-11-04", "MORA"],
  ])("el %s es %s", (hoy, tipo) => {
    expect(tipoAvisoDelDia(ciclo, hoy)).toBe(tipo);
  });

  it("si vence el día del cierre, ese día es CIERRE y el siguiente MORA", () => {
    const mismoDia = { cierre: "2026-10-05", venceEl: "2026-10-05" };
    expect(tipoAvisoDelDia(mismoDia, "2026-10-05")).toBe("CIERRE");
    expect(tipoAvisoDelDia(mismoDia, "2026-10-06")).toBe("MORA");
  });
});

describe("avisoDelDia", () => {
  const deudas: DeudaPorVencimiento[] = [
    // EESO 405: todo vence el 15/10.
    { clienteId: "eeso", venceEl: "2026-10-15", vivo: 276450 },
    // Nati: lo del 4/9 venció el 15/9, lo del 29/9 vence el 15/10.
    { clienteId: "nati", venceEl: "2026-09-15", vivo: 14800 },
    { clienteId: "nati", venceEl: "2026-10-15", vivo: 302150 },
    // Compra del 5/10 en adelante: es del ciclo que viene.
    { clienteId: "nueva", venceEl: "2026-11-15", vivo: 5000 },
    // Ya pagado: no se avisa.
    { clienteId: "pagado", venceEl: "2026-10-15", vivo: 0 },
  ];

  it("el día del cierre avisa todo lo que vence hasta el 15, deuda vieja incluida", () => {
    expect(avisoDelDia(COLORES, "2026-10-05", deudas)).toEqual({
      tipo: "CIERRE",
      cierre: "2026-10-05",
      venceEl: "2026-10-15",
      clientes: [
        { clienteId: "nati", monto: 316950 },
        { clienteId: "eeso", monto: 276450 },
      ],
    });
  });

  it("quien solo arrastra deuda vieja también entra en el cierre", () => {
    const aviso = avisoDelDia(COLORES, "2026-10-05", [
      { clienteId: "vieja", venceEl: "2026-09-15", vivo: 8000 },
    ]);
    expect(aviso?.clientes).toEqual([{ clienteId: "vieja", monto: 8000 }]);
  });

  it("en mora entra todo lo vencido hasta el ciclo, también lo de antes", () => {
    const aviso = avisoDelDia(COLORES, "2026-10-16", deudas);
    expect(aviso?.tipo).toBe("MORA");
    expect(aviso?.clientes).toEqual([
      { clienteId: "nati", monto: 316950 },
      { clienteId: "eeso", monto: 276450 },
    ]);
  });

  it("lo del ciclo siguiente no entra en ningún aviso de este", () => {
    const aviso = avisoDelDia(COLORES, "2026-10-13", deudas);
    expect(aviso?.clientes.map((c) => c.clienteId)).not.toContain("nueva");
  });

  it("sin nadie a quien avisar devuelve null", () => {
    expect(avisoDelDia(COLORES, "2026-10-05", [])).toBeNull();
  });

  it("en modo días devuelve null", () => {
    expect(
      avisoDelDia(
        { modo: "DIAS", plazoDias: 32, diaCierre: null, diaVencimiento: null },
        "2026-10-05",
        deudas,
      ),
    ).toBeNull();
  });
});
