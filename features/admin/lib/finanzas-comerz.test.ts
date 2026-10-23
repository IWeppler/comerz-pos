import { describe, expect, it } from "vitest";
import {
  clasificarPagos,
  mesesEntre,
  montoEnPesos,
  pronosticar,
  resultadoDelMes,
  saldoProyectado,
  serieFinanciera,
  sumarMesesAFecha,
  sumarMesesAClave,
  type GastoFinanciero,
  type NegocioParaPrevision,
  type PagoFinanciero,
} from "./finanzas-comerz";

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

describe("montoEnPesos", () => {
  it("un gasto en pesos es su monto", () => {
    expect(montoEnPesos(gasto({ monto: 5000 }), "2026-10", CTX)).toBe(5000);
  });

  it("un ÚNICO en dólares queda congelado en los pesos con que se cargó", () => {
    const g = gasto({ monto: 33000, moneda: "USD", montoUsd: 21.18, cotizacion: 1558 });
    expect(montoEnPesos(g, "2026-10", { mepActual: 2000, mesActual: "2026-10" })).toBe(33000);
  });

  it("un FIJO en dólares va al MEP de hoy en el mes en curso y en los que vienen", () => {
    const g = gasto({ tipo: "FIJO", monto: 33000, moneda: "USD", montoUsd: 20, cotizacion: 1650 });
    expect(montoEnPesos(g, "2026-10", CTX)).toBe(31156);
    expect(montoEnPesos(g, "2027-02", CTX)).toBe(31156);
  });

  it("un FIJO en dólares de un mes pasado usa el MEP con que se cargó", () => {
    const g = gasto({ tipo: "FIJO", monto: 33000, moneda: "USD", montoUsd: 20, cotizacion: 1650 });
    expect(montoEnPesos(g, "2026-09", CTX)).toBe(33000);
  });

  it("sin cotización disponible cae a lo guardado en pesos, no a cero", () => {
    const g = gasto({ tipo: "FIJO", monto: 33000, moneda: "USD", montoUsd: 20 });
    expect(montoEnPesos(g, "2026-10", { mepActual: null, mesActual: "2026-10" })).toBe(33000);
  });
});

describe("clasificarPagos", () => {
  it("el primer pago de cada comercio es variable y los siguientes fijos", () => {
    const clases = clasificarPagos([
      pago("a2", "A", 50000, "2026-10-11"),
      pago("a1", "A", 30000, "2026-09-14"),
      pago("b1", "B", 30000, "2026-10-23"),
    ]);
    expect(clases.get("a1")).toBe("VARIABLE");
    expect(clases.get("a2")).toBe("FIJO");
    expect(clases.get("b1")).toBe("VARIABLE");
  });

  it("empate de fecha: gana el id menor, siempre el mismo", () => {
    const clases = clasificarPagos([
      pago("z", "A", 1, "2026-10-01"),
      pago("a", "A", 1, "2026-10-01"),
    ]);
    expect(clases.get("a")).toBe("VARIABLE");
    expect(clases.get("z")).toBe("FIJO");
  });
});

describe("resultadoDelMes: el caso de Colores y Romina", () => {
  // Colores paga su primera suscripción (50.000) y Romina cobra lo mismo como
  // comisión por haberlo conseguido: el mes no gana ni pierde por eso.
  const pagos = [
    pago("e1", "evens", 50000, "2026-10-11"),
    pago("e0", "evens", 30000, "2026-09-14"),
    pago("c1", "colores", 50000, "2026-10-23"),
  ];
  const gastos = [
    gasto({ tipo: "FIJO", mes: "2026-09-01", monto: 33000, moneda: "USD", montoUsd: 20, cotizacion: 1650 }),
    gasto({ tipo: "UNICO", mes: "2026-10-01", monto: 50000 }),
  ];

  it("separa fijos de variables y calcula lo ganado", () => {
    const r = resultadoDelMes(pagos, gastos, "2026-10", CTX);
    expect(r.ingresosFijos).toBe(50000); // la renovación de Evens
    expect(r.ingresosVariables).toBe(50000); // el primer pago de Colores
    expect(r.egresosFijos).toBe(31156); // Vercel, 20 USD al MEP de hoy
    expect(r.egresosVariables).toBe(50000); // la comisión de Romina
    expect(r.ganado).toBe(100000 - 31156 - 50000);
  });

  it("un mes sin movimientos da cero, no un hueco", () => {
    const r = resultadoDelMes(pagos, [], "2026-01", CTX);
    expect(r.ganado).toBe(0);
  });
});

describe("serieFinanciera", () => {
  it("acumula desde el primer cobro aunque sea anterior a la ventana", () => {
    const pagos = [pago("a", "A", 1000, "2026-08-10"), pago("b", "A", 1000, "2026-10-10")];
    const gastos = [gasto({ tipo: "UNICO", mes: "2026-09-01", monto: 300 })];
    const serie = serieFinanciera(pagos, gastos, ["2026-09", "2026-10"], CTX);
    // ago +1000 (fuera de la ventana pero cuenta), sep −300, oct +1000
    expect(serie.map((p) => p.acumulado)).toEqual([700, 1700]);
  });

  it("sin cobros arranca en el primer mes pedido", () => {
    const serie = serieFinanciera([], [gasto({ mes: "2026-10-01", monto: 100 })], ["2026-10"], CTX);
    expect(serie[0].acumulado).toBe(-100);
  });
});

describe("fechas", () => {
  it("sumar meses ajusta el día al largo del mes y no se corre", () => {
    expect(sumarMesesAFecha("2026-01-31", 1)).toBe("2026-02-28");
    expect(sumarMesesAFecha("2026-01-31", 2)).toBe("2026-03-31");
    expect(sumarMesesAFecha("2026-12-15", 1)).toBe("2027-01-15");
    expect(sumarMesesAClave("2026-11", 3)).toBe("2027-02");
    expect(mesesEntre("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("pronosticar", () => {
  const HOY = new Date("2026-10-23T15:00:00Z");
  const negocio = (o: Partial<NegocioParaPrevision>): NegocioParaPrevision => ({
    id: "n",
    estado: "activo",
    planVencimiento: "2026-11-14T03:00:00Z",
    precioMensual: 50000,
    modalidad: "mensual",
    cuentaEnMrr: true,
    ...o,
  });

  it("un comercio mensual renueva todos los meses desde su vencimiento", () => {
    const p = pronosticar([negocio({})], [], HOY, 4, CTX);
    expect(p.meses.map((m) => [m.mes, m.ingresosFijos])).toEqual([
      ["2026-10", 0], // ya venció el ciclo de octubre y está en la serie
      ["2026-11", 50000],
      ["2026-12", 50000],
      ["2027-01", 50000],
    ]);
  });

  it("un semestral cobra una vez cada seis meses, con el 20% de descuento", () => {
    const p = pronosticar(
      [negocio({ modalidad: "semestral", planVencimiento: "2026-11-14T03:00:00Z" })],
      [],
      HOY,
      8,
      CTX,
    );
    const cobros = p.meses.filter((m) => m.ingresosFijos > 0);
    expect(cobros.map((m) => m.mes)).toEqual(["2026-11", "2027-05"]);
    expect(cobros[0].ingresosFijos).toBe(240000); // 40.000 × 6
  });

  it("un plan vencido no es ingreso seguro: va en riesgo, en el mes actual", () => {
    const p = pronosticar([negocio({ planVencimiento: "2026-09-18T03:00:00Z" })], [], HOY, 3, CTX);
    expect(p.meses.every((m) => m.ingresosFijos === 0)).toBe(true);
    expect(p.meses[0].enRiesgo).toBe(50000);
  });

  it("no cuenta cortesías, comercios en prueba ni cancelados", () => {
    const p = pronosticar(
      [
        negocio({ id: "a", cuentaEnMrr: false }),
        negocio({ id: "b", estado: "prueba" }),
        negocio({ id: "c", estado: "cancelado" }),
        negocio({ id: "d", precioMensual: 0 }),
      ],
      [],
      HOY,
      3,
      CTX,
    );
    expect(p.meses.every((m) => m.ingresosFijos === 0 && m.enRiesgo === 0)).toBe(true);
  });

  it("un activo sin fecha de vencimiento se avisa y no se inventa", () => {
    const p = pronosticar([negocio({ planVencimiento: null })], [], HOY, 3, CTX);
    expect(p.sinFecha).toBe(1);
    expect(p.meses.every((m) => m.ingresosFijos === 0)).toBe(true);
  });

  it("los gastos fijos: el mes en curso ya está en la serie, los siguientes se suman", () => {
    const vercel = gasto({ tipo: "FIJO", mes: "2026-09-01", monto: 33000, moneda: "USD", montoUsd: 20, cotizacion: 1650 });
    const p = pronosticar([], [vercel], HOY, 3, CTX);
    expect(p.meses[0].egresosFijos).toBe(0);
    expect(p.meses[1].egresosFijos).toBe(31156);
    expect(p.meses[2].egresosFijos).toBe(31156);
  });

  it("un FIJO dado de baja deja de contar en el futuro", () => {
    const g = gasto({ tipo: "FIJO", mes: "2026-01-01", hasta: "2026-11-01", monto: 1000 });
    const p = pronosticar([], [g], HOY, 4, CTX);
    expect(p.meses.map((m) => m.egresosFijos)).toEqual([0, 1000, 0, 0]);
  });
});

describe("saldoProyectado", () => {
  it("parte de lo acumulado hoy y suma el neto de cada mes", () => {
    const prev = {
      sinFecha: 0,
      meses: [
        { mes: "2026-10", ingresosFijos: 0, enRiesgo: 0, egresosFijos: 0, neto: 0 },
        { mes: "2026-11", ingresosFijos: 100, enRiesgo: 0, egresosFijos: 30, neto: 70 },
        { mes: "2026-12", ingresosFijos: 100, enRiesgo: 0, egresosFijos: 30, neto: 70 },
      ],
    };
    expect(saldoProyectado(500, prev).map((p) => p.saldo)).toEqual([500, 570, 640]);
  });
});
