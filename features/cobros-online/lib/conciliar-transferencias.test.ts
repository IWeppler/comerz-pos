import { describe, expect, it } from "vitest";
import {
  conciliarTransferencias,
  esTransferenciaEntrante,
  type OrdenPendienteTransferencia,
  type PagoMp,
} from "./conciliar-transferencias";

const MP = "221653922";
const base = new Date("2026-10-12T15:00:00Z");
const min = (m: number) => new Date(base.getTime() + m * 60_000);

const orden = (over: Partial<OrdenPendienteTransferencia> = {}): OrdenPendienteTransferencia => ({
  id: "o1",
  total: 45300,
  creadoEn: base,
  venceEn: min(120),
  ...over,
});

// La forma real que devolvió el spike (sin datos personales).
const transferencia = (over: Partial<PagoMp> = {}): PagoMp => ({
  id: 182609483771,
  status: "approved",
  operation_type: "money_transfer",
  payment_type_id: "account_money",
  transaction_amount: 45300,
  currency_id: "ARS",
  date_approved: min(10).toISOString(),
  date_created: min(10).toISOString(),
  collector_id: 221653922,
  external_reference: null,
  ...over,
});

describe("qué cuenta como transferencia entrante", () => {
  it("desde otra cuenta de MP y desde un banco al CVU", () => {
    expect(esTransferenciaEntrante(transferencia(), MP)).toBe(true);
    expect(
      esTransferenciaEntrante(transferencia({ operation_type: "account_fund", payment_type_id: "bank_transfer" }), MP),
    ).toBe(true);
  });

  it.each([
    ["un pago de checkout (tiene referencia)", { external_reference: "orden-x", operation_type: "regular_payment" }],
    ["un pago con referencia aunque sea transferencia", { external_reference: "algo" }],
    ["un pago a otra cuenta", { collector_id: 1 }],
    ["un pago pendiente", { status: "pending" }],
    ["en dólares", { currency_id: "USD" }],
    ["una suscripción", { operation_type: "recurring_payment" }],
  ])("no: %s", (_, over) => {
    expect(esTransferenciaEntrante(transferencia(over), MP)).toBe(false);
  });
});

describe("conciliar", () => {
  it("monto exacto dentro de la ventana: coincide", () => {
    const r = conciliarTransferencias({ ordenes: [orden()], pagos: [transferencia()], mpUserId: MP });
    expect(r.coincidencias.map((c) => c.ordenId)).toEqual(["o1"]);
    expect(r.ambiguas).toBe(0);
  });

  it("un peso de diferencia no coincide", () => {
    const r = conciliarTransferencias({ ordenes: [orden()], pagos: [transferencia({ transaction_amount: 45299 })], mpUserId: MP });
    expect(r.coincidencias).toEqual([]);
  });

  it("antes de la orden (fuera de la tolerancia) o después de que venció, no", () => {
    for (const fecha of [min(-10), min(121)]) {
      const r = conciliarTransferencias({
        ordenes: [orden()],
        pagos: [transferencia({ date_approved: fecha.toISOString() })],
        mpUserId: MP,
      });
      expect(r.coincidencias).toEqual([]);
    }
    const justo = conciliarTransferencias({
      ordenes: [orden()],
      pagos: [transferencia({ date_approved: min(-1).toISOString() })],
      mpUserId: MP,
    });
    expect(justo.coincidencias).toHaveLength(1);
  });

  it("dos órdenes con el mismo monto: no adivina", () => {
    const r = conciliarTransferencias({
      ordenes: [orden({ id: "o1" }), orden({ id: "o2" })],
      pagos: [transferencia()],
      mpUserId: MP,
    });
    expect(r.coincidencias).toEqual([]);
    expect(r.ambiguas).toBe(1);
  });

  it("dos transferencias iguales para una orden: no adivina", () => {
    const r = conciliarTransferencias({
      ordenes: [orden()],
      pagos: [transferencia({ id: 1 }), transferencia({ id: 2 })],
      mpUserId: MP,
    });
    expect(r.coincidencias).toEqual([]);
    expect(r.ambiguas).toBe(2);
  });

  it("un pago ya usado por otra orden no se vuelve a usar", () => {
    const r = conciliarTransferencias({
      ordenes: [orden()],
      pagos: [transferencia({ id: 99 })],
      mpUserId: MP,
      pagosYaUsados: new Set(["99"]),
    });
    expect(r.coincidencias).toEqual([]);
  });

  it("varias órdenes con montos distintos se concilian cada una con la suya", () => {
    const r = conciliarTransferencias({
      ordenes: [orden({ id: "a", total: 10000 }), orden({ id: "b", total: 20000 })],
      pagos: [transferencia({ id: 1, transaction_amount: 20000 }), transferencia({ id: 2, transaction_amount: 10000 })],
      mpUserId: MP,
    });
    expect(Object.fromEntries(r.coincidencias.map((c) => [c.ordenId, c.pago.id]))).toEqual({ a: 2, b: 1 });
  });
});
