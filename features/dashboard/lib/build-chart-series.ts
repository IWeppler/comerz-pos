import { Venta } from "@/entities/ventas/types";
import {
  resolverRangoActual,
  resolverRangoAnterior,
  type PeriodoPanel,
  type RangoFechas,
} from "@/shared/lib/periodo-ranges";

/**
 * "semana" son bloques de 7 días contados desde el INICIO del rango, no
 * semanas de calendario: los rangos del panel son ventanas móviles que
 * arrancan cualquier día, y así cada barra tiene siete días enteros y cae en
 * los mismos días de la semana que su par del período anterior.
 */
export type Granularidad = "hora" | "dia" | "semana" | "mes";

export type PuntoSerie = {
  /** Etiqueta corta del eje X. */
  etiqueta: string;
  /** Etiqueta larga para el tooltip. */
  etiquetaCompleta: string;
  ingresos: number;
  unidades: number;
  ganancia: number;
  /** Ventas (tickets) del tramo. */
  tickets: number;
};

/** Punto del gráfico del panel: el tramo actual y su par del período anterior. */
export type PuntoComparado = PuntoSerie & {
  /** Facturación del mismo tramo en el período anterior. null = no hay
   * período anterior con ventas para comparar (comercio nuevo). */
  ingresosAnterior: number | null;
  /** El último tramo, que todavía no terminó. */
  enCurso: boolean;
};

/**
 * Cómo se parte cada período del selector. La idea es que siempre haya entre
 * 7 y 52 barras: menos no muestra forma, más no se lee en un celular.
 *   Hoy ........ por hora
 *   Semana ..... por día (7)
 *   Mes ........ por día (28)
 *   Trimestre .. por semana (13)
 *   Año ........ por mes (12): ver `resolverRangosChart`.
 */
export const GRANULARIDAD_POR_PERIODO: Record<PeriodoPanel, Granularidad> = {
  hoy: "hora",
  semana: "dia",
  mes: "dia",
  trimestre: "semana",
  anio: "mes",
};

/** Meses que grafica "Año": el actual (en curso) y los 11 anteriores, enteros. */
export const MESES_CHART_ANIO = 12;

/**
 * Los dos rangos del gráfico. Son los de las tarjetas
 * (`resolverRangoActual` / `resolverRangoAnterior`), salvo "Año": las
 * tarjetas miran 364 días móviles, que empiezan a mitad de un mes, y partido
 * en meses eso dejaba un primer mes cortado que se leía como un mes malo. El
 * gráfico de "Año" son 12 meses de calendario enteros (del día 1 de hace 11
 * meses a hoy) contra los mismos 12 meses del año anterior. Por eso con "Año"
 * la suma de las barras puede diferir unos días de "Vendiste".
 *
 * `ventana-historial-panel.ts` cubre el anterior de este rango: si se cambia
 * acá, el test de allá lo verifica.
 */
export function resolverRangosChart(
  periodo: PeriodoPanel,
  ahora: Date,
): { actual: RangoFechas; anterior: RangoFechas } {
  if (periodo !== "anio") {
    return { actual: resolverRangoActual(periodo, ahora), anterior: resolverRangoAnterior(periodo, ahora) };
  }
  const [y, m] = [ahora.getFullYear(), ahora.getMonth()];
  const fin = new Date(y, m, ahora.getDate(), 23, 59, 59, 999);
  return {
    actual: { inicio: new Date(y, m - (MESES_CHART_ANIO - 1), 1), fin },
    anterior: {
      inicio: new Date(y - 1, m - (MESES_CHART_ANIO - 1), 1),
      // Hasta el último día del mismo mes del año pasado (el mes entero).
      fin: new Date(y - 1, m + 1, 0, 23, 59, 59, 999),
    },
  };
}

function inicioDelDia(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

function primerBucket(inicio: Date, gran: Granularidad): Date {
  if (gran === "hora") {
    return new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), inicio.getHours());
  }
  if (gran === "mes") return new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  return inicioDelDia(inicio);
}

// Construido por componentes (no sumando milisegundos) para no romperse con DST.
function siguienteBucket(fecha: Date, gran: Granularidad): Date {
  const [y, m, d, h] = [fecha.getFullYear(), fecha.getMonth(), fecha.getDate(), fecha.getHours()];
  if (gran === "hora") return new Date(y, m, d, h + 1);
  if (gran === "semana") return new Date(y, m, d + 7);
  if (gran === "mes") return new Date(y, m + 1, 1);
  return new Date(y, m, d + 1);
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const dosDigitos = (n: number) => n.toString().padStart(2, "0");
const diaMes = (f: Date) => `${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}`;

function etiquetaCorta(fecha: Date, gran: Granularidad): string {
  if (gran === "hora") return `${dosDigitos(fecha.getHours())}h`;
  if (gran === "mes") return MESES_CORTOS[fecha.getMonth()];
  return diaMes(fecha);
}

function etiquetaLarga(fecha: Date, gran: Granularidad): string {
  if (gran === "hora") return `${diaMes(fecha)} ${dosDigitos(fecha.getHours())}:00`;
  if (gran === "mes") return `${MESES_CORTOS[fecha.getMonth()]} ${fecha.getFullYear()}`;
  if (gran === "semana") {
    const ultimo = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 6);
    return `Semana del ${diaMes(fecha)} al ${diaMes(ultimo)}`;
  }
  return `${diaMes(fecha)}/${fecha.getFullYear()}`;
}

/** Comienzos de los tramos que cubren el rango; el último es el que contiene a `fin`. */
function generarBuckets(rango: RangoFechas, gran: Granularidad): Date[] {
  const buckets: Date[] = [];
  const finMs = rango.fin.getTime();
  for (let cursor = primerBucket(rango.inicio, gran); cursor.getTime() <= finMs; cursor = siguienteBucket(cursor, gran)) {
    buckets.push(cursor);
  }
  return buckets;
}

/** El último tramo que empieza en o antes de `ms` (búsqueda binaria). */
function indiceDeBucket(inicios: number[], ms: number): number {
  let lo = 0;
  let hi = inicios.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (inicios[mid] <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Serie de un rango: un punto por tramo. Las ventas fuera del rango se
 * descartan aunque caigan en un tramo que el rango toca parcialmente.
 *
 * El eje X va recortado en `ahora`: graficar las horas o días que todavía no
 * pasaron dibujaría una caída a cero que se lee como si hubiera dejado de
 * vender.
 */
export function construirSerie(
  ventasOperativas: Venta[],
  rango: RangoFechas,
  gran: Granularidad,
  ahora: Date,
): PuntoSerie[] {
  const fin = new Date(Math.min(rango.fin.getTime(), ahora.getTime()));
  const buckets = generarBuckets({ inicio: rango.inicio, fin }, gran);
  const inicios = buckets.map((b) => b.getTime());
  const puntos: PuntoSerie[] = buckets.map((b) => ({
    etiqueta: etiquetaCorta(b, gran),
    etiquetaCompleta: etiquetaLarga(b, gran),
    ingresos: 0,
    unidades: 0,
    ganancia: 0,
    tickets: 0,
  }));
  if (puntos.length === 0) return puntos;

  const inicioMs = rango.inicio.getTime();
  const finMs = fin.getTime();
  for (const v of ventasOperativas) {
    const ms = new Date(v.fecha_venta).getTime();
    if (ms < inicioMs || ms > finMs) continue;
    const p = puntos[indiceDeBucket(inicios, ms)];
    const total = Number(v.total || 0);
    p.ingresos += total;
    p.ganancia += total - Number(v.precio_costo || 0);
    p.unidades += Number(v.cantidad || 0);
    p.tickets += 1;
  }
  return puntos;
}

/**
 * La serie del gráfico del panel: el período del selector partido en tramos
 * (ver GRANULARIDAD_POR_PERIODO) y, por cada tramo, la facturación del mismo
 * tramo en el período anterior. Los rangos salen de `resolverRangosChart`
 * (los de las tarjetas, salvo "Año").
 *
 * Se aparean por posición: el anterior está corrido un múltiplo de 7 días (o
 * un año, con "Año"), así que cada par cae en el mismo día de la semana o en
 * el mismo mes.
 */
export function construirSerieComparada(
  ventasOperativas: Venta[],
  periodo: PeriodoPanel,
  ahora: Date,
): PuntoComparado[] {
  const gran = GRANULARIDAD_POR_PERIODO[periodo];
  const rangos = resolverRangosChart(periodo, ahora);
  const actual = construirSerie(ventasOperativas, rangos.actual, gran, ahora);
  // El anterior ya terminó: se arma entero (sin recorte en "ahora").
  const rangoAnterior = rangos.anterior;
  const anterior = construirSerie(ventasOperativas, rangoAnterior, gran, rangoAnterior.fin);
  const hayAnterior = anterior.some((p) => p.tickets > 0);

  return actual.map((p, i) => ({
    ...p,
    ingresosAnterior: hayAnterior ? (anterior[i]?.ingresos ?? null) : null,
    enCurso: i === actual.length - 1,
  }));
}
