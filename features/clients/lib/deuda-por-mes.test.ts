import { describe, expect, it } from "vitest";
import {
  agruparDeudaPorMes,
  coberturaDelPago,
  deudaVivaDesdeFila,
  etiquetaDeuda,
  montosSugeridos,
  nombreMes,
  type DeudaViva,
} from "./deuda-por-mes";

function deuda(parcial: Partial<DeudaViva>): DeudaViva {
  return {
    debitoId: parcial.debitoId ?? crypto.randomUUID(),
    ventaId: null,
    numeroTicket: null,
    fecha: "2026-09-01",
    venceEl: "2026-10-01",
    descripcion: null,
    monto: 1000,
    vivo: 1000,
    esMoraHuerfana: false,
    ...parcial,
  };
}

describe("deudaVivaDesdeFila", () => {
  it("usa el número del comprobante cuando lo hay", () => {
    const d = deudaVivaDesdeFila({
      debito_id: "d1",
      venta_id: "9894267e-fbaf-4c7b-abef-d00a3c58e6d1",
      comprobante_punto_venta: 1,
      comprobante_numero: 422,
      fecha: "2026-09-03",
      vence_el: "2026-10-08",
      descripcion: "Compra Fiada - Ticket #9894267E",
      monto: "33125.00",
      vivo: "3675.00",
      es_mora_huerfana: false,
    });
    expect(d.numeroTicket).toBe("00001-00000422");
    expect(d.monto).toBe(33125);
    expect(d.vivo).toBe(3675);
    expect(etiquetaDeuda(d)).toBe("Ticket #00001-00000422");
  });

  it("sin comprobante cae al prefijo de la venta, como el resto de la app", () => {
    const d = deudaVivaDesdeFila({
      debito_id: "d1",
      venta_id: "744ed2df-478b-44e5-b5bc-a3c23b2c7dd2",
      fecha: "2026-09-12",
      vence_el: "2026-10-17",
      monto: 24300,
    });
    expect(d.numeroTicket).toBe("744ED2DF");
  });
});

describe("etiquetaDeuda", () => {
  it("sin venta usa la descripción de la dueña", () => {
    expect(
      etiquetaDeuda(deuda({ descripcion: "Saldo inicial importado (CSV)" })),
    ).toBe("Saldo inicial importado (CSV)");
  });

  it("un recargo suelto se llama recargo", () => {
    expect(
      etiquetaDeuda(deuda({ esMoraHuerfana: true, descripcion: "x" })),
    ).toBe("Recargo por mora");
  });
});

describe("nombreMes", () => {
  it("sin año si es el año de hoy, con año si no", () => {
    expect(nombreMes("2026-10", "2026-10-01")).toBe("Octubre");
    expect(nombreMes("2027-01", "2026-12-20")).toBe("Enero 2027");
  });
});

describe("agruparDeudaPorMes", () => {
  const HOY = "2026-10-10";

  it("lo vencido va junto y primero, después un grupo por mes de vencimiento", () => {
    const grupos = agruparDeudaPorMes(
      [
        deuda({ venceEl: "2026-11-05", vivo: 300 }),
        deuda({ venceEl: "2026-10-08", vivo: 100 }),
        deuda({ venceEl: "2026-09-30", vivo: 50 }),
        deuda({ venceEl: "2026-10-20", vivo: 200 }),
        deuda({ venceEl: "2026-10-25", vivo: 25 }),
      ],
      HOY,
    );
    expect(grupos.map((g) => [g.etiqueta, g.monto])).toEqual([
      ["Vencido", 150],
      ["Octubre", 225],
      ["Noviembre", 300],
    ]);
    expect(grupos[0].vencido).toBe(true);
    expect(grupos[1].vencido).toBe(false);
  });

  it("vence HOY no está vencido (mismo criterio que deuda_cc_vencida)", () => {
    const [grupo] = agruparDeudaPorMes([deuda({ venceEl: HOY })], HOY);
    expect(grupo.clave).toBe("2026-10");
    expect(grupo.vencido).toBe(false);
  });

  it("las deudas canceladas no aparecen", () => {
    expect(
      agruparDeudaPorMes([deuda({ vivo: 0 }), deuda({ vivo: -5 })], HOY),
    ).toEqual([]);
  });

  it("el total de los grupos es el total vivo, sin perder centavos", () => {
    const grupos = agruparDeudaPorMes(
      [
        deuda({ venceEl: "2026-10-11", vivo: 0.1 }),
        deuda({ venceEl: "2026-10-12", vivo: 0.2 }),
      ],
      HOY,
    );
    expect(grupos[0].monto).toBe(0.3);
  });
});

describe("coberturaDelPago", () => {
  const grupos = agruparDeudaPorMes(
    [
      deuda({ venceEl: "2026-10-01", vivo: 100 }),
      deuda({ venceEl: "2026-10-20", vivo: 200 }),
      deuda({ venceEl: "2026-11-20", vivo: 300 }),
    ],
    "2026-10-10",
  );

  it("la mora se paga primero, después lo más viejo", () => {
    expect(coberturaDelPago(grupos, 15, 215)).toEqual({
      completos: ["Vencido"],
      parcial: { etiqueta: "Octubre", cubre: 100, falta: 100 },
      sobra: 0,
    });
  });

  it("exacto a un mes: completo y sin parcial", () => {
    expect(coberturaDelPago(grupos, 0, 300)).toEqual({
      completos: ["Vencido", "Octubre"],
      parcial: null,
      sobra: 0,
    });
  });

  it("de más: dice cuánto sobra (queda a favor)", () => {
    expect(coberturaDelPago(grupos, 0, 650).sobra).toBe(50);
  });

  it("un pago que no alcanza la mora no cubre nada", () => {
    expect(coberturaDelPago(grupos, 15, 10)).toEqual({
      completos: [],
      parcial: null,
      sobra: 0,
    });
  });
});

describe("montosSugeridos", () => {
  it("son acumulados y la mora va en todos", () => {
    const grupos = agruparDeudaPorMes(
      [
        deuda({ venceEl: "2026-10-01", vivo: 100 }),
        deuda({ venceEl: "2026-10-20", vivo: 200 }),
        deuda({ venceEl: "2026-11-20", vivo: 300 }),
      ],
      "2026-10-10",
    );
    expect(montosSugeridos(grupos, 15)).toEqual([
      { etiqueta: "Lo vencido", monto: 115 },
      { etiqueta: "Hasta octubre", monto: 315 },
      { etiqueta: "Todo", monto: 615 },
    ]);
  });

  it("un solo grupo no se llama Todo: dice qué es", () => {
    const grupos = agruparDeudaPorMes(
      [deuda({ venceEl: "2026-10-20", vivo: 200 })],
      "2026-10-10",
    );
    expect(montosSugeridos(grupos, 0)).toEqual([
      { etiqueta: "Hasta octubre", monto: 200 },
    ]);
  });
});
