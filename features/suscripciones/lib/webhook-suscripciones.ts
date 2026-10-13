import "server-only";
import { createAdminClient } from "@/shared/config/supabase/admin";
import type { AvisoMp, VeredictoFirma } from "@/features/cobros-online/lib/webhook-mp";
import { cobroAprobado, esIdMp, estadoPreapproval, type PagoAutorizadoMp } from "./preapproval";
import { mpComerz } from "./mp-comerz-servidor";

/**
 * Avisos de Mercado Pago de las suscripciones de Comerz (la cuenta de Comerz,
 * no la de un comercio):
 *   - `subscription_preapproval`: la suscripción cambió (se autorizó la
 *     tarjeta, se pausó, se canceló) → se copia el estado.
 *   - `subscription_authorized_payment`: una cuota → si su pago está aprobado,
 *     `registrar_pago_suscripcion_mp` (idempotente) registra el pago y corre
 *     el vencimiento.
 *
 * Como siempre: el aviso no se cree, se lee de la API con el token de Comerz.
 * Solo avisos con firma válida (los de suscripción los manda la configuración
 * de Webhooks de la app, firmados). Devuelve el código HTTP.
 */

export const TIPOS_SUSCRIPCION = new Set(["subscription_preapproval", "subscription_authorized_payment"]);

export async function procesarAvisoSuscripcion(aviso: AvisoMp, firma: VeredictoFirma): Promise<number> {
  if (firma !== "VALIDA") {
    console.warn("[SUSCRIPCION MP] aviso sin firma, ignorado", { tipo: aviso.tipo });
    return 200;
  }
  if (!esIdMp(aviso.recursoId)) return 200;
  const admin = createAdminClient();

  if (aviso.tipo === "subscription_preapproval") {
    const r = await mpComerz(`/preapproval/${encodeURIComponent(aviso.recursoId)}`);
    if (!r) return 200; // sin token: no es de Comerz
    if (r.status === 404) return 200;
    if (!r.ok) return 500;
    const estado = estadoPreapproval(r.json?.status);
    if (!estado) return 200;
    const { error } = await admin
      .from("suscripciones_mp")
      .update({ estado, actualizado_en: new Date().toISOString() })
      .eq("preapproval_id", aviso.recursoId)
      .neq("estado", estado)
      .select("id");
    if (error) {
      console.error("[SUSCRIPCION MP] estado", error.code, error.message);
      return 500;
    }
    return 200;
  }

  // subscription_authorized_payment
  const r = await mpComerz(`/authorized_payments/${encodeURIComponent(aviso.recursoId)}`);
  if (!r) return 200;
  if (r.status === 404) return 200;
  if (!r.ok) return 500;
  const cobro = cobroAprobado((r.json ?? {}) as PagoAutorizadoMp);
  if (!cobro) return 200; // rechazada o en reintento: MP vuelve a avisar

  const { data, error } = await admin.rpc("registrar_pago_suscripcion_mp", {
    p_preapproval_id: cobro.preapprovalId,
    p_mp_payment_id: cobro.mpPaymentId,
    p_monto: cobro.monto,
    p_fecha: cobro.fecha,
  });
  if (error) {
    console.error("[SUSCRIPCION MP] registrar", error.code, error.message);
    return 500;
  }
  if (data !== "APLICADO" && data !== "DUPLICADO") {
    console.warn("[SUSCRIPCION MP]", data, { preapproval: cobro.preapprovalId });
  }
  return 200;
}
