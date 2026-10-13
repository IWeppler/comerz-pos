import type { Metadata } from "next";
import { leerConfigPublica } from "@/entities/config/lib/leer-config-publica";
import { CheckoutPublico } from "@/features/store/components/checkout/checkout-publico";

/** Es la compra de una persona, no una vidriera. */
export const metadata: Metadata = {
  title: "Finalizar compra",
  robots: { index: false, follow: false },
};

/**
 * `<tienda>/checkout`: contacto, entrega y pago con el resumen del pedido.
 * El carrito vive en el navegador (store persistido), así que la página es
 * del cliente; acá solo baja el WhatsApp para los pedidos que siguen por chat.
 */
export default async function CheckoutPage() {
  const config = await leerConfigPublica();
  return <CheckoutPublico numeroWhatsApp={config?.whatsapp ?? undefined} />;
}
