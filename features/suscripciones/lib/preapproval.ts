/**
 * La suscripción de Mercado Pago (preapproval) de un comercio a Comerz. PURA.
 * Decisiones en docs/suscripciones.md.
 *
 * - Sin plan asociado y `status: pending`: cada comercio tiene SU monto (precio
 *   acordado o de lista) y autoriza la tarjeta desde el link (`init_point`).
 * - `external_reference` = negocio: el webhook encuentra el comercio sin
 *   confiar en nada del aviso.
 * - PRIMER DÉBITO (regla aprobada el 12/10/2026): el día que vence lo que ya
 *   pagó, o ahora si ya venció. Nadie paga dos veces el mismo mes, el vencido
 *   paga al suscribirse y la prueba no se corta.
 */

export interface DatosPreapproval {
  negocioId: string;
  nombreNegocio: string;
  planNombre: string;
  monto: number;
  payerEmail: string;
  /** `negocios.plan_vencimiento`: medianoche UTC del día que vence. */
  vencimiento: string | null;
  urlRetorno: string;
}

/** Margen para no pedirle a MP un inicio "ya pasado" por segundos. */
const MARGEN_MS = 60 * 60 * 1000;

/**
 * Cuándo es el primer débito. Null = al suscribirse (ya venció o vence en
 * menos de una hora). Se cobra al mediodía argentino del día de vencimiento:
 * medianoche UTC es las 21 del día ANTERIOR en Argentina.
 */
export function inicioPrimerDebito(vencimiento: string | null, ahora: Date = new Date()): Date | null {
  if (!vencimiento) return null;
  const dia = String(vencimiento).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const mediodiaAr = new Date(`${dia}T15:00:00.000Z`);
  return mediodiaAr.getTime() - ahora.getTime() > MARGEN_MS ? mediodiaAr : null;
}

export function armarPreapproval(datos: DatosPreapproval, ahora: Date = new Date()) {
  const inicio = inicioPrimerDebito(datos.vencimiento, ahora);
  return {
    reason: `Comerz · Plan ${datos.planNombre} · ${datos.nombreNegocio}`.slice(0, 200),
    external_reference: datos.negocioId,
    payer_email: datos.payerEmail,
    back_url: datos.urlRetorno,
    status: "pending",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: Number(datos.monto),
      currency_id: "ARS",
      ...(inicio ? { start_date: inicio.toISOString() } : {}),
    },
  };
}

// ─── Lo que llega de MP ─────────────────────────────────────────────────

export type EstadoPreapproval = "pending" | "authorized" | "paused" | "cancelled";

export function estadoPreapproval(valor: unknown): EstadoPreapproval | null {
  return valor === "pending" || valor === "authorized" || valor === "paused" || valor === "cancelled"
    ? valor
    : null;
}

export interface PagoAutorizadoMp {
  id?: number | string;
  preapproval_id?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_created?: string;
  debit_date?: string;
  payment?: { id?: number | string; status?: string; status_detail?: string } | null;
}

export interface CobroSuscripcion {
  preapprovalId: string;
  mpPaymentId: string;
  monto: number;
  /** Día comercial argentino del cobro (YYYY-MM-DD). */
  fecha: string;
}

/**
 * Una cuota de la suscripción (`/authorized_payments/{id}`) que se cobró de
 * verdad: el pago adentro aprobado, en ARS y con monto. Si no, null (sigue
 * en reintentos o se rechazó: no mueve el vencimiento).
 */
export function cobroAprobado(pago: PagoAutorizadoMp): CobroSuscripcion | null {
  const monto = Number(pago.transaction_amount);
  if (
    pago.payment?.status !== "approved" ||
    pago.payment.id == null ||
    !pago.preapproval_id ||
    (pago.currency_id && pago.currency_id !== "ARS") ||
    !(monto > 0)
  ) {
    return null;
  }
  const cuando = new Date(pago.debit_date ?? pago.date_created ?? Date.now());
  const fecha = new Date(cuando.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { preapprovalId: pago.preapproval_id, mpPaymentId: String(pago.payment.id), monto, fecha };
}

const ID_MP = /^[A-Za-z0-9_-]{5,64}$/;
export const esIdMp = (valor: string | null | undefined): valor is string => !!valor && ID_MP.test(valor);
