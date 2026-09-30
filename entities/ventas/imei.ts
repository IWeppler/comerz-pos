/**
 * Forma canónica de un IMEI / número de serie tipeado o escaneado.
 *
 * Se sacan TODOS los espacios (el IMEI impreso en la caja viene agrupado:
 * "35 539737 742308 3") y se pasa a mayúsculas (los números de serie de
 * notebooks y consolas son alfanuméricos). La unicidad en la base es por
 * `(negocio_id, imei)` exacto: sin esto, el mismo aparato tipeado de dos
 * formas serían dos unidades.
 */
export function normalizarImei(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\s+/g, "").toUpperCase();
}
