import { redondearCantidad } from "./unidad-venta";

/**
 * Vender por IMPORTE un producto por peso: "$1000 de jamón".
 *
 * EL PROBLEMA. El peso se guarda al gramo (`numeric(12,3)`), así que casi
 * nunca existe un peso que multiplicado por el precio del kilo dé justo el
 * importe pedido. A $8.600/kg, $1000 son 116,28 g: con 116 g la línea da $998
 * y con 117 g, $1006. Antes el POS recalculaba el total desde el peso y la
 * clienta que pidió $1000 veía $1002 en el ticket.
 *
 * LA REGLA. Se cobra EXACTO el importe pedido y el peso se redondea al gramo
 * más cercano. La diferencia entre los dos —como mucho medio gramo de
 * mercadería— es el "leve margen", y queda como un precio por kilo efectivo
 * apenas distinto del de lista en ESA línea ($1000 / 0,116 kg = $8.620,69).
 *
 * EL FRENO. Un importe se acepta solo si difiere de peso × precio en no más de
 * lo que vale UN gramo (mínimo $1, por el redondeo al peso). Sin ese tope,
 * "importe fijado" sería una forma de cobrar cualquier precio con un request
 * modificado. El server lo vuelve a chequear contra el precio de la base
 * (`create-sale.ts`); esto es el espejo del POS.
 */

/** Lo que vale un gramo (una unidad mínima de peso), con piso de $1. */
export function toleranciaImporte(precioPorUnidad: number): number {
  const precio = Math.max(0, Number(precioPorUnidad) || 0);
  return Math.max(1, precio * 0.001);
}

/** El peso que corresponde a un importe, redondeado al gramo más cercano. */
export function cantidadParaImporte(
  importe: number,
  precioPorUnidad: number,
): number | null {
  if (!(importe > 0) || !(precioPorUnidad > 0)) return null;
  const cantidad = redondearCantidad(importe / precioPorUnidad);
  return cantidad > 0 ? cantidad : null;
}

/** ¿Se puede cobrar `importe` por `cantidad` a este precio sin salirse del
 * margen de un gramo? */
export function importeDentroDeMargen(
  importe: number,
  cantidad: number,
  precioPorUnidad: number,
): boolean {
  if (!(importe > 0) || !(cantidad > 0) || !(precioPorUnidad > 0)) return false;
  return (
    Math.abs(importe - cantidad * precioPorUnidad) <=
    toleranciaImporte(precioPorUnidad) + 1e-9
  );
}
