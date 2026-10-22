"use server";

import { iniciarPagoCuentaCc } from "@/features/cobros-online/lib/cobro-cc-mp-servidor";
import type { AlcancePagoCc } from "../lib/pago-online-cc";

const ALCANCES: readonly AlcancePagoCc[] = ["VENCIDO", "CICLO", "TOTAL"];

const MENSAJES = {
  NO_DISPONIBLE: "El pago con Mercado Pago no está disponible ahora. Probá más tarde o pagá por transferencia.",
  SIN_DEUDA: "Tu cuenta cambió: recargá la página para ver el monto actualizado.",
  DEMASIADOS: "Intentaste muchas veces en poco tiempo. Esperá un rato y volvé a probar.",
  ERROR: "No pudimos abrir Mercado Pago. Probá de nuevo en un momento.",
} as const;

/**
 * El botón "Pagar con Mercado Pago" del resumen público. Sin sesión: la
 * clienta solo tiene el token de su resumen. El monto NO viene del navegador:
 * se recalcula en el server (`iniciarPagoCuentaCc`).
 */
export async function pagarCuentaConMpAction(
  token: string,
  alcance: AlcancePagoCc,
): Promise<{ url: string | null; error: string | null }> {
  if (typeof token !== "string" || !ALCANCES.includes(alcance)) {
    return { url: null, error: MENSAJES.ERROR };
  }
  const r = await iniciarPagoCuentaCc(token, alcance);
  return r.ok ? { url: r.initPoint, error: null } : { url: null, error: MENSAJES[r.motivo] };
}
