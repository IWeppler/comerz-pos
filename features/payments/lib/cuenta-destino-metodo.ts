import type { TipoMetodo } from "@/entities/payments/types";

/**
 * Dónde cae la plata de cada método de pago.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UNA REGLA Y NO UN CAMPO MÁS DEL FORMULARIO
 *
 * `cuenta_actual_venta_pago` manda un cobro directo a su cuenta solo si
 * `acreditacion_dias = 0` Y el método tiene `cuenta_destino_id`. Sin cuenta, el
 * cobro cae en el puente POR_ACREDITAR y se queda ahí: es lo que hizo que la
 * pestaña Dinero de Evens dijera $19.985.473 por acreditar contra $687.182
 * reales, y el 87% de esa diferencia era Mercado Pago con acreditación en el
 * día — plata que ya estaba en la cuenta.
 *
 * Por eso el alta la exige. La base además la completa por trigger
 * (`20260920200000`), porque hay caminos que no pasan por este formulario: la
 * siembra de un negocio nuevo, sin ir más lejos, crea 'Transferencia' y
 * 'Mercado Pago' sin pasar por acá.
 *
 * Vive en lib y no en la action porque la usan los DOS modales (cliente) y las
 * DOS actions (server): una sola definición, mismo criterio que
 * `tipo-egreso.ts` y `recargo-metodo.ts`.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** El efectivo no se elige: va SIEMPRE a la caja diaria, y eso lo resuelve el
 * trigger. Ofrecer un selector ahí sería ofrecer una decisión que no existe. */
export function requiereCuentaDestino(tipo: TipoMetodo): boolean {
  return tipo !== "EFECTIVO";
}

/** El tipo de cuenta que le corresponde a un método, como punto de partida.
 * Es el MISMO mapeo que usa la migración `20260920180000` y el trigger de
 * `20260920200000`: si no dijeran lo mismo, una cuenta creada desde acá y otra
 * creada por la base saldrían distintas para el mismo método. */
export function tipoCuentaSugerido(tipo: TipoMetodo): "BILLETERA" | "BANCO" {
  return tipo === "BILLETERA_VIRTUAL" ? "BILLETERA" : "BANCO";
}

/** El puente NUNCA es elegible: es la cuenta transitoria del sistema, no un
 * lugar donde el comercio tenga plata. */
export function cuentasElegibles<T extends { codigo: string }>(
  cuentas: readonly T[],
): T[] {
  return cuentas.filter((cuenta) => cuenta.codigo !== "POR_ACREDITAR");
}

/**
 * El chequeo que corren el formulario y la action. Devuelve el mensaje de
 * error o null.
 *
 * Fail-closed sobre el TIPO: si llega uno que este código no conoce, se pide
 * la cuenta igual. Lo único que no la necesita es el efectivo, y eso se
 * afirma, no se asume.
 */
export function validarCuentaDestino(
  tipo: string,
  cuentaDestinoId: string | null | undefined,
): string | null {
  if (tipo === "EFECTIVO") return null;
  if (!cuentaDestinoId) {
    return "Elegí en qué cuenta cae la plata de este método.";
  }
  return null;
}
