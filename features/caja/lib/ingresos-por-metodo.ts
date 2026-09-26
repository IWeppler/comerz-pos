/** El mismo desglose de cobros para la auditoría en pantalla y el cierre Z. */
export function ingresosPorMetodo(
  movimientos: readonly { tipo: "INGRESO" | "EGRESO"; metodo: string; monto: number }[],
): { metodo: string; cantidad: number; monto: number }[] {
  const totales = new Map<string, { cantidad: number; monto: number }>();

  for (const movimiento of movimientos) {
    if (movimiento.tipo !== "INGRESO") continue;
    const actual = totales.get(movimiento.metodo) ?? { cantidad: 0, monto: 0 };
    totales.set(movimiento.metodo, {
      cantidad: actual.cantidad + 1,
      monto: actual.monto + movimiento.monto,
    });
  }

  return Array.from(totales, ([metodo, total]) => ({ metodo, ...total }));
}
