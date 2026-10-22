import { DIAS_POR_VENCER } from "./avisos-cc";

export type EstadoCliente = "al_dia" | "por_vencer" | "con_deuda" | "vencido";

/**
 * Única fuente de verdad para el estado de deuda de un cliente (tabla,
 * filtro y detalle deben coincidir siempre). Una deuda solo se considera
 * vencida si tiene fecha_vencimiento_deuda Y esa fecha ya pasó — sin
 * fecha, o con fecha futura, es "con deuda" a secas.
 *
 * "Por vencer" (22/10/2026): la deuda más vieja vence hoy o en los próximos
 * `DIAS_POR_VENCER` días. `fecha_vencimiento_deuda` es el vencimiento de la
 * deuda viva más vieja (verificado contra `cc_deudas_vivas` el 22/10: 152 de
 * 152 iguales), así que coincide con la lista de cobro de `avisosModoDias`.
 */
export function clasificarEstadoCliente(
  saldoPendiente: number,
  diasVencido: number | null,
): EstadoCliente {
  if (saldoPendiente <= 0) return "al_dia";
  if (diasVencido !== null && diasVencido > 0) return "vencido";
  if (diasVencido !== null && diasVencido >= -DIAS_POR_VENCER) return "por_vencer";
  return "con_deuda";
}
