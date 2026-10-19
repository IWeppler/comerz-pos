import type { TicketData } from "@/entities/ventas/types";

/**
 * El plan de una venta en cuotas para reimprimir su ticket desde el
 * historial. Sale de las cuotas que quedaron en la cuenta corriente (un
 * DEBITO por cuota con su `vence_el`, ver docs/cuenta-corriente.md), no de la
 * configuración de hoy: el papel reimpreso tiene que decir lo que se vendió.
 *
 * Se piden SOLO al abrir el ticket de una venta fiada, no en el listado del
 * historial: es una consulta chica por venta en vez de un embed en cada fila.
 */

export const COLUMNAS_CUOTAS_TICKET =
  "cuota_numero, cuotas_total, monto, monto_recargo, recargo_porcentaje, vence_el";

export type FilaCuotaTicket = {
  cuota_numero: number | null;
  cuotas_total: number | null;
  monto: number | string;
  monto_recargo: number | string | null;
  recargo_porcentaje: number | string | null;
  vence_el: string | null;
};

/** null = la venta no fue en cuotas (fiado común o sin filas). */
export function planCuotasDesdeMovimientos(
  filas: FilaCuotaTicket[] | null | undefined,
): TicketData["planCuotas"] {
  const cuotas = (filas ?? [])
    .filter((f) => f.cuota_numero !== null && f.vence_el !== null)
    .sort((a, b) => Number(a.cuota_numero) - Number(b.cuota_numero));
  if (cuotas.length === 0) return null;

  const interesCentavos = cuotas.reduce(
    (acc, f) => acc + Math.round(Number(f.monto_recargo ?? 0) * 100),
    0,
  );
  return {
    cuotas: Number(cuotas[0].cuotas_total ?? cuotas.length),
    pct: Number(cuotas[0].recargo_porcentaje ?? 0),
    interes: interesCentavos / 100,
    detalle: cuotas.map((f) => ({
      numero: Number(f.cuota_numero),
      monto: Number(f.monto),
      venceEl: String(f.vence_el).slice(0, 10),
    })),
  };
}
