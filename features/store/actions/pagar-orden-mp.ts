"use server";

import { headers } from "next/headers";
import { createPublicClient } from "@/shared/config/supabase/server";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { HEADER_NEGOCIO_SLUG } from "@/shared/lib/negocio-slug";
import { iniciarCheckoutOrden } from "@/features/cobros-online/lib/checkout-mp-servidor";

/**
 * "Pagar con Mercado Pago" desde la página de la orden (la clienta volvió sin
 * pagar, o el primer intento de abrir MP falló).
 *
 * Público: la llave es el token de la orden (48 hex) y el negocio el del
 * subdominio; los dos tienen que coincidir. La preference se crea o se reusa
 * con el token del COMERCIO (`iniciarCheckoutOrden`).
 */

export type ResultadoPagarMp = { ok: true; initPoint: string } | { ok: false; error: string };

const MENSAJES = {
  NO_DISPONIBLE: "Mercado Pago no está disponible en esta tienda ahora. Escribile a la tienda para pagar de otra forma.",
  ORDEN_NO_PAGABLE: "Esta orden ya no se puede pagar: ya está pagada, venció o se canceló.",
  ERROR: "No pudimos abrir Mercado Pago. Probá de nuevo en un rato.",
} as const;

export async function pagarOrdenMpAction(tokenPublico: string): Promise<ResultadoPagarMp> {
  if (!/^[0-9a-f]{48}$/.test(tokenPublico ?? "")) return { ok: false, error: MENSAJES.ORDEN_NO_PAGABLE };

  const slug = (await headers()).get(HEADER_NEGOCIO_SLUG);
  if (!slug) return { ok: false, error: MENSAJES.ERROR };
  const { data: negocio } = await (await createPublicClient())
    .from("negocios")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!negocio?.id) return { ok: false, error: MENSAJES.ERROR };

  const { data: orden } = await createAdminClient()
    .from("ordenes_tienda")
    .select("id")
    .eq("token_publico", tokenPublico)
    .eq("negocio_id", negocio.id as string)
    .maybeSingle();
  if (!orden) return { ok: false, error: MENSAJES.ORDEN_NO_PAGABLE };

  const r = await iniciarCheckoutOrden(negocio.id as string, orden.id as string);
  return r.ok ? { ok: true, initPoint: r.initPoint } : { ok: false, error: MENSAJES[r.motivo] };
}
