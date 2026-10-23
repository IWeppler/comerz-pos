/**
 * El recargo que se le pone a UN ticket, en porcentaje.
 *
 * Compartido POS/server (un criterio, un módulo): el POS lo usa para validar lo
 * que se tipea y el server para validar lo que llega, que es un endpoint y no
 * confía en lo que el botón deja hacer.
 *
 * Hoy lo usa el recargo de cuenta corriente ("Modificar" en el ticket): el
 * default del comercio (`cc_recargo_default`) es lo que rige si nadie lo toca,
 * y quien tiene el permiso `ventas.fiar_sin_recargo` puede cambiarlo por ticket.
 * Tocarlo es siempre una decisión comercial puntual (cliente de confianza,
 * arreglo previo), no una configuración: por eso viaja con la venta y se guarda
 * congelado en `ventas.recargo_cc_porcentaje`.
 *
 * `0` es un valor, no "sin dato": quiere decir "se fió sin recargo" y es lo
 * que antes se llamaba "anular".
 */

import { parsearCantidadEs } from "@/shared/lib/parsear-numero-es";

/** Más que esto no es un recargo, es un dedo de más. Se rechaza. */
export const RECARGO_PCT_MAX = 100;

/** Los atajos del ticket. El 0 es "sin recargo" (el "Anular" de antes). */
export const ATAJOS_RECARGO_PCT = [0, 5, 10, 15] as const;

const aDosDecimales = (n: number) => Math.round(n * 100) / 100;

/**
 * Lleva lo que llega (un texto tipeado o un número) a un porcentaje válido, o
 * `null` si no lo es. Válido: número finito entre 0 y 100, a dos decimales.
 *
 * Acepta "4,8" y "4.8": en un mostrador argentino se tipean las dos y un
 * `Number("4,8")` es NaN. No acepta separador de miles: un porcentaje no lo
 * tiene.
 */
export function normalizarPctRecargo(valor: unknown): number | null {
  let n: number | null;
  if (typeof valor === "number") {
    n = valor;
  } else if (typeof valor === "string") {
    n = parsearCantidadEs(valor);
  } else {
    n = null;
  }
  if (n === null || !Number.isFinite(n)) return null;
  if (n < 0 || n > RECARGO_PCT_MAX) return null;
  return aDosDecimales(n);
}

/**
 * ¿El porcentaje elegido se aparta del default del comercio? Ese apartarse es
 * lo que pide permiso, para subir o para bajar. La diferencia mínima es medio
 * centésimo: dos decimales es la precisión con que se guarda.
 */
export function esDesvioDelDefault(
  elegido: number,
  defecto: number,
): boolean {
  return Math.abs(aDosDecimales(elegido) - aDosDecimales(defecto)) > 0.005;
}

/** El porcentaje que rige: el elegido para el ticket, o el default. */
export function pctRecargoEfectivo(
  elegido: number | null | undefined,
  defecto: number,
): number {
  return elegido ?? defecto;
}

/** "4,8%" / "5%" para mostrar. */
export function formatearPct(pct: number): string {
  return `${pct.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
}

/**
 * El recargo libre de una venta de CONTADO: porcentaje sobre lo que queda
 * después del descuento, redondeado al peso.
 *
 * Al peso y no al centavo, como el recargo por método: es plata de mostrador y
 * un total con centavos sueltos no se cobra. Compartido POS/server: el POS lo
 * muestra y el server lo cobra con esta misma cuenta, y es el server el que
 * manda.
 */
export function calcularRecargoLibre(base: number, pct: number): number {
  if (!(base > 0) || !(pct > 0)) return 0;
  return Math.round((base * pct) / 100);
}
