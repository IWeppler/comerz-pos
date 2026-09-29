import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";

/**
 * Estado de una cotización tal como se MUESTRA.
 *
 * La base guarda VIGENTE | ACEPTADO | RECHAZADO | ANULADO. VENCIDO no se
 * guarda: es una cotización VIGENTE cuyo `vigencia_hasta` ya pasó. Guardarlo
 * pediría un cron que lo marque, y el día que el cron no corre la pantalla
 * miente. Calculado, no puede desincronizarse.
 *
 * `vigencia_hasta` es INCLUSIVO: una cotización "válida hasta el 6/10" se
 * puede aceptar el 6/10 entero, en día comercial argentino.
 */

export type EstadoPresupuesto = "VIGENTE" | "ACEPTADO" | "RECHAZADO" | "ANULADO";
export type EstadoVisiblePresupuesto = EstadoPresupuesto | "VENCIDO";

export function estadoVisiblePresupuesto(
  estado: string,
  vigenciaHasta: string,
  ahora: Date = new Date(),
): EstadoVisiblePresupuesto {
  if (estado === "VIGENTE") {
    return diaComercial(ahora) > vigenciaHasta ? "VENCIDO" : "VIGENTE";
  }
  if (estado === "ACEPTADO" || estado === "RECHAZADO" || estado === "ANULADO") {
    return estado;
  }
  // Un estado que no se conoce se muestra como cerrado, no como vigente: una
  // cotización que no se sabe si vale no se ofrece para aceptar.
  return "ANULADO";
}

export const ETIQUETA_ESTADO: Record<EstadoVisiblePresupuesto, string> = {
  VIGENTE: "Vigente",
  VENCIDO: "Vencida",
  ACEPTADO: "Aceptada",
  RECHAZADO: "Rechazada",
  ANULADO: "Anulada",
};

/** Solo una VIGENTE (no vencida) se puede cerrar desde la pantalla. Una
 * vencida también se puede rechazar o anular: la trigger lo permite y sirve
 * para limpiar el listado. */
export function puedeCerrarse(estado: string): boolean {
  return estado === "VIGENTE";
}

/** "#0007": el número como se imprime. */
export function formatearNumeroPresupuesto(numero: number): string {
  return `#${String(numero).padStart(4, "0")}`;
}
