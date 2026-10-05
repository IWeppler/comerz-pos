import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";

/**
 * Días transcurridos desde fecha_vencimiento_deuda hasta hoy (positivo =
 * vencida). fecha_vencimiento_deuda es una fecha calendario pura (columna
 * `date`, sin hora), no un instante; "hoy" es el DÍA COMERCIAL ARGENTINO, el
 * mismo que usa `deuda_cc_vencida` en la base.
 *
 * Hasta el 5/10/2026 "hoy" salía del calendario local (`getFullYear/getMonth/
 * getDate`). En el server (Vercel, UTC) desde las 21:00 argentinas ya era
 * mañana: una deuda que vencía hoy cobraba mora esa misma noche, y la pantalla
 * (huso del navegador) decía otra cosa que el cobro.
 */
export function calcularDiasVencido(
  fechaVencimientoDeuda: string | null | undefined,
  ahora: Date = new Date(),
): number | null {
  if (!fechaVencimientoDeuda) return null;

  const [anio, mes, dia] = fechaVencimientoDeuda.split("-").map(Number);
  const vencUTC = Date.UTC(anio, mes - 1, dia);
  const [hAnio, hMes, hDia] = diaComercial(ahora).split("-").map(Number);
  const hoyUTC = Date.UTC(hAnio, hMes - 1, hDia);

  return Math.floor((hoyUTC - vencUTC) / 86400000);
}
