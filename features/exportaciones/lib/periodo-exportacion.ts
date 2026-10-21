import { type RangoFechas } from "@/shared/lib/periodo-ranges";

/**
 * Períodos de una exportación contable.
 *
 * NO son los del panel ni los de Reportes, y es a propósito: un contador
 * trabaja por cierre mensual. "Últimos 7 días" o "histórico" no son cortes que
 * le sirvan a nadie para presentar, y ofrecérselos invita a exportar un
 * recorte que no corresponde a ningún período fiscal.
 *
 * Valores: "mes_anterior", "mes" (mes actual), "mes:AAAA-MM" (un mes cerrado de
 * los últimos 12), "anio" (año en curso) y "anio_anterior" (cierre anual).
 */

export type PeriodoExportacion =
  | "mes_anterior"
  | "mes"
  | "anio"
  | "anio_anterior"
  | `mes:${string}`;

export const PERIODO_EXPORTACION_DEFAULT: PeriodoExportacion = "mes_anterior";

/** Cuántos meses hacia atrás se pueden pedir. Más atrás, el contador ya tiene
 * ese cierre archivado; y un límite fijo evita que un valor inventado llegue
 * a la consulta. */
const MESES_ATRAS_MAX = 12;

const PATRON_MES = /^mes:(\d{4})-(\d{2})$/;

function claveMes(fecha: Date): string {
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  return `mes:${fecha.getFullYear()}-${mm}`;
}

function etiquetaMes(fecha: Date): string {
  const texto = fecha.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Las opciones del selector, en orden: lo más usado primero. Los meses
 * cerrados salen del mes actual hacia atrás. */
export function opcionesPeriodoExportacion(
  ahora: Date = new Date(),
): { valor: PeriodoExportacion; etiqueta: string }[] {
  const opciones: { valor: PeriodoExportacion; etiqueta: string }[] = [];
  const mesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  opciones.push({ valor: "mes_anterior", etiqueta: `Mes anterior · ${etiquetaMes(mesAnterior)}` });
  opciones.push({ valor: "mes", etiqueta: `Mes actual · ${etiquetaMes(ahora)}` });

  // Desde el segundo mes atrás: el anterior ya está arriba.
  for (let k = 2; k <= MESES_ATRAS_MAX; k++) {
    const fecha = new Date(ahora.getFullYear(), ahora.getMonth() - k, 1);
    opciones.push({ valor: claveMes(fecha) as PeriodoExportacion, etiqueta: etiquetaMes(fecha) });
  }

  opciones.push({ valor: "anio", etiqueta: `Año en curso · ${ahora.getFullYear()}` });
  opciones.push({ valor: "anio_anterior", etiqueta: `Año anterior · ${ahora.getFullYear() - 1}` });
  return opciones;
}

/** Fail-closed: lo que no está en la lista de opciones cae al mes anterior,
 * que es el período cerrado y el único que no se sigue moviendo. */
export function normalizarPeriodoExportacion(
  valor: unknown,
  ahora: Date = new Date(),
): PeriodoExportacion {
  if (typeof valor !== "string") return PERIODO_EXPORTACION_DEFAULT;
  const valido = opcionesPeriodoExportacion(ahora).some((o) => o.valor === valor);
  return valido ? (valor as PeriodoExportacion) : PERIODO_EXPORTACION_DEFAULT;
}

/**
 * El mes calendario anterior COMPLETO: del 1 al último día.
 *
 * NO se usa `resolverRangoAnterior("mes")` de shared, y la diferencia importa:
 * esa función recorta al mismo día del mes a propósito, porque el panel
 * compara "mes a la fecha contra los mismos días del mes pasado". Correcto
 * para comparar; para exportar significaría que un contador que pide julio un
 * 8 de agosto se lleva del 1 al 8 de julio y presenta un mes incompleto.
 *
 * El día 0 del mes siguiente es el último del anterior, y así el 28/29/30/31
 * sale solo sin tener que saber de febrero ni de años bisiestos.
 */
function mesAnteriorCompleto(ahora: Date): RangoFechas {
  return {
    inicio: new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1, 0, 0, 0, 0),
    fin: new Date(ahora.getFullYear(), ahora.getMonth(), 0, 23, 59, 59, 999),
  };
}

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

/**
 * "Mes actual" y "Año en curso" son de CALENDARIO: desde el día 1 y desde el 1
 * de enero, hasta hoy.
 *
 * Salían de `resolverRangoActual("mes"|"anio")` de shared, que hasta que el
 * panel pasó a ventanas móviles significaba exactamente eso. Ahora esa función
 * devuelve los últimos 28 y 364 días, así que un contador que pidiera "Mes
 * actual" un 25 de agosto se habría llevado del 29 de julio al 25 de agosto
 * rotulado como el mes. Se calcula acá, que es donde vive el criterio contable
 * — igual que `mesAnteriorCompleto`, y por el mismo motivo.
 */
function desdeElInicioDe(unidad: "mes" | "anio", ahora: Date): RangoFechas {
  return {
    inicio:
      unidad === "anio"
        ? new Date(ahora.getFullYear(), 0, 1)
        : new Date(ahora.getFullYear(), ahora.getMonth(), 1),
    fin: finDelDia(ahora),
  };
}

/** Un mes cerrado pedido por su clave: del 1 al último día, completo. */
function mesCompleto(anio: number, mes: number): RangoFechas {
  return {
    inicio: new Date(anio, mes - 1, 1, 0, 0, 0, 0),
    fin: new Date(anio, mes, 0, 23, 59, 59, 999),
  };
}

export function rangoDeExportacion(
  periodo: unknown,
  ahora: Date = new Date(),
): RangoFechas {
  const p = normalizarPeriodoExportacion(periodo, ahora);
  if (p === "mes_anterior") return mesAnteriorCompleto(ahora);
  if (p === "anio") return desdeElInicioDe("anio", ahora);
  if (p === "anio_anterior") {
    return {
      inicio: new Date(ahora.getFullYear() - 1, 0, 1),
      fin: new Date(ahora.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
    };
  }
  if (p === "mes") return desdeElInicioDe("mes", ahora);

  const coincidencia = PATRON_MES.exec(p);
  // `normalizar` ya validó la clave contra las opciones; esto es solo para el tipo.
  if (!coincidencia) return mesAnteriorCompleto(ahora);
  return mesCompleto(Number(coincidencia[1]), Number(coincidencia[2]));
}

/** El texto que se le muestra al contador antes de descargar: las fechas
 * exactas, para que sepa qué rango está pidiendo. */
export function rangoLegible(periodo: unknown, ahora: Date = new Date()): string {
  const { inicio, fin } = rangoDeExportacion(periodo, ahora);
  const fmt = (f: Date) =>
    f.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
  return `Del ${fmt(inicio)} al ${fmt(fin)}`;
}
