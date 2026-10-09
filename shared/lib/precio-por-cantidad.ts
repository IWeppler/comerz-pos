import { redondearCantidad } from "@/shared/lib/unidad-venta";

/** Precios absolutos por unidad base. Cada variante acumula su propia cantidad.
 * Espejo de validación: public.precios_por_cantidad_validos(jsonb).
 * El tramo reemplaza el precio de lista; las promociones se calculan después.
 */
export interface TramoCantidad {
  desde: number;
  precio: number;
}

export const MAX_TRAMOS_CANTIDAD = 20;
export const ERROR_TRAMOS_CANTIDAD =
  "Revisá los tramos: hasta 20 cantidades desde 1, sin repetir, en orden creciente, y precios mayores a cero con hasta 2 decimales.";

export function validarTramosCantidad(valor: unknown): valor is TramoCantidad[] {
  if (!Array.isArray(valor) || valor.length > MAX_TRAMOS_CANTIDAD) return false;
  let anterior = 0;
  for (const tramo of valor) {
    if (!tramo || typeof tramo !== "object" || Array.isArray(tramo) ||
      Object.keys(tramo).length !== 2 ||
      typeof tramo.desde !== "number" || !Number.isSafeInteger(tramo.desde) ||
      tramo.desde < 1 || tramo.desde > 1_000_000_000 || tramo.desde <= anterior ||
      typeof tramo.precio !== "number" || !Number.isFinite(tramo.precio) ||
      tramo.precio <= 0 || tramo.precio > 1_000_000_000 ||
      Number(tramo.precio.toFixed(2)) !== tramo.precio) return false;
    anterior = tramo.desde;
  }
  return true;
}

/** null = el formulario no tocó la configuración; [] = quitar los tramos. */
export function leerTramosCantidad(form: FormData): TramoCantidad[] | null {
  if (!form.has("precios_por_cantidad")) return null;
  let valor: unknown;
  try { valor = JSON.parse(String(form.get("precios_por_cantidad"))); }
  catch { throw new Error(ERROR_TRAMOS_CANTIDAD); }
  if (!validarTramosCantidad(valor)) throw new Error(ERROR_TRAMOS_CANTIDAD);
  return valor;
}

export function precioPorCantidad(precioHabitual: number, cantidad: number,
  tramos: TramoCantidad[] | null | undefined,
): { precio: number; desde: number | null } {
  if (!tramos?.length || !validarTramosCantidad(tramos) ||
    !Number.isFinite(cantidad) || cantidad <= 0 || !Number.isFinite(precioHabitual) || precioHabitual <= 0) {
    return { precio: precioHabitual, desde: null };
  }
  const elegido = tramos.findLast((t) => cantidad >= t.desde);
  return elegido ? { precio: elegido.precio, desde: elegido.desde }
    : { precio: precioHabitual, desde: null };
}

interface LineaCantidad {
  productoId: string;
  varianteId?: string | null;
  variante: string;
  cantidad: number;
  precio: number;
  precioBase?: number;
  precioBaseEfectivo?: number;
  importeFijado?: number | null;
  precioSinImporte?: number | null;
  preciosPorCantidad?: TramoCantidad[] | null;
  tramoCantidadDesde?: number | null;
  presentacionId?: string | null;
  ventaLibre?: boolean;
}

export function claveCantidad(linea: Pick<LineaCantidad, "productoId" | "varianteId" | "variante">): string {
  return JSON.stringify([linea.productoId, linea.varianteId || linea.variante]);
}

/** La variante real conserva identidad aunque cambie su nombre. */
export function sumarCantidadesBase(items: ReadonlyArray<Pick<LineaCantidad, "productoId" | "varianteId" | "variante" | "cantidad" | "ventaLibre" | "presentacionId">>): Map<string, number> {
  const cantidades = new Map<string, number>();
  for (const item of items) {
    if (item.ventaLibre || item.presentacionId) continue;
    const clave = claveCantidad(item);
    cantidades.set(clave, redondearCantidad((cantidades.get(clave) ?? 0) + item.cantidad));
  }
  return cantidades;
}

/** También cubre tickets restaurados y renglones duplicados de la misma variante. */
export function retarifarPorCantidad<T extends LineaCantidad>(items: T[]): T[] {
  const cantidades = sumarCantidadesBase(items);
  return items.map((item) => {
    if (item.ventaLibre || item.presentacionId || (!item.preciosPorCantidad?.length && item.tramoCantidadDesde == null)) return item;
    const base = item.precioBase ?? item.precioSinImporte ?? item.precio;
    const habitual = item.precioBaseEfectivo ?? base;
    const resuelto = precioPorCantidad(habitual, cantidades.get(claveCantidad(item)) ?? item.cantidad, item.preciosPorCantidad);
    if (resuelto.precio === item.precio && item.tramoCantidadDesde === resuelto.desde &&
      item.precioBase !== undefined && item.precioBaseEfectivo !== undefined && item.importeFijado == null) return item;
    return { ...item, precioBase: base, precioBaseEfectivo: habitual,
      precio: resuelto.precio, tramoCantidadDesde: resuelto.desde, importeFijado: null, precioSinImporte: null };
  });
}
