/**
 * El saldo a favor como forma de pago en el POS (20260928240000).
 *
 * Lo comparten el carrito y `create-sale.ts`, mismo criterio que
 * `recargo-metodo.ts`: si la pantalla y el server hicieran esta cuenta cada
 * uno a su manera, la vendedora vería un total y la base cobraría otro.
 *
 * Tres reglas, las tres decididas con el dueño el 28/9/2026:
 * - El saldo a favor NO es un cobro: la plata entró antes (la seña, el pago
 *   de más, la devolución a cuenta). Por eso no es una fila de `venta_pagos`
 *   y viaja aparte, en `saldo_a_favor_aplicado`.
 * - SIN recargo de cuenta corriente sobre esa parte: es plata que la clienta
 *   adelantó, cobrarle por esperar sería al revés.
 * - Nunca más que el ticket ni más que lo que tiene. El tope real lo pone
 *   `registrar_venta` con el cliente bloqueado; esto es el espejo.
 */

function redondearCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** Cuánto saldo a favor se usa: todo lo que tiene, hasta cubrir la compra
 * (antes del recargo de cuenta corriente, que no se le cobra a esa parte). */
export function saldoAFavorAplicable(
  disponible: number,
  subtotalConDescuento: number,
): number {
  const tope = Math.max(0, Number(subtotalConDescuento) || 0);
  const tiene = Math.max(0, Number(disponible) || 0);
  return redondearCentavos(Math.min(tiene, tope));
}

/** La base del recargo de cuenta corriente: el subtotal MENOS lo que se paga
 * con saldo a favor. */
export function baseRecargoCuentaCorriente(
  subtotalConDescuento: number,
  saldoAFavorAplicado: number,
): number {
  return Math.max(
    0,
    (Number(subtotalConDescuento) || 0) - (Number(saldoAFavorAplicado) || 0),
  );
}

/**
 * Traduce el rechazo `SALDO_A_FAVOR_INSUFICIENTE` de `registrar_venta` a un
 * mensaje para el mostrador. Devuelve null si el error es otro. La base manda
 * `disponible` y `monto` en `details`; sin ellos, el mensaje sale sin números.
 */
export function mensajeSaldoAFavorInsuficiente(
  error: { message?: string | null; details?: string | null } | null | undefined,
): string | null {
  if (!error?.message?.includes("SALDO_A_FAVOR_INSUFICIENTE")) return null;

  const cierre = " Actualizá el cliente en el ticket y volvé a cobrar.";
  try {
    const { disponible } = JSON.parse(error.details ?? "") as {
      disponible?: unknown;
    };
    if (typeof disponible === "number") {
      return `El cliente tiene $${disponible.toLocaleString("es-AR", { maximumFractionDigits: 2 })} a favor, menos de lo que se quiso usar.${cierre}`;
    }
  } catch {
    // details vacío o no JSON.
  }
  return `El cliente no tiene saldo a favor suficiente.${cierre}`;
}
