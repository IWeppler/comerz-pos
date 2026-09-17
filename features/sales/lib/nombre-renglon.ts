/**
 * Cómo se nombra un renglón de venta cuando se lee del historial.
 *
 * Un `ventas_items` sin producto puede ser DOS cosas distintas, y hasta
 * `20260917120000` se mostraban igual ("Producto eliminado"):
 *
 *  - el producto existió y alguien lo borró después — ahí sí es
 *    "Producto eliminado", y decirlo es lo correcto;
 *  - una VENTA LIBRE: nunca hubo producto, la descripción tipeada vive en
 *    `variante` y la marca `es_venta_libre` lo declara.
 *
 * Todo lo que muestra un renglón (historial, ticket, devoluciones, reportes)
 * pasa por acá para no repetir la regla en cada pantalla — que es como se
 * llegó a diez "Producto eliminado" sueltos.
 */
export type RenglonNombrable = {
  variante?: string | null;
  es_venta_libre?: boolean | null;
};

export const ETIQUETA_VENTA_LIBRE = "Venta libre";

export function nombreRenglon(
  nombreProducto: string | null | undefined,
  renglon: RenglonNombrable,
): string {
  if (nombreProducto) return nombreProducto;
  if (renglon.es_venta_libre && renglon.variante) return renglon.variante;
  return "Producto eliminado";
}

/** Lo que va en la línea chica debajo del nombre: en la venta libre la
 * descripción ya está arriba, así que abajo va la etiqueta. */
export function detalleRenglon(renglon: RenglonNombrable): string {
  if (renglon.es_venta_libre) return ETIQUETA_VENTA_LIBRE;
  return renglon.variante ?? "";
}
