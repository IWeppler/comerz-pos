import {
  diaComercial,
  rangoDiaComercial,
} from "@/entities/caja/lib/turno-de-otro-dia";

/**
 * Cuánta historia baja `/ventas`.
 *
 * La pantalla traía TODAS las ventas del comercio con cinco embeds (renglones,
 * IMEI, comprobantes con IVA, pagos, descuentos) en cada visita, adentro del
 * RSC de la navegación. Medido el 4/10/2026: Librería Colores tenía 2.231
 * ventas a tres semanas del alta (~105 por día), unos 4 MB por visita a
 * /ventas, y ese historial completo era la consulta que más egress le costaba
 * a Supabase (73.000 filas de `ventas` en 24 h entre /ventas, /reportes y el
 * panel). El payload crecía con cada venta y sin techo.
 *
 * Lo que se busca en el historial casi siempre es reciente (el ticket que la
 * clienta tiene en la mano, la venta de hoy a corregir), así que el default es
 * 7 días y el resto se pide a propósito. No 30: los dos comercios que más
 * venden tenían menos de 30 días de vida, así que con 30 seguían bajando todo
 * (Librería 2.231 ventas en 30 días contra 726 en 7; Evens 553 contra 106). La búsqueda y los filtros siguen
 * siendo en memoria SOBRE EL RANGO cargado: por eso la tabla ofrece "buscar en
 * todo el historial" cuando no encuentra nada, en vez de decir "no existe".
 *
 * El rango viaja en la URL (`?rango=`): sobrevive al refresh que hacen anular,
 * devolver y facturar, y se puede compartir.
 */
export const RANGOS_HISTORIAL = [
  { value: "7", label: "Últimos 7 días", dias: 7 },
  { value: "30", label: "Últimos 30 días", dias: 30 },
  { value: "90", label: "Últimos 90 días", dias: 90 },
  { value: "365", label: "Último año", dias: 365 },
  { value: "todo", label: "Todo el historial", dias: null },
] as const;

export type RangoHistorial = (typeof RANGOS_HISTORIAL)[number]["value"];

export const RANGO_HISTORIAL_DEFAULT: RangoHistorial = "7";

/** Un valor desconocido (URL tocada a mano, link viejo) cae al default: es el
 * lado barato. "todo" solo se pide explícitamente. */
export function normalizarRangoHistorial(valor: unknown): RangoHistorial {
  return RANGOS_HISTORIAL.some((r) => r.value === valor)
    ? (valor as RangoHistorial)
    : RANGO_HISTORIAL_DEFAULT;
}

export function etiquetaRangoHistorial(rango: RangoHistorial): string {
  return RANGOS_HISTORIAL.find((r) => r.value === rango)!.label;
}

/**
 * Desde qué instante (ISO) pedir ventas, o null para todo el historial.
 *
 * Por DÍA COMERCIAL argentino, no por "ahora menos N × 24 h": "últimos 30
 * días" incluye hoy y arranca a las 00:00 de hace 29 días, igual para quien
 * mira a las 9 que a las 23, y sin depender del huso del server.
 */
export function desdeRangoHistorial(
  rango: RangoHistorial,
  ahora: Date = new Date(),
): string | null {
  const dias = RANGOS_HISTORIAL.find((r) => r.value === rango)!.dias;
  if (dias === null) return null;

  // Mediodía argentino de hoy: restar días desde ahí nunca cruza de día por
  // la hora en que se mire.
  const hoy = diaComercial(ahora);
  const mediodia = new Date(`${hoy}T12:00:00-03:00`);
  const primerDia = diaComercial(
    new Date(mediodia.getTime() - (dias - 1) * 24 * 60 * 60 * 1000),
  );
  return rangoDiaComercial(primerDia)!.desde;
}
