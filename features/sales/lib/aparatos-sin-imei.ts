/**
 * Aparatos que salen SIN IMEI en una venta, y por qué.
 *
 * Un producto lleva IMEI si lo dice él o su categoría (criterio en SQL:
 * `productos_llevan_serie`, 20261007120000). Cuando una línea de esos
 * productos se vende sin número —no había ninguno cargado, o se venden 3 y solo
 * 2 tienen— la vendedora tiene que escanearlo en el POS o elegir un motivo.
 * Caso que lo originó: ClickTostado 1-18 (6/10/2026), un Redmi Note 14 Pro+
 * vendido sin pedir nada y el ticket sin IMEI.
 *
 * Venta online sin motivo: se rechaza. Venta OFFLINE sin motivo: se graba igual
 * (`motivo = null`, queda como IMEI pendiente para completar desde el
 * historial). La offline llega después de cobrada, con el cliente ya ido:
 * rechazarla no deshace la venta, la deja sin registrar en la cola del celular.
 */

export const MOTIVO_SIN_IMEI_MAX = 200;

/** Opciones que ofrece el POS. "Otro" lleva texto libre. */
export const MOTIVOS_SIN_IMEI = [
  "Sin conexión para cargarlo",
  "Aparato en caja sellada",
] as const;

/** Motivo limpio: espacios colapsados y recortado al largo de la columna.
 * Vacío = no hay motivo. */
export function normalizarMotivoSinImei(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.replace(/\s+/g, " ").trim();
  return limpio ? limpio.slice(0, MOTIVO_SIN_IMEI_MAX) : null;
}

/**
 * Lee el `sin_imei` del FormData: `[{ varianteId, motivo }]`. Lo que no tiene
 * la forma se ignora (un motivo mal formado es lo mismo que no mandarlo, y eso
 * lo frena `resolverAparatosSinImei`).
 */
export function parsearMotivosSinImei(raw: string | null): Map<string, string> {
  const motivos = new Map<string, string>();
  if (!raw) return motivos;
  let datos: unknown;
  try {
    datos = JSON.parse(raw);
  } catch {
    return motivos;
  }
  if (!Array.isArray(datos)) return motivos;
  for (const entrada of datos) {
    if (!entrada || typeof entrada !== "object") continue;
    const { varianteId, motivo } = entrada as Record<string, unknown>;
    const limpio = normalizarMotivoSinImei(motivo);
    if (typeof varianteId === "string" && varianteId && limpio) {
      motivos.set(varianteId, limpio);
    }
  }
  return motivos;
}

export interface RenglonVendido {
  varianteId: string | null;
  cantidad: number;
  /** Aparatos de la línea que salen con unidad elegida. */
  aparatosConImei: number;
}

export type ResultadoSinImei =
  | {
      ok: true;
      /** Motivo para la parte SIN número de cada renglón (por índice). null =
       * pendiente (venta offline). Los renglones que no aplican no están. */
      motivoPorRenglon: Map<number, string | null>;
    }
  | { ok: false; indice: number };

export function resolverAparatosSinImei({
  renglones,
  llevaSerie,
  motivos,
  esVentaOffline,
}: {
  renglones: RenglonVendido[];
  llevaSerie: ReadonlySet<string>;
  motivos: ReadonlyMap<string, string>;
  esVentaOffline: boolean;
}): ResultadoSinImei {
  const motivoPorRenglon = new Map<number, string | null>();
  for (const [indice, renglon] of renglones.entries()) {
    if (!renglon.varianteId || !llevaSerie.has(renglon.varianteId)) continue;
    if (renglon.cantidad - renglon.aparatosConImei <= 0) continue;

    const motivo = motivos.get(renglon.varianteId) ?? null;
    if (!motivo && !esVentaOffline) return { ok: false, indice };
    motivoPorRenglon.set(indice, motivo);
  }
  return { ok: true, motivoPorRenglon };
}
