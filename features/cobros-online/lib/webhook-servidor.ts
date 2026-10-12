import "server-only";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { tokenDelComercio } from "./checkout-mp-servidor";
import { aplicarPagoMp, conciliarPagosNegocio } from "./conciliar-servidor";
import { destinoDelPago, esAvisoDePago, type AvisoMp, type PagoMpCompleto, type VeredictoFirma } from "./webhook-mp";

/**
 * Un aviso de Mercado Pago, de punta a punta (la parte pura está en
 * `webhook-mp.ts`). Devuelve el código HTTP:
 *   - 200: hecho, o nada que hacer (MP no tiene que reintentar).
 *   - 500: error transitorio (token, red, base): MP reintenta, y si nunca
 *     llega, la conciliación por lectura lo registra igual.
 *
 * El negocio sale de `?n=` (la notification_url de cada preference) o, si no
 * vino, de la cuenta de MP del aviso. Se cruza con la conexión guardada: un
 * pago que cobró otra cuenta no toca nada.
 */

const API_MP = "https://api.mercadopago.com";

type Admin = ReturnType<typeof createAdminClient>;

async function negociosDelAviso(admin: Admin, aviso: AvisoMp): Promise<{ negocioId: string; mpUserId: string }[]> {
  let consulta = admin.from("mercadopago_conexiones").select("negocio_id, mp_user_id").eq("estado", "ACTIVA");
  if (aviso.negocioId) consulta = consulta.eq("negocio_id", aviso.negocioId);
  else if (aviso.mpUserId) consulta = consulta.eq("mp_user_id", aviso.mpUserId);
  else return [];
  const { data } = await consulta;
  return (data ?? [])
    .filter((c) => !aviso.mpUserId || String(c.mp_user_id) === aviso.mpUserId)
    .map((c) => ({ negocioId: c.negocio_id as string, mpUserId: String(c.mp_user_id) }));
}

async function registrarAjeno(admin: Admin, negocioId: string, pagoId: string) {
  await admin
    .from("eventos_pago")
    .upsert(
      {
        negocio_id: negocioId,
        origen: "MP_WEBHOOK",
        clave_idempotencia: `mp:${pagoId}:collector`,
        mp_payment_id: pagoId,
        resultado: "RECHAZADO_COLLECTOR",
      },
      { onConflict: "clave_idempotencia", ignoreDuplicates: true },
    );
}

export async function procesarAvisoMp(aviso: AvisoMp, firma: VeredictoFirma): Promise<number> {
  if (!esAvisoDePago(aviso)) return 200;

  const admin = createAdminClient();
  const negocios = await negociosDelAviso(admin, aviso);
  if (!negocios.length) {
    console.warn("[WEBHOOK MP] sin negocio", { tipo: aviso.tipo, n: aviso.negocioId, user: aviso.mpUserId });
    return 200;
  }

  // STOPGAP #6: sin firma, solo una pista. La conciliación lee de la API, con su límite.
  if (firma !== "VALIDA") {
    for (const { negocioId } of negocios) await conciliarPagosNegocio(negocioId);
    return 200;
  }

  let codigo = 200;
  for (const { negocioId } of negocios) {
    const token = await tokenDelComercio(negocioId);
    if (!token) {
      console.error("[WEBHOOK MP] sin token", { negocioId });
      codigo = 500;
      continue;
    }

    let respuesta: Response;
    try {
      respuesta = await fetch(`${API_MP}/v1/payments/${aviso.recursoId}`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
    } catch {
      codigo = 500;
      continue;
    }
    // 404: el pago no es de esta cuenta (o es un aviso de prueba). Nada que reintentar.
    if (respuesta.status === 404) continue;
    if (!respuesta.ok) {
      console.error("[WEBHOOK MP] GET pago", respuesta.status);
      codigo = respuesta.status >= 500 || respuesta.status === 429 ? 500 : codigo;
      continue;
    }
    const pago = (await respuesta.json()) as PagoMpCompleto;
    const destino = destinoDelPago(pago, token.mpUserId);

    if (destino.tipo === "AJENO") {
      console.warn("[WEBHOOK MP] pago de otra cuenta", { negocioId, pago: String(pago.id) });
      await registrarAjeno(admin, negocioId, String(pago.id));
    } else if (destino.tipo === "TRANSFERENCIA") {
      await conciliarPagosNegocio(negocioId);
    } else if (destino.tipo === "ORDEN") {
      const { data: orden } = await admin
        .from("ordenes_tienda")
        .select("id")
        .eq("id", destino.ordenId)
        .eq("negocio_id", negocioId)
        .maybeSingle();
      if (!orden) continue;
      const r = await aplicarPagoMp(admin, negocioId, destino.ordenId, pago, "MP_WEBHOOK");
      if (!r.ok) codigo = 500;
    }
  }
  return codigo;
}
