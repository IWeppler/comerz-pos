/**
 * El mes comercial argentino como rango de instantes: [desde, hasta), con
 * `hasta` EXCLUSIVO (las 00:00 argentinas del mes siguiente).
 *
 * Lo usa el tope de ventas por mes de los planes (`max_ventas_mensuales`): una
 * venta de las 22:00 del último día del mes es del mes que termina aunque en
 * UTC ya sea el siguiente. Mismo criterio y mismo offset fijo (−03:00, sin
 * horario de verano desde 2009) que `rangoDiaComercial`.
 */

const ZONA_COMERCIO = "America/Argentina/Buenos_Aires";

const formatoMes = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_COMERCIO,
  year: "numeric",
  month: "2-digit",
});

export function rangoMesComercial(ahora: Date = new Date()): {
  desde: string;
  hasta: string;
} {
  // "2026-10": año y mes de Argentina en este instante.
  const [anio, mes] = formatoMes.format(ahora).split("-").map(Number);
  const siguiente = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
  const aTexto = (a: number, m: number) =>
    `${a}-${String(m).padStart(2, "0")}-01T00:00:00-03:00`;

  return {
    desde: new Date(aTexto(anio, mes)).toISOString(),
    hasta: new Date(aTexto(siguiente.anio, siguiente.mes)).toISOString(),
  };
}
