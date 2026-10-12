/**
 * ¿El catálogo puede cobrar con Mercado Pago (checkout)?
 *
 * Sí desde T6 (preference + conciliación por `external_reference`). Es la
 * llave de código para apagar el checkout entero sin tocar a cada comercio:
 * en false el carrito no ofrece "Mercado Pago" ni "Cuotas sin tarjeta" y la
 * action los rechaza.
 */
export const CHECKOUT_MP_DISPONIBLE = true;
