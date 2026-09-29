/**
 * Un turno que quedó abierto de noche NO se usa al día siguiente.
 *
 * Pasó dos veces en El Nono Cacho (auditoría del 28/9/2026): el turno del
 * jueves 24 se cerró el viernes 25 a las 08:14, y el del viernes a la tarde se
 * cerró el sábado a las 08:38 con 12 ventas y dos cambios del sábado adentro.
 * El conteo de la mañana terminó mezclando dos días y armar el arqueo de cada
 * uno llevó una migración a mano (20260928130000).
 *
 * La regla tiene dos mitades:
 *   1. Mientras el turno abierto sea de un día anterior, no se vende ni se
 *      mueve plata del cajón: primero hay que cerrarlo contando.
 *   2. Ese cierre se fecha en el día del turno, a la hora de su último
 *      movimiento, y no en el momento en que alguien se acordó de contarlo.
 *      Como en la noche no se pudo vender (mitad 1), lo que se cuenta a la
 *      mañana es lo que había al final del día del turno.
 *
 * "Día" es el día comercial en Argentina, no el de UTC: a las 21:00 del
 * jueves en Buenos Aires ya es viernes en UTC, y con UTC el turno de la tarde
 * quedaría bloqueado a la hora de cerrar.
 */

const ZONA_COMERCIO = "America/Argentina/Buenos_Aires";

const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_COMERCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2026-09-24": el día comercial de una fecha, en hora de Argentina. */
export function diaComercial(fecha: Date | string): string {
  return formatoDia.format(typeof fecha === "string" ? new Date(fecha) : fecha);
}

/**
 * El día comercial "2026-09-24" como rango de instantes: [desde, hasta), con
 * `hasta` EXCLUSIVO (las 00:00 argentinas del día siguiente), que es como lo
 * toman `p_desde` / `p_hasta` en `movimientos_financieros_negocio`.
 *
 * El offset va fijo en −03:00 porque Argentina no tiene horario de verano
 * desde 2009. Armarlo con la zona del NAVEGADOR dejaría afuera la última
 * hora de la noche a quien mira desde otro huso.
 *
 * Devuelve null si el texto no es un día real (formato roto o 30/02): viaja
 * desde el navegador y no se le manda a la base algo que no es una fecha.
 */
export function rangoDiaComercial(
  dia: string,
): { desde: string; hasta: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const inicio = new Date(`${dia}T00:00:00-03:00`);
  if (Number.isNaN(inicio.getTime()) || diaComercial(inicio) !== dia) return null;
  const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  return { desde: inicio.toISOString(), hasta: fin.toISOString() };
}

/** true si el turno se abrió un día comercial anterior al de `ahora`. */
export function esTurnoDeOtroDia(
  fechaApertura: Date | string | null | undefined,
  ahora: Date = new Date(),
): boolean {
  if (!fechaApertura) return false;
  return diaComercial(fechaApertura) < diaComercial(ahora);
}

/**
 * Cuándo se registra el cierre de un turno olvidado: un minuto después de su
 * último movimiento (o de la apertura si no tuvo ninguno). Nunca después de
 * `ahora`: si por algún motivo el último movimiento es de hoy, el turno no
 * estaba olvidado y se cierra ahora.
 */
export function fechaCierreTurnoOlvidado(
  fechaApertura: Date | string,
  ultimoMovimiento: Date | string | null | undefined,
  ahora: Date = new Date(),
): Date {
  const apertura = new Date(fechaApertura).getTime();
  const ultimo = ultimoMovimiento ? new Date(ultimoMovimiento).getTime() : apertura;
  const cierre = Math.max(apertura, ultimo) + 60_000;
  return new Date(Math.min(cierre, ahora.getTime()));
}

/** "jueves 24/9 a las 09:04", para los avisos. */
export function describirAperturaTurno(fechaApertura: Date | string): string {
  const fecha = typeof fechaApertura === "string" ? new Date(fechaApertura) : fechaApertura;
  // Por partes y no con `format`: el separador de "24/9" cambia según la
  // versión de ICU (Node lo da como "24-9").
  const partes = new Intl.DateTimeFormat("es-AR", {
    timeZone: ZONA_COMERCIO,
    weekday: "long",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value ?? "";
  return `${parte("weekday")} ${parte("day")}/${parte("month")} a las ${parte("hour")}:${parte("minute")}`;
}

export const MENSAJE_TURNO_DE_OTRO_DIA =
  "La caja quedó abierta desde otro día. Cerrala contando el efectivo antes de seguir: el cierre se registra en el día de ese turno y las ventas de hoy van a un turno nuevo.";
