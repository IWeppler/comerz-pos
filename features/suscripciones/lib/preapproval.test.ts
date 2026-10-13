import { describe, expect, it } from "vitest";
import { armarPreapproval, cobroAprobado, esIdMp, estadoPreapproval, inicioPrimerDebito } from "./preapproval";

const AHORA = new Date("2026-10-12T18:00:00Z");

describe("primer débito", () => {
  it("pagó hasta el 18/11: el primer débito es el 18/11 al mediodía argentino", () => {
    expect(inicioPrimerDebito("2026-11-18 00:00:00+00", AHORA)?.toISOString()).toBe("2026-11-18T15:00:00.000Z");
  });
  it("vencido (El Nono Cacho, 21/9): al suscribirse", () => {
    expect(inicioPrimerDebito("2026-09-21 22:47:50+00", AHORA)).toBeNull();
  });
  it("vence hoy en menos de una hora o sin vencimiento: al suscribirse", () => {
    expect(inicioPrimerDebito("2026-10-12", new Date("2026-10-12T14:30:00Z"))).toBeNull();
    expect(inicioPrimerDebito(null, AHORA)).toBeNull();
  });
  it("en prueba hasta el 26/10: se cobra el último día de la prueba", () => {
    expect(inicioPrimerDebito("2026-10-26T15:53:33.906693+00:00", AHORA)?.toISOString()).toBe("2026-10-26T15:00:00.000Z");
  });
});

describe("la preapproval", () => {
  const base = {
    negocioId: "11111111-1111-1111-1111-111111111111",
    nombreNegocio: "ClickTostado",
    planNombre: "Gestión",
    monto: 30000,
    payerEmail: "duenio@click.com",
    vencimiento: "2026-11-18 00:00:00+00",
    urlRetorno: "https://app.comerz.app/perfil?tab=plan",
  };

  it("pendiente, mensual, con el monto del comercio y el negocio como referencia", () => {
    const p = armarPreapproval(base, AHORA);
    expect(p).toMatchObject({
      status: "pending",
      external_reference: base.negocioId,
      payer_email: "duenio@click.com",
      reason: "Comerz · Plan Gestión · ClickTostado",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 30000,
        currency_id: "ARS",
        start_date: "2026-11-18T15:00:00.000Z",
      },
    });
  });

  it("vencido: sin start_date (MP cobra al suscribirse)", () => {
    expect(armarPreapproval({ ...base, vencimiento: "2026-09-28" }, AHORA).auto_recurring).not.toHaveProperty("start_date");
  });
});

describe("cuotas cobradas", () => {
  const cuota = {
    id: 7001,
    preapproval_id: "2c93808492",
    transaction_amount: 30000,
    currency_id: "ARS",
    debit_date: "2026-11-18T15:02:00.000Z",
    payment: { id: 991, status: "approved" },
  };

  it("aprobada: el cobro con el día argentino", () => {
    expect(cobroAprobado(cuota)).toEqual({ preapprovalId: "2c93808492", mpPaymentId: "991", monto: 30000, fecha: "2026-11-18" });
  });

  it("un débito a las 0:30 del 19 en UTC es el 18 en Argentina", () => {
    expect(cobroAprobado({ ...cuota, debit_date: "2026-11-19T00:30:00.000Z" })?.fecha).toBe("2026-11-18");
  });

  it("rechazada, en reintento, sin pago, en otra moneda o sin monto: no cuenta", () => {
    expect(cobroAprobado({ ...cuota, payment: { id: 991, status: "rejected" } })).toBeNull();
    expect(cobroAprobado({ ...cuota, payment: null })).toBeNull();
    expect(cobroAprobado({ ...cuota, currency_id: "USD" })).toBeNull();
    expect(cobroAprobado({ ...cuota, transaction_amount: 0 })).toBeNull();
  });
});

describe("helpers", () => {
  it("estados conocidos; lo demás es null", () => {
    expect(estadoPreapproval("authorized")).toBe("authorized");
    expect(estadoPreapproval("finished")).toBeNull();
  });
  it("ids de MP", () => {
    expect(esIdMp("2c938084726fca480172750000000000")).toBe(true);
    expect(esIdMp("../../etc")).toBe(false);
  });
});
