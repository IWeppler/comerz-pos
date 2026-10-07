/**
 * ¿Una categoría con este nombre es de celulares / tablets? Sus productos nacen
 * pidiendo IMEI.
 *
 * ESPEJO de `categoria_pide_imei_por_nombre` en SQL (20261007140000), que es la
 * que manda: el trigger `productos_lleva_serie_por_categoria` marca
 * `productos.lleva_serie` al crear el producto. Esta copia la usa la
 * conciliación para pedir el IMEI de los productos que todavía no creó. Los
 * casos del test son los mismos que los guards de la migración.
 *
 * El nombre tiene que SER ese, no contenerlo: "Accesorios para celulares" no
 * pide IMEI.
 */
const NOMBRES = new Set([
  "celular",
  "celulares",
  "smartphone",
  "smartphones",
  "tablet",
  "tablets",
  "celulares y tablets",
  "tablets y celulares",
  "telefonos celulares",
  "telefonia celular",
  "moviles",
  "telefonos moviles",
]);

export function categoriaPideImeiPorNombre(
  nombre: string | null | undefined,
): boolean {
  const normalizado = (nombre ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  return NOMBRES.has(normalizado);
}
