export type RangoFechas = { inicio: Date; fin: Date };

/**
 * Períodos de CALENDARIO. Los usa /caja, y son los únicos valores que entiende
 * la RPC `posicion_dinero` (que resuelve el rango en la base, no en el
 * cliente, para no partir el mes por el huso del navegador). Esa función
 * fail-closea a "hoy" ante un valor desconocido, así que mandarle un período
 * del panel mostraría el día sin avisar en la vista de plata: por eso los dos
 * vocabularios están separados por tipo y no se pueden cruzar por accidente.
 *
 * Para /caja el calendario es lo correcto: "cuánto se acreditó" es una
 * pregunta de conciliación, y la conciliación va por mes.
 */
export type PeriodoCalendario = "hoy" | "semana" | "mes" | "anio";

export const ETIQUETA_PERIODO_CALENDARIO: Record<PeriodoCalendario, string> = {
  hoy: "hoy",
  semana: "esta semana",
  mes: "este mes",
  anio: "este año",
};

/**
 * Períodos del PANEL. Son ventanas MÓVILES que terminan hoy, no períodos de
 * calendario a la fecha, y eso es lo que hace que las comparaciones cierren.
 *
 * El problema que resuelven, medido en Evens: con "esta semana" un martes, el
 * tramo actual tenía 2 días abiertos y el anterior 1 (el lunes 17 fue feriado),
 * y con "este mes" eran 21 contra 10 (el POS se empezó a usar a mitad de
 * julio). Comparar tramos de distinto tamaño obliga a elegir entre esconder el
 * badge o normalizar por día, que son dos parches sobre la misma causa: la
 * ventana nunca fue comparable. Con ventana móvil de 7 días el mismo martes da
 * 6 días abiertos contra 6 — coinciden solas, sin normalizar nada.
 *
 * Todos MÚLTIPLOS DE 7 (salvo "hoy"): así las dos ventanas tienen la misma
 * cantidad de cada día de la semana, que en estos negocios es lo que más pesa
 * — el sábado hace 17,67 ventas por día y el lunes 3,75. Por eso el trimestre
 * son 91 días (13 semanas) y el año 364 (52 semanas) y no 90 y 365: la
 * diferencia es invisible en la etiqueta y decisiva en la comparación.
 */
export type PeriodoPanel = "hoy" | "semana" | "mes" | "trimestre" | "anio";

export const DIAS_POR_PERIODO: Record<PeriodoPanel, number> = {
  hoy: 1,
  semana: 7,
  mes: 28,
  trimestre: 91,
  anio: 364,
};

function finDelDia(fecha: Date): Date {
  return new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate(),
    23,
    59,
    59,
    999,
  );
}

function inicioDelDia(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

/** Ventana móvil de `dias` que TERMINA hoy. Arranca a las 00:00 y termina a
 * las 23:59:59 para no cortar ventas por la hora. */
export function resolverRangoRolling(dias: number, ahora: Date): RangoFechas {
  return {
    inicio: inicioDelDia(
      new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate() - (dias - 1),
      ),
    ),
    fin: finDelDia(ahora),
  };
}

/** La misma ventana, corrida `dias` hacia atrás. */
function desplazarRango(rango: RangoFechas, dias: number): RangoFechas {
  const correr = (f: Date) =>
    new Date(
      f.getFullYear(),
      f.getMonth(),
      f.getDate() - dias,
      f.getHours(),
      f.getMinutes(),
      f.getSeconds(),
      f.getMilliseconds(),
    );
  return { inicio: correr(rango.inicio), fin: correr(rango.fin) };
}

/**
 * Cuántos días hacia atrás se corre la ventana para obtener la de
 * comparación. SIEMPRE un múltiplo de 7, para que caiga en los mismos días de
 * la semana.
 *
 * Para todos los períodos es su propio largo (ya son múltiplos de 7). La
 * excepción es "hoy": correrlo 1 día lo compararía contra AYER, que es otro
 * día de la semana — hoy martes contra el lunes daba +66% cuando contra el
 * martes anterior es −42%, o sea el signo dado vuelta por puro calendario.
 * Se corre 7 días: mismo día de la semana, un día contra un día.
 */
function desplazamientoDeComparacion(dias: number): number {
  return dias % 7 === 0 ? dias : 7;
}

/** Ventana móvil del período elegido, terminada hoy. */
export function resolverRangoActual(
  periodo: PeriodoPanel,
  ahora: Date,
): RangoFechas {
  return resolverRangoRolling(DIAS_POR_PERIODO[periodo], ahora);
}

/** La ventana inmediatamente anterior, del mismo largo y alineada por día de
 * la semana. Ver `desplazamientoDeComparacion`. */
export function resolverRangoAnterior(
  periodo: PeriodoPanel,
  ahora: Date,
): RangoFechas {
  const dias = DIAS_POR_PERIODO[periodo];
  return desplazarRango(
    resolverRangoActual(periodo, ahora),
    desplazamientoDeComparacion(dias),
  );
}

/** Ventana de los rankings de rotación/rentabilidad: nunca de un solo día
 * (mala muestra para "qué rota más"), así que "hoy" usa la semana. */
export function resolverRangoRanking(
  periodo: PeriodoPanel,
  ahora: Date,
): RangoFechas {
  return resolverRangoActual(periodo === "hoy" ? "semana" : periodo, ahora);
}

/** Cómo se nombra el período en una frase ("ingresos de {los últimos 7 días}"). */
export const ETIQUETA_PERIODO: Record<PeriodoPanel, string> = {
  hoy: "hoy",
  semana: "últimos 7 días",
  mes: "últimos 28 días",
  trimestre: "últimos 3 meses",
  anio: "último año",
};

/** Cómo se nombra el período de comparación en la UI (badges de las KPIs). */
export const ETIQUETA_PERIODO_ANTERIOR: Record<PeriodoPanel, string> = {
  // El panel pisa esta con el día de la semana que sea hoy ("vs. martes
  // promedio"): la referencia de "hoy" no es un día suelto sino el promedio de
  // los mismos días de la semana. Ver `compararConDiaTipico`.
  hoy: "día promedio",
  semana: "7 días previos",
  mes: "28 días previos",
  trimestre: "3 meses previos",
  anio: "año previo",
};

export function formatearFechaISO(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = (fecha.getMonth() + 1).toString().padStart(2, "0");
  const d = fecha.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** % de variación contra el período anterior. Si el período anterior fue 0
 * (sin datos), no hay variación calculable — devuelve null para que la UI
 * no muestre nada, en vez de un "+0%" verde que se lee como "igual que
 * antes" o un +100% inventado. */
export function calcularCrecimiento(
  actual: number,
  anterior: number,
): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

/**
 * Qué tan parecida tiene que ser la actividad registrada de los dos tramos
 * para que comparar sus totales signifique algo. 0,8 = el tramo más flaco
 * tiene al menos el 80% de los días abiertos del otro, así que la diferencia
 * de días distorsiona el total menos de un 25% — bastante menos que los
 * cambios que el badge existe para mostrar.
 */
const RATIO_DIAS_COMPARABLES = 0.8;

/**
 * Variación de un TOTAL (ingresos, unidades, ganancia) entre dos ventanas.
 *
 * Con ventanas móviles del mismo largo los días abiertos coinciden casi
 * siempre, así que esto compara totales y listo. El guard es para el caso que
 * NO se arregla con aritmética: que el tramo anterior tenga mucha menos
 * actividad registrada que el actual. Hoy pasa con la ventana de 28 días
 * (24 días abiertos contra 12), porque la ventana previa cae en julio, cuando
 * el POS estaba a medio adoptar. Ahí el porcentaje mediría la adopción del
 * sistema y no las ventas, y ni normalizar por día lo salva: esos 12 días
 * tampoco son "los días que abrió en julio". Es el único caso que queda en
 * "s/d", y se resuelve solo cuando haya historia pareja.
 */
export function crecimientoDeTotal(
  actual: number,
  anterior: number,
  diasAbiertosActual: number,
  diasAbiertosAnterior: number,
): number | null {
  if (diasAbiertosActual <= 0 || diasAbiertosAnterior <= 0) return null;

  const ratio =
    Math.min(diasAbiertosActual, diasAbiertosAnterior) /
    Math.max(diasAbiertosActual, diasAbiertosAnterior);
  if (ratio < RATIO_DIAS_COMPARABLES) return null;

  return calcularCrecimiento(actual, anterior);
}

export type MuestraMedia = {
  /** La media observada (el ticket promedio del período). */
  media: number;
  /** Desvío muestral de los valores que forman esa media. */
  desvio: number;
  /** Cuántos valores la forman (cantidad de tickets). */
  n: number;
};

/**
 * Variación de una MEDIA entre dos períodos, pero solo si la diferencia se
 * distingue del ruido de muestreo. Si no, devuelve null y la UI lo muestra
 * como "sin cambio medible" — que es información, no ausencia de dato.
 *
 * Por qué existe, con el caso real que lo motivó: el panel mostraba −75% de
 * ticket promedio un martes. La ventana estaba bien y la cuenta también, pero
 * el tramo de comparación tenía 6 tickets con uno de $204.700 adentro, así que
 * la media era $75.917 contra $18.322. La media de 6 tickets no es un dato del
 * negocio, es un sorteo.
 *
 * El ticket de estos comercios es MUY disperso —CV 1,07 medido sobre 408
 * tickets de 30 días de Evens— y con esa dispersión hacen falta ~72 tickets
 * para que la media quede dentro de ±25%, y ~198 para ±15%. O sea que un día
 * (≈13 tickets) NUNCA tiene con qué sostener una comparación de ticket
 * promedio, y la solución no es un umbral fijo de tickets sino medir el ruido
 * de cada período con su propio desvío: un comercio de electro con tickets
 * parejos alcanza significancia con muchos menos.
 *
 * El test es el clásico de dos medias con error estándar combinado (Welch, a
 * 95%): la diferencia se muestra si supera 1,96 errores estándar. Fail-closed:
 * sin muestra suficiente (n < 2) para estimar el desvío, no se compara.
 *
 * OJO: esto es SOLO para medias. Los totales van por `crecimientoDeTotal`:
 * sumar una ventana contra la anterior del mismo largo es un hecho, no una
 * estimación.
 */
export function crecimientoDeMedia(
  actual: MuestraMedia,
  anterior: MuestraMedia,
): number | null {
  if (anterior.media <= 0) return null;
  if (actual.n < 2 || anterior.n < 2) return null;

  const errorActual = actual.desvio / Math.sqrt(actual.n);
  const errorAnterior = anterior.desvio / Math.sqrt(anterior.n);
  const errorCombinado = Math.sqrt(
    errorActual * errorActual + errorAnterior * errorAnterior,
  );

  const diferencia = Math.abs(actual.media - anterior.media);
  if (diferencia <= 1.96 * errorCombinado) return null;

  return calcularCrecimiento(actual.media, anterior.media);
}
