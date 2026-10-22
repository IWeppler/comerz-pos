/**
 * La preference de Checkout Pro para una orden de la tienda. PURA.
 *
 * Verificado en la documentación oficial (docs/pagos-auditoria.md §4.2 y §4.3):
 *   - se crea con el token del COMERCIO: la plata entra directo a su cuenta;
 *   - `external_reference` = id de la orden: así el webhook y la conciliación
 *     encuentran la orden sin confiar en nada que venga del navegador;
 *   - `notification_url` por preference (tiene prioridad sobre la del panel);
 *   - vence junto con la orden (`expires` + `expiration_date_to`);
 *   - "Cuotas sin tarjeta" es la MISMA preference con
 *     `purpose: "onboarding_credits"`: preselecciona el crédito, no lo fuerza.
 *     El medio real se lee del pago, no de este botón.
 *
 * UN SOLO ÍTEM con el total de la orden, no un ítem por renglón: el total ya
 * tiene descuentos, recargo y envío, y repartirlos por renglón es una cuenta
 * más que puede no cerrar al centavo. Lo que la clienta paga tiene que ser
 * EXACTAMENTE el total de la orden (el webhook lo compara).
 *
 * Sin Rapipago/Pago Fácil (`ticket`) ni cajeros (`atm`): dejan la orden
 * pendiente días, y la orden aparta stock por una hora.
 */

export interface DatosPreferencia {
  ordenId: string;
  negocioId: string;
  numero: number;
  total: number;
  medio: "MP_CHECKOUT" | "MP_CREDITO";
  nombreComercio: string | null;
  clienteNombre: string;
  venceEn: Date;
  /** Página de la orden en la tienda: a donde vuelve la clienta. */
  urlRetorno: string;
  /** Webhook de Comerz. Null en local (MP exige https). */
  urlNotificacion: string | null;
}

/** "2026-10-12T15:00:00.000-03:00": el formato de los ejemplos de MP, en hora argentina. */
export function fechaParaMp(fecha: Date): string {
  const argentina = new Date(fecha.getTime() - 3 * 60 * 60 * 1000);
  return `${argentina.toISOString().slice(0, 23)}-03:00`;
}

export function numeroDeOrdenMp(numero: number): string {
  return `#${String(numero).padStart(5, "0")}`;
}

export function armarPreferencia(datos: DatosPreferencia, ahora: Date = new Date()) {
  const https = datos.urlRetorno.startsWith("https://");
  const titulo = `Orden ${numeroDeOrdenMp(datos.numero)}${datos.nombreComercio ? ` · ${datos.nombreComercio}` : ""}`;

  return {
    items: [
      {
        id: datos.ordenId,
        title: titulo.slice(0, 250),
        quantity: 1,
        unit_price: Number(datos.total),
        currency_id: "ARS",
      },
    ],
    payer: { name: datos.clienteNombre.slice(0, 120) },
    external_reference: datos.ordenId,
    ...(datos.urlNotificacion ? { notification_url: datos.urlNotificacion } : {}),
    back_urls: {
      success: datos.urlRetorno,
      pending: datos.urlRetorno,
      failure: datos.urlRetorno,
    },
    // MP rechaza `auto_return` con una URL que no es https (local, previews).
    ...(https ? { auto_return: "approved" } : {}),
    expires: true,
    expiration_date_from: fechaParaMp(ahora),
    expiration_date_to: fechaParaMp(datos.venceEn),
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
    },
    ...(datos.medio === "MP_CREDITO" ? { purpose: "onboarding_credits" } : {}),
    metadata: { orden_id: datos.ordenId, negocio_id: datos.negocioId },
  };
}

// ─── El pago de una orden de checkout ────────────────────────────────────

export interface PagoCheckout {
  id: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  collector_id?: number | string;
  external_reference?: string | null;
  payment_method_id?: string;
  payment_type_id?: string;
  date_approved?: string | null;
  /** `fee_payer`: "collector" lo paga el comercio; "payer" lo paga la clienta
   * (el interés de las cuotas, `financing_fee`). */
  fee_details?: { type?: string; amount?: number; fee_payer?: string }[];
  /** `net_received_amount`: lo que le queda al comercio después de comisión e
   * impuestos que le descuenta Mercado Pago. */
  transaction_details?: { net_received_amount?: number | null } | null;
}

// ─── El pago de la cuenta corriente desde el resumen ─────────────────────

/** `external_reference` de un cobro de cuenta corriente: el prefijo separa la
 * deuda de las órdenes de la tienda (que usan el id pelado). */
export const PREFIJO_COBRO_CC = "cc:";

export function referenciaCobroCc(cobroId: string): string {
  return `${PREFIJO_COBRO_CC}${cobroId}`;
}

export interface DatosPreferenciaCobroCc {
  cobroId: string;
  negocioId: string;
  total: number;
  nombreComercio: string | null;
  clienteNombre: string;
  venceEn: Date;
  /** El resumen de la clienta: a donde vuelve. */
  urlRetorno: string;
  urlNotificacion: string | null;
}

/**
 * La preference de un pago de cuenta corriente (docs/cuenta-corriente.md,
 * 22/10/2026). Mismas reglas que la de una orden: un ítem con el total exacto
 * (el webhook lo compara contra el intento), vence con el intento y sin
 * Rapipago/Pago Fácil (un pago que llega días después ya no es esta deuda).
 */
export function armarPreferenciaCobroCc(datos: DatosPreferenciaCobroCc, ahora: Date = new Date()) {
  const https = datos.urlRetorno.startsWith("https://");
  const titulo = `Cuenta corriente${datos.nombreComercio ? ` · ${datos.nombreComercio}` : ""}`;
  return {
    items: [
      {
        id: datos.cobroId,
        title: titulo.slice(0, 250),
        quantity: 1,
        unit_price: Number(datos.total),
        currency_id: "ARS",
      },
    ],
    payer: { name: datos.clienteNombre.slice(0, 120) },
    external_reference: referenciaCobroCc(datos.cobroId),
    ...(datos.urlNotificacion ? { notification_url: datos.urlNotificacion } : {}),
    back_urls: {
      success: datos.urlRetorno,
      pending: datos.urlRetorno,
      failure: datos.urlRetorno,
    },
    ...(https ? { auto_return: "approved" } : {}),
    expires: true,
    expiration_date_from: fechaParaMp(ahora),
    expiration_date_to: fechaParaMp(datos.venceEn),
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
    },
    metadata: { cobro_cc_id: datos.cobroId, negocio_id: datos.negocioId },
  };
}
