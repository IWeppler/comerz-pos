import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PagoCheckout } from "./preferencia-mp";
import {
  comisionDelPago,
  destinoDelPago,
  esAvisoDePago,
  leerAvisoMp,
  pagoParaLaBase,
  pagoQueDecideLaOrden,
  verificarFirmaMp,
} from "./webhook-mp";

const ORDEN = "11111111-1111-1111-1111-111111111111";
const NEGOCIO = "22222222-2222-2222-2222-222222222222";

describe("leer el aviso", () => {
  it("webhook nuevo: data.id en la query, user_id en el cuerpo, negocio de ?n=", () => {
    const aviso = leerAvisoMp(
      new URLSearchParams({ "data.id": "123456", type: "payment", n: NEGOCIO }),
      { action: "payment.updated", type: "payment", data: { id: "123456" }, user_id: 999, live_mode: true },
    );
    expect(aviso).toEqual({ tipo: "payment", recursoId: "123456", mpUserId: "999", negocioId: NEGOCIO });
    expect(esAvisoDePago(aviso)).toBe(true);
  });

  it("aviso viejo (IPN): ?topic=payment&id=", () => {
    const aviso = leerAvisoMp(new URLSearchParams({ topic: "payment", id: "77", n: NEGOCIO }), null);
    expect(aviso).toMatchObject({ tipo: "payment", recursoId: "77", mpUserId: null });
    expect(esAvisoDePago(aviso)).toBe(true);
  });

  it("otros tópicos o ids raros no son pagos", () => {
    expect(esAvisoDePago(leerAvisoMp(new URLSearchParams({ topic: "merchant_order", id: "77" }), null))).toBe(false);
    expect(esAvisoDePago(leerAvisoMp(new URLSearchParams({ type: "payment", "data.id": "abc" }), null))).toBe(false);
    expect(esAvisoDePago(leerAvisoMp(new URLSearchParams({ type: "payment" }), null))).toBe(false);
  });

  it("?n= que no es un uuid se descarta", () => {
    expect(leerAvisoMp(new URLSearchParams({ n: "1 or 1=1" }), null).negocioId).toBeNull();
  });
});

describe("firma x-signature", () => {
  const SECRETO = "clave-de-la-app";
  const firmar = (manifest: string) => createHmac("sha256", SECRETO).update(manifest).digest("hex");

  it("válida con el manifest de la documentación (id en minúscula)", () => {
    const v1 = firmar("id:ord01abc;request-id:req-1;ts:1704908010;");
    expect(
      verificarFirmaMp({ secreto: SECRETO, xSignature: `ts=1704908010,v1=${v1}`, xRequestId: "req-1", dataId: "ORD01ABC" }),
    ).toBe("VALIDA");
  });

  it("sin x-request-id, la parte se saca del manifest", () => {
    const v1 = firmar("id:123;ts:1704908010;");
    expect(verificarFirmaMp({ secreto: SECRETO, xSignature: `ts=1704908010, v1=${v1}`, xRequestId: null, dataId: "123" })).toBe("VALIDA");
  });

  it("otra clave, otro id u otro ts: inválida", () => {
    const v1 = firmar("id:123;request-id:r;ts:1;");
    expect(verificarFirmaMp({ secreto: "otra", xSignature: `ts=1,v1=${v1}`, xRequestId: "r", dataId: "123" })).toBe("INVALIDA");
    expect(verificarFirmaMp({ secreto: SECRETO, xSignature: `ts=1,v1=${v1}`, xRequestId: "r", dataId: "124" })).toBe("INVALIDA");
    expect(verificarFirmaMp({ secreto: SECRETO, xSignature: `ts=2,v1=${v1}`, xRequestId: "r", dataId: "123" })).toBe("INVALIDA");
    expect(verificarFirmaMp({ secreto: SECRETO, xSignature: "ts=1,v1=zz", xRequestId: "r", dataId: "123" })).toBe("INVALIDA");
  });

  it("sin header: SIN_FIRMA; con header pero sin clave configurada: INVALIDA", () => {
    expect(verificarFirmaMp({ secreto: SECRETO, xSignature: null, xRequestId: null, dataId: "1" })).toBe("SIN_FIRMA");
    expect(verificarFirmaMp({ secreto: undefined, xSignature: "ts=1,v1=" + "a".repeat(64), xRequestId: null, dataId: "1" })).toBe("INVALIDA");
  });
});

const pago = (over: Partial<PagoCheckout & { operation_type?: string }> = {}) => ({
  id: 1,
  status: "approved",
  status_detail: "accredited",
  transaction_amount: 45300,
  currency_id: "ARS",
  collector_id: 999,
  external_reference: ORDEN,
  payment_method_id: "consumer_credits",
  payment_type_id: "digital_currency",
  fee_details: [{ type: "mercadopago_fee", amount: 2700.5 }, { type: "financing_fee", amount: 0.25 }],
  ...over,
});

describe("el pago para la base", () => {
  it("comisión = lo que no le llega al comercio (monto − neto)", () => {
    // Ejemplo oficial de MP: $5 en 9 cuotas, el interés lo paga la clienta.
    const cuotas = pago({
      transaction_amount: 5,
      transaction_details: { net_received_amount: 4.7 },
      fee_details: [
        { type: "financing_fee", fee_payer: "payer", amount: 2.13 },
        { type: "mercadopago_fee", fee_payer: "collector", amount: 0.3 },
      ],
    });
    expect(comisionDelPago(cuotas)).toBe(0.3);
    // Con retenciones el neto baja más que la comisión: cuenta todo lo descontado.
    expect(
      comisionDelPago(
        pago({
          transaction_amount: 10000,
          transaction_details: { net_received_amount: 9200 },
          fee_details: [{ type: "mercadopago_fee", fee_payer: "collector", amount: 700 }],
        }),
      ),
    ).toBe(800);
  });

  it("sin el neto: solo los fee_details que paga el comercio", () => {
    expect(
      comisionDelPago(
        pago({
          fee_details: [
            { type: "mercadopago_fee", fee_payer: "collector", amount: 2700.5 },
            { type: "financing_fee", fee_payer: "payer", amount: 900 },
          ],
        }),
      ),
    ).toBe(2700.5);
    expect(comisionDelPago(pago({ fee_details: undefined }))).toBe(0);
  });

  it("aprobado lleva la comisión; los demás no (no la inventan)", () => {
    expect(pagoParaLaBase(pago())).toMatchObject({ mp_payment_id: "1", estado_mp: "approved", monto: 45300, moneda: "ARS", comision_monto: 2700.75 });
    expect(pagoParaLaBase(pago({ transaction_details: { net_received_amount: 43000 } })).resumen).toMatchObject({
      comision_mp: 2700.75,
      neto_recibido: 43000,
    });
    expect(pagoParaLaBase(pago({ status: "pending" }))).not.toHaveProperty("comision_monto");
  });

  it("no guarda nada de quién pagó", () => {
    const conPagador = { ...pago(), payer: { email: "x@y.com", identification: { number: "1" } } };
    expect(JSON.stringify(pagoParaLaBase(conPagador))).not.toContain("x@y.com");
  });
});

describe("a dónde va un pago leído de la API", () => {
  it("cobrado por otra cuenta: AJENO", () => {
    expect(destinoDelPago(pago({ collector_id: 1 }), "999")).toEqual({ tipo: "AJENO", motivo: "COLLECTOR" });
  });
  it("con la orden como referencia: a la orden", () => {
    expect(destinoDelPago(pago({ external_reference: ORDEN.toUpperCase() }), "999")).toEqual({ tipo: "ORDEN", ordenId: ORDEN });
  });
  it("con cc:<id>: al cobro de cuenta corriente; un cc: roto se ignora", () => {
    expect(destinoDelPago(pago({ external_reference: `cc:${ORDEN.toUpperCase()}` }), "999")).toEqual({ tipo: "COBRO_CC", cobroId: ORDEN });
    expect(destinoDelPago(pago({ external_reference: "cc:no-es-un-id" }), "999")).toEqual({ tipo: "IGNORAR" });
  });
  it("transferencia entrante sin referencia: a la conciliación por monto", () => {
    expect(destinoDelPago(pago({ external_reference: null, operation_type: "money_transfer" }), "999")).toEqual({ tipo: "TRANSFERENCIA" });
  });
  it("otra referencia (un QR del mostrador, otro sistema): se ignora", () => {
    expect(destinoDelPago(pago({ external_reference: "venta-123" }), "999")).toEqual({ tipo: "IGNORAR" });
    expect(destinoDelPago(pago({ external_reference: null, operation_type: "regular_payment" }), "999")).toEqual({ tipo: "IGNORAR" });
  });
});

describe("conciliación: el pago que decide la orden", () => {
  const base = { ordenId: ORDEN, total: 45300, estadoOrden: "PENDIENTE_PAGO", mpPaymentIdOrden: null, mpUserId: "999" };

  it("aprobado exacto gana sobre un rechazo y sobre otro con monto distinto", () => {
    const r = pagoQueDecideLaOrden({
      ...base,
      pagos: [pago({ id: 1, status: "rejected" }), pago({ id: 2, transaction_amount: 10 }), pago({ id: 3 })],
    });
    expect(r?.id).toBe(3);
  });

  it("solo uno aprobado con otro monto o moneda: ese (la base lo manda a REVISAR)", () => {
    expect(pagoQueDecideLaOrden({ ...base, pagos: [pago({ currency_id: "USD" })] })?.id).toBe(1);
  });

  it("en proceso: lo aplica sobre una pendiente, no sobre una que ya está en proceso", () => {
    expect(pagoQueDecideLaOrden({ ...base, pagos: [pago({ status: "in_process" })] })?.id).toBe(1);
    expect(pagoQueDecideLaOrden({ ...base, estadoOrden: "EN_PROCESO", pagos: [pago({ status: "in_process" })] })).toBeNull();
  });

  it("EN_PROCESO cuyo pago después rechazaron: ese rechazo", () => {
    const r = pagoQueDecideLaOrden({
      ...base,
      estadoOrden: "EN_PROCESO",
      mpPaymentIdOrden: "5",
      pagos: [pago({ id: 4, status: "rejected" }), pago({ id: 5, status: "rejected" })],
    });
    expect(r?.id).toBe(5);
  });

  it("solo rechazos sobre una pendiente: nada", () => {
    expect(pagoQueDecideLaOrden({ ...base, pagos: [pago({ status: "rejected" })] })).toBeNull();
  });

  it("otra orden u otra cuenta: no cuentan", () => {
    expect(pagoQueDecideLaOrden({ ...base, pagos: [pago({ external_reference: "otra" })] })).toBeNull();
    expect(pagoQueDecideLaOrden({ ...base, pagos: [pago({ collector_id: 1 })] })).toBeNull();
  });
});
