import { formatearMoneda } from "@/shared/utils/formatters";

/**
 * Traduce el rechazo `SALDO_INSUFICIENTE_CAJA` de la base (trigger
 * `validar_saldo_caja_arqueada`, `20260928120000`) a un mensaje para el
 * mostrador. Devuelve null si el error es otro.
 *
 * La base manda en `details` un JSON con `disponible` y `monto`. Si no llega
 * o no se puede leer, el mensaje sale igual, sin números: es mejor decir "no
 * alcanza" que inventar cuánto hay.
 */
export function mensajeSaldoInsuficienteCaja(
  error: { message?: string | null; details?: string | null } | null | undefined,
): string | null {
  if (!error?.message?.includes("SALDO_INSUFICIENTE_CAJA")) return null;

  const cierre =
    " Si se pagó con otra plata (Caja general, transferencia, Mercado Pago), elegí esa cuenta.";

  try {
    const { disponible, monto } = JSON.parse(error.details ?? "") as {
      disponible?: unknown;
      monto?: unknown;
    };
    if (typeof disponible === "number" && typeof monto === "number") {
      return `En la caja hay ${formatearMoneda(disponible)} y no se pueden sacar ${formatearMoneda(monto)}.${cierre}`;
    }
  } catch {
    // details vacío o no JSON: mensaje sin números.
  }

  return `En la caja no hay efectivo suficiente para este movimiento.${cierre}`;
}
