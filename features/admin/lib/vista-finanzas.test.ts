import { describe, expect, it } from "vitest";
import { armarVistaFinanzas, etiquetaMes } from "./vista-finanzas";
import type {
  GastoFinanciero,
  NegocioParaPrevision,
  PagoFinanciero,
} from "./finanzas-comerz";

const HOY = new Date("2026-10-23T15:00:00Z");
const CTX = { mepActual: 1557.8, mesActual: "2026-10" };

const gasto = (o: Partial<GastoFinanciero>): GastoFinanciero => ({
  tipo: "UNICO",
  mes: "2026-10-01",
  hasta: null,
  monto: 0,
  moneda: "ARS",
  montoUsd: null,
  cotizacion: null,
  ...o,
});

const pago = (id: string, negocioId: string, monto: number, fechaPago: string): PagoFinanciero => ({
  id,
  negocioId,
  monto,
  fechaPago,
});

const evens: NegocioParaPrevision = {
  id: "evens",
  estado: "activo",
  planVencimiento: "2026-11-14T03:00:00Z",
  precioMensual: 50000,
  modalidad: "mensual",
  cuentaEnMrr: true,
};

const nono: NegocioParaPrevision = {
  id: "nono",
  estado: "activo",
  planVencimiento: "2026-09-20T03:00:00Z",
  precioMensual: 50000,
  modalidad: "mensual",
  cuentaEnMrr: true,
};

describe("etiquetaMes", () => {
  it("abrevia el mes y el año", () => {
    expect(etiquetaMes("2026-10")).toBe("oct 26");
    expect(etiquetaMes("2027-01")).toBe("ene 27");
  });
});

describe("armarVistaFinanzas", () => {
  const pagos = [
    pago("e0", "evens", 30000, "2026-09-14"),
    pago("e1", "evens", 50000, "2026-10-11"),
    pago("c1", "colores", 50000, "2026-10-23"),
  ];
  const gastos = [
    gasto({ tipo: "FIJO", mes: "2026-09-01", monto: 33000, moneda: "USD", montoUsd: 20, cotizacion: 1650 }),
    gasto({ tipo: "UNICO", mes: "2026-10-01", monto: 50000 }),
  ];

  const vista = armarVistaFinanzas({ pagos, gastos, negocios: [evens, nono], hoy: HOY, ctx: CTX });

  it("arma 6 meses vividos (incluido el actual) y 6 por venir", () => {
    expect(vista.puntos).toHaveLength(12);
    expect(vista.puntos[0].mes).toBe("2026-05");
    expect(vista.puntos[5].mes).toBe("2026-10");
    expect(vista.puntos[5].esMesActual).toBe(true);
    expect(vista.puntos[11].mes).toBe("2027-04");
  });

  it("los meses por venir no traen datos reales, solo previsión", () => {
    const futuro = vista.puntos.slice(6);
    expect(futuro.every((p) => p.ingresosFijos === 0 && p.egresosFijos === 0)).toBe(true);
    expect(futuro.every((p) => p.acumulado === null)).toBe(true);
    expect(futuro[0].ingresosPrevistos).toBe(50000); // Evens renueva el 14/11
    expect(futuro[0].egresosPrevistos).toBe(31156); // Vercel a 20 USD
  });

  it("lo ganado del mes: renovación y primer pago, menos Vercel y la comisión", () => {
    expect(vista.mesActual.ingresosFijos).toBe(50000);
    expect(vista.mesActual.ingresosVariables).toBe(50000);
    expect(vista.mesActual.ganado).toBe(100000 - 31156 - 50000);
  });

  it("el acumulado real llega hasta hoy y la línea proyectada sigue desde ahí", () => {
    const actual = vista.puntos[5];
    expect(actual.acumulado).toBe(vista.acumuladoHoy);
    expect(actual.proyectado).toBe(vista.acumuladoHoy); // no falta cobrar nada este mes
    const siguiente = vista.puntos[6];
    expect(siguiente.proyectado).toBe(vista.acumuladoHoy + 50000 - 31156);
    expect(vista.netoProximoMes).toBe(50000 - 31156);
  });

  it("el comercio vencido va como riesgo, no suma a la línea", () => {
    expect(vista.enRiesgo).toBe(50000);
    expect(vista.puntos[5].enRiesgo).toBe(50000);
  });

  it("variación: sin nada el mes pasado devuelve null, no cero inventado", () => {
    const vacia = armarVistaFinanzas({ pagos: [], gastos: [], negocios: [], hoy: HOY, ctx: CTX });
    expect(vacia.mesAnterior).toBeNull();
    expect(vacia.acumuladoHoy).toBe(0);
    expect(vacia.netoProximoMes).toBe(0);
  });
});
