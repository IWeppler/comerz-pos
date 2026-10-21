/**
 * Cuánto se debe de CADA venta, leído de la cuenta corriente y no del campo
 * `ventas.monto_pendiente`.
 *
 * Ese campo se calcula al vender y NO baja cuando el cliente paga después: en
 * Evens quedan 346 ventas "pendientes" por $12,8 M mientras la deuda real de los
 * clientes es $5,1 M. La cuenta corriente sí se mueve con cada cobro, y el
 * cobro cancela primero las deudas más viejas (FIFO). `cc_deudas_vivas_detalle`
 * devuelve el saldo vivo de cada débito después de esa imputación.
 *
 * `vivo` incluye la mora que se le sumó al ticket. Es lo que el cliente debe
 * por esa venta, así que el pendiente lo incluye.
 */

export interface FilaSaldoVivo {
  venta_id: string | null;
  vivo: number | string | null;
}

/** Suma el saldo vivo de los débitos de cada venta. Los débitos sin venta
 * (mora huérfana, cobros sin ticket) no pertenecen a ninguna venta. */
export function sumarVivoPorVenta(
  filas: readonly FilaSaldoVivo[],
): Map<string, number> {
  const porVenta = new Map<string, number>();
  for (const f of filas) {
    if (!f.venta_id) continue;
    const vivo = Number(f.vivo ?? 0);
    if (!Number.isFinite(vivo) || vivo <= 0) continue;
    porVenta.set(f.venta_id, (porVenta.get(f.venta_id) ?? 0) + vivo);
  }
  return porVenta;
}

/**
 * Qué mostrar como pendiente de una venta.
 *
 * - Si la cuenta corriente respondió (`pendiente_actual`), ese es el número.
 * - Si no respondió (falla de consulta), cae al campo congelado. Es el único
 *   caso donde se usa, y el servidor lo registra.
 */
export function pendienteDeVenta(venta: {
  pendiente_actual?: number | null;
  monto_pendiente?: number | string | null;
}): number {
  if (venta.pendiente_actual !== undefined && venta.pendiente_actual !== null) {
    return venta.pendiente_actual;
  }
  return Math.max(0, Number(venta.monto_pendiente ?? 0) || 0);
}
