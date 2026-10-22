import { createHmac, timingSafeEqual } from "node:crypto";
import { PREFIJO_COBRO_CC, type PagoCheckout } from "./preferencia-mp";

/**
 * El webhook de Mercado Pago, la parte PURA (docs/pagos-auditoria.md §4.4 y §16).
 *
 * El aviso de MP no trae el estado del pago: solo "cambió el pago X". El
 * estado SIEMPRE se lee de la API con el token del comercio. Por eso la firma
 * protege poco más que el costo de esa lectura, y el webhook acepta dos formas:
 *   - FIRMADO (`x-signature` válida con la clave de la app): se lee ESE pago y
 *     se aplica (`aplicar_pago_mp_orden`).
 *   - SIN FIRMA (el aviso viejo de `notification_url`, que MP puede mandar sin
 *     firmar): solo dispara la conciliación del negocio, que tiene su propio
 *     límite de una vez cada 30 s. Un aviso inventado no logra nada más que eso.
 *   - Firma presente pero INVÁLIDA: 401.
 */

// ─── El aviso ───────────────────────────────────────────────────────────

export interface AvisoMp {
  /** "payment", "merchant_order", "mp-connect", … */
  tipo: string | null;
  /** El id del recurso (`data.id` de la query, o `id` del aviso viejo). */
  recursoId: string | null;
  /** Cuenta de MP del vendedor (solo viene en el cuerpo del webhook nuevo). */
  mpUserId: string | null;
  /** `?n=<negocio>` que pone Comerz en la notification_url de cada preference. */
  negocioId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PAGO = /^[0-9]{1,20}$/;

export function leerAvisoMp(query: URLSearchParams, cuerpo: unknown): AvisoMp {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as {
    type?: unknown;
    topic?: unknown;
    data?: { id?: unknown };
    user_id?: unknown;
  };
  const tipo = query.get("type") ?? query.get("topic") ?? (typeof c.type === "string" ? c.type : null) ??
    (typeof c.topic === "string" ? c.topic : null);
  const recursoId = query.get("data.id") ?? query.get("id") ??
    (c.data?.id != null ? String(c.data.id) : null);
  const mpUserId = c.user_id != null && /^[0-9]{1,20}$/.test(String(c.user_id)) ? String(c.user_id) : null;
  const n = query.get("n");
  return {
    tipo,
    recursoId: recursoId && recursoId.length <= 64 ? recursoId : null,
    mpUserId,
    negocioId: n && UUID.test(n) ? n.toLowerCase() : null,
  };
}

/** Solo los pagos le importan a Comerz; el id tiene que ser numérico. */
export function esAvisoDePago(aviso: AvisoMp): aviso is AvisoMp & { recursoId: string } {
  return aviso.tipo === "payment" && aviso.recursoId != null && ID_PAGO.test(aviso.recursoId);
}

// ─── La firma ───────────────────────────────────────────────────────────

export type VeredictoFirma = "VALIDA" | "SIN_FIRMA" | "INVALIDA";

/**
 * `x-signature: ts=<ts>,v1=<hmac>`. Manifest:
 * `id:<data.id en minúscula>;request-id:<x-request-id>;ts:<ts>;`, sacando las
 * partes que no vinieron. HMAC-SHA256 en hex con la clave secreta de la app.
 * Comparación en tiempo constante.
 *
 * No se rechazan `ts` viejos: un aviso auténtico repetido solo hace releer el
 * pago, y la aplicación es idempotente. Rechazarlos arriesga perder los
 * reintentos de MP si reusan el `ts` original.
 */
export function verificarFirmaMp({
  secreto,
  xSignature,
  xRequestId,
  dataId,
}: {
  secreto: string | null | undefined;
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
}): VeredictoFirma {
  if (!xSignature) return "SIN_FIRMA";
  if (!secreto) return "INVALIDA";

  let ts: string | null = null;
  let v1: string | null = null;
  for (const parte of xSignature.split(",")) {
    const [clave, ...resto] = parte.split("=");
    const valor = resto.join("=").trim();
    if (clave?.trim() === "ts") ts = valor;
    if (clave?.trim() === "v1") v1 = valor;
  }
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return "INVALIDA";

  const manifest =
    (dataId ? `id:${dataId.toLowerCase()};` : "") +
    (xRequestId ? `request-id:${xRequestId};` : "") +
    `ts:${ts};`;
  const esperado = createHmac("sha256", secreto).update(manifest).digest();
  const recibido = Buffer.from(v1, "hex");
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado) ? "VALIDA" : "INVALIDA";
}

// ─── El pago → lo que se le pasa a la base ──────────────────────────────

export interface PagoMpCompleto extends PagoCheckout {
  operation_type?: string;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** La comisión de Mercado Pago que paga el COMERCIO (`fee_payer` collector). */
export function comisionMpDelComercio(pago: PagoCheckout): number {
  return centavos(
    (pago.fee_details ?? [])
      .filter((f) => f.fee_payer !== "payer")
      .reduce((suma, f) => suma + (Number(f.amount) || 0), 0),
  );
}

/**
 * Lo que el comercio NO recibe de un pago: `transaction_amount` menos
 * `net_received_amount` (comisión de Mercado Pago + impuestos y retenciones que
 * le descuentan). Es lo que se guarda como comisión del cobro: la plata que
 * entra a la cuenta es el neto. Sin el neto, la comisión del comercio.
 *
 * NUNCA la suma de todos los `fee_details` (así estaba hasta el 22/10/2026,
 * sin pagos reales todavía): el interés de las cuotas (`financing_fee`,
 * `fee_payer: payer`) lo paga la clienta encima del precio y no es costo del
 * comercio. Ejemplo oficial de Mercado Pago: $5 en 9 cuotas, financing_fee
 * $2,13 (payer), mercadopago_fee $0,30 (collector), neto $4,70.
 */
export function comisionDelPago(pago: PagoCheckout): number {
  const monto = Number(pago.transaction_amount);
  const neto = pago.transaction_details?.net_received_amount;
  if (neto != null && Number.isFinite(Number(neto)) && Number.isFinite(monto) && Number(neto) <= monto) {
    return centavos(Math.max(0, monto - Number(neto)));
  }
  return comisionMpDelComercio(pago);
}

/** `p_pago` de `aplicar_pago_mp_orden`. Solo la forma del pago: nada de quién pagó. */
export function pagoParaLaBase(pago: PagoCheckout) {
  return {
    mp_payment_id: String(pago.id),
    estado_mp: pago.status ?? null,
    monto: pago.transaction_amount ?? null,
    moneda: pago.currency_id ?? null,
    ...(pago.status === "approved" ? { comision_monto: comisionDelPago(pago) } : {}),
    resumen: {
      payment_method_id: pago.payment_method_id ?? null,
      payment_type_id: pago.payment_type_id ?? null,
      status_detail: pago.status_detail ?? null,
      date_approved: pago.date_approved ?? null,
      // Desglose de lo descontado: comisión de MP y el resto (impuestos y
      // retenciones), para auditar el número guardado como comisión.
      ...(pago.status === "approved"
        ? {
            comision_mp: comisionMpDelComercio(pago),
            neto_recibido: pago.transaction_details?.net_received_amount ?? null,
            cuotas_a_cargo_cliente: centavos(
              (pago.fee_details ?? [])
                .filter((f) => f.fee_payer === "payer")
                .reduce((suma, f) => suma + (Number(f.amount) || 0), 0),
            ),
          }
        : {}),
    },
  };
}

// ─── Qué hacer con un pago leído de la API ──────────────────────────────

export type DestinoPago =
  | { tipo: "ORDEN"; ordenId: string }
  | { tipo: "COBRO_CC"; cobroId: string }
  | { tipo: "TRANSFERENCIA" }
  | { tipo: "AJENO"; motivo: "COLLECTOR" }
  | { tipo: "IGNORAR" };

/**
 * Un pago leído con el token del comercio. Si lo cobró otra cuenta, no se
 * toca nada. Con `external_reference` de una orden, a la orden; con `cc:<id>`,
 * al cobro de cuenta corriente. Sin
 * referencia y entrante (transferencia al alias), a la conciliación por monto.
 */
export function destinoDelPago(pago: PagoMpCompleto, mpUserId: string): DestinoPago {
  if (String(pago.collector_id ?? "") !== mpUserId) return { tipo: "AJENO", motivo: "COLLECTOR" };
  const ref = pago.external_reference ?? null;
  if (ref && UUID.test(ref)) return { tipo: "ORDEN", ordenId: ref.toLowerCase() };
  // El pago de una cuenta corriente desde el resumen (`cc:<intento>`).
  if (ref?.startsWith(PREFIJO_COBRO_CC)) {
    const id = ref.slice(PREFIJO_COBRO_CC.length);
    return UUID.test(id) ? { tipo: "COBRO_CC", cobroId: id.toLowerCase() } : { tipo: "IGNORAR" };
  }
  if (!ref && (pago.operation_type === "money_transfer" || pago.operation_type === "account_fund")) {
    return { tipo: "TRANSFERENCIA" };
  }
  return { tipo: "IGNORAR" };
}

// ─── Conciliación: de todos los pagos de una orden, cuál decide ─────────

const EN_PROCESO = new Set(["pending", "in_process", "authorized"]);
const RECHAZADO = new Set(["rejected", "cancelled"]);

/**
 * La red de seguridad del webhook: de los pagos de una orden pendiente
 * (buscados por `external_reference`), el que hay que aplicar.
 *   1. aprobado con el monto exacto (paga la orden);
 *   2. aprobado con otro monto (la manda a REVISAR);
 *   3. en proceso (EN_PROCESO);
 *   4. si la orden estaba EN_PROCESO por un pago que después rechazaron, ese.
 * Solo pagos de la cuenta conectada y de ESTA orden.
 */
export function pagoQueDecideLaOrden({
  ordenId,
  total,
  estadoOrden,
  mpPaymentIdOrden,
  pagos,
  mpUserId,
}: {
  ordenId: string;
  total: number;
  estadoOrden: string;
  mpPaymentIdOrden: string | null;
  pagos: PagoCheckout[];
  mpUserId: string;
}): PagoCheckout | null {
  const propios = pagos.filter(
    (p) => p.external_reference === ordenId && String(p.collector_id ?? "") === mpUserId,
  );
  const aprobados = propios.filter((p) => p.status === "approved");
  const exacto = aprobados.find(
    (p) => p.currency_id === "ARS" && Math.abs(Number(p.transaction_amount) - Number(total)) < 0.005,
  );
  if (exacto) return exacto;
  if (aprobados.length) return aprobados[0];
  const enProceso = propios.find((p) => EN_PROCESO.has(p.status ?? ""));
  if (enProceso) return estadoOrden === "PENDIENTE_PAGO" ? enProceso : null;
  if (estadoOrden === "EN_PROCESO" && mpPaymentIdOrden) {
    const caido = propios.find((p) => String(p.id) === mpPaymentIdOrden && RECHAZADO.has(p.status ?? ""));
    if (caido) return caido;
  }
  return null;
}
