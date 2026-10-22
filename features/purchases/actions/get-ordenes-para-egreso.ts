"use server";

import type { RemitoResumenPago } from "../lib/pago-remito";
import { getResumenPagosRemitosAction } from "./pago-remito";

export type OrdenParaEgreso = RemitoResumenPago;

/**
 * Remitos que se pueden pagar con un gasto COMPRA_MERCADERIA: los que se
 * deben (A_PAGAR), los aprobados sin respuesta a "¿Lo pagaste?" y los que
 * todavía no ingresaron (un adelanto al proveedor). Los anteriores al
 * registro, los pagados y los descartados no tienen nada que pagar.
 *
 * Antes salían los 30 más recientes con el saldo calculado como si todo se
 * debiera (`resumen_remitos_financiero`). El criterio vive ahora en
 * `resumen_pagos_remitos`. Los que se deben van primero.
 */
export async function getOrdenesParaEgresoAction(): Promise<OrdenParaEgreso[]> {
  const remitos = await getResumenPagosRemitosAction();
  const orden: Record<string, number> = { A_PAGAR: 0, SIN_RESPONDER: 1, SIN_INGRESAR: 2 };
  return remitos
    .filter((r) => r.situacion in orden)
    .sort((a, b) => orden[a.situacion] - orden[b.situacion])
    .slice(0, 50);
}
