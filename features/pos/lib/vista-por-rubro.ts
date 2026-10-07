import type { Rubro } from "@/entities/config/types";

/**
 * Rubros donde el POS se ve MEJOR sin fotos.
 *
 * La foto de producto no es decoración: en indumentaria es el dato que
 * identifica la prenda —una remera negra lisa y otra con estampa se llaman casi
 * igual— y sacarla haría más lenta la venta, no más rápida.
 *
 * En el mostrador de un kiosco o un almacén pasa lo contrario. El producto se
 * identifica por su NOMBRE completo ("Gaseosa Cola 2,25L", "Yerba Mate 500g"),
 * que ya trae el formato y la marca, y la venta es de muchos ítems chicos: lo
 * escaso es cuántos productos entran en pantalla sin scrollear, no reconocer
 * cuál es cuál. Una card con foto de 4:3 muestra 8 productos donde una fila
 * muestra 20.
 *
 * FARMACIA y FERRETERÍA entran por el mismo motivo, y en los dos la foto es
 * todavía menos útil que en un kiosco: un remedio se pide por nombre y
 * presentación ("Ibuprofeno 600 x30") y un tornillo por medida y material, y
 * la miniatura de un tornillo de 3/8 es idéntica a la de uno de 1/2. Mostrar
 * una foto que no distingue no es neutro: ocupa el lugar del texto que sí
 * distingue.
 *
 * ELECTRO se queda con fotos a propósito, aunque también se escanee: ahí el
 * ticket es alto y la venta asistida, y ver el aparato antes de cobrarlo es
 * parte de confirmar que es el modelo correcto.
 *
 * `otros` también las conserva: no se sabe qué vende ese comercio, y esconder
 * información por las dudas es peor que mostrar una foto de más.
 */
const RUBROS_SIN_IMAGEN: readonly Rubro[] = [
  "quioscos",
  "alimentos",
  "farmacia",
  "ferreteria",
  "pintureria",
] as const;

/**
 * Si el POS de este rubro va en modo lista (sin fotos en la grilla ni en el
 * ticket del carrito).
 *
 * Es del RUBRO y no una preferencia por usuario a propósito: la densidad de la
 * pantalla de venta es una decisión del negocio, no de quien está atendiendo,
 * y un toggle en el POS es un toggle que alguien va a tocar sin querer en el
 * medio de una venta.
 *
 * OJO: esto vale para el POS únicamente. El catálogo PÚBLICO sigue con fotos
 * en todos los rubros — ahí la foto es lo que vende, y quien compra desde el
 * teléfono no tiene el producto delante.
 */
export function posSinImagenes(rubro: Rubro): boolean {
  return RUBROS_SIN_IMAGEN.includes(rubro);
}
