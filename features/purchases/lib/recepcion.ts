/**
 * Lo que de verdad entra de cada renglón de un remito, contra lo que decía el
 * remito. Un solo criterio para la pantalla y para la aprobación.
 *
 * `cantidad` es lo que facturó el proveedor y no se toca nunca.
 * `cantidad_recibida` es lo que llegó: `null` = lo mismo que el remito, `0` =
 * no vino ("descartar agrupación"), otro número = se corrigió en pantalla.
 * La RPC `aprobar_orden_compra` lo guarda en `ordenes_items` y solo mueve
 * stock de lo que de verdad entró (20261006130000).
 */

export const MOTIVO_NO_VINO = "No vino";
export const MOTIVO_CANTIDAD_CORREGIDA = "Cantidad corregida";
/** Para los borradores de antes de 20261006130000: "descartar" sacaba las
 * filas de la lista. Al restaurarlos, esas filas vuelven como no recibidas
 * (que era la intención) en vez de desaparecer y trabar la aprobación. */
export const MOTIVO_DESCARTE_ANTERIOR = "Descartado en la conciliación";

export interface LineaRecepcion {
  id?: string;
  cantidad: number;
  cantidad_recibida?: number | null;
  motivo_ajuste?: string | null;
}

export function cantidadEfectiva(linea: LineaRecepcion): number {
  const recibida = linea.cantidad_recibida;
  return recibida === null || recibida === undefined
    ? Number(linea.cantidad) || 0
    : Number(recibida) || 0;
}

/** ¿El renglón entra al stock? Uno con 0 no necesita producto. */
export function entraAlStock(linea: LineaRecepcion): boolean {
  return cantidadEfectiva(linea) > 0;
}

/** Un grupo está descartado cuando NINGUNA de sus líneas entra. */
export function grupoNoVino(lineas: LineaRecepcion[]): boolean {
  return lineas.length > 0 && lineas.every((l) => !entraAlStock(l));
}

/**
 * Nueva cantidad recibida para un renglón. Volver al número del remito limpia
 * el ajuste (`null`): no queda un "corregido" que dice lo mismo.
 */
export function conCantidadRecibida<T extends LineaRecepcion>(
  linea: T,
  cantidad: number,
  motivo: string,
): T {
  const valor = Math.max(0, Number.isFinite(cantidad) ? cantidad : 0);
  if (valor === Number(linea.cantidad)) {
    return { ...linea, cantidad_recibida: null, motivo_ajuste: null };
  }
  return { ...linea, cantidad_recibida: valor, motivo_ajuste: motivo };
}

/**
 * Completa un borrador con los renglones del remito que le faltan, marcados
 * como no recibidos. La aprobación exige que viajen TODOS los renglones
 * (`REMITO_LINEAS_FALTANTES`), y un borrador viejo sin los descartados
 * quedaría trabado para siempre.
 */
export function completarConFaltantes<T extends LineaRecepcion>(
  borrador: T[],
  originales: T[],
): T[] {
  const presentes = new Set(borrador.map((l) => l.id).filter(Boolean));
  const faltantes = originales
    .filter((o) => o.id && !presentes.has(o.id))
    .map((o) => ({
      ...o,
      cantidad_recibida: 0,
      motivo_ajuste: MOTIVO_DESCARTE_ANTERIOR,
    }));
  return faltantes.length > 0 ? [...borrador, ...faltantes] : borrador;
}
