/**
 * El dólar MEP, para medir los gastos de Comerz en pesos y en dólares.
 *
 * Fuente: `dolarapi.com/v1/dolares/bolsa` (JSON público y sin clave). dolarhoy.com
 * no ofrece una API, y sus tablas figuran como propiedad intelectual: no se
 * scrapea. Los dos muestran el mismo MEP.
 *
 * Se usa `venta`, no `compra`: pagar un servicio en dólares es COMPRAR dólares,
 * y eso cuesta lo que la casa los vende.
 *
 * Puro: recibe el JSON y la hora, así la validación se testea sin red. La
 * respuesta viene de afuera, así que se valida: un número roto o viejo no tiene
 * que terminar convertido en un gasto.
 */

export interface CotizacionMep {
  /** Pesos por dólar (precio de venta). */
  venta: number;
  /** ISO de cuándo la actualizó la fuente. */
  fecha: string;
  /** Más de 3 días sin actualizarse: se muestra, pero avisando. */
  vieja: boolean;
}

export const URL_MEP = "https://dolarapi.com/v1/dolares/bolsa";

/** Un MEP fuera de este rango es un dato roto, no una cotización. */
const MEP_MINIMO = 1;
const MEP_MAXIMO = 1_000_000;
const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;

export function leerCotizacionMep(
  json: unknown,
  ahora: Date,
): CotizacionMep | null {
  if (typeof json !== "object" || json === null) return null;
  const crudo = json as Record<string, unknown>;

  const venta = Number(crudo.venta);
  if (!Number.isFinite(venta) || venta < MEP_MINIMO || venta > MEP_MAXIMO) {
    return null;
  }

  const fecha = typeof crudo.fechaActualizacion === "string" ? crudo.fechaActualizacion : "";
  const instante = new Date(fecha).getTime();
  // Sin fecha legible no se sabe cuán vieja es: se descarta en vez de suponer
  // que es de hoy.
  if (Number.isNaN(instante)) return null;

  return {
    venta,
    fecha,
    vieja: ahora.getTime() - instante > TRES_DIAS_MS,
  };
}

const aDosDecimales = (n: number) => Math.round(n * 100) / 100;

export function usdAPesos(usd: number, mep: number): number {
  return aDosDecimales(usd * mep);
}

export function pesosAUsd(pesos: number, mep: number): number {
  return aDosDecimales(pesos / mep);
}

/** "US$ 21" para mostrar. Sin decimales: es una lectura, no un registro. */
export function formatearUsd(usd: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(usd);
}
