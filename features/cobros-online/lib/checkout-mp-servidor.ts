import "server-only";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { urlDelPanel, urlDeTienda } from "@/shared/lib/ruteo-host";
import { crearClienteOAuthMp, leerConfigAppMp } from "./cliente-oauth-mp";
import { tokenVigente } from "./conexion-mercadopago";
import { crearRepoConexionSupabase } from "./repo-conexion-supabase";
import { armarPreferencia } from "./preferencia-mp";

/**
 * Llevar a la clienta a pagar una orden con Checkout Pro.
 *
 * - La preference se crea con el token del COMERCIO dueño de la orden (el
 *   negocio sale de la orden, nunca del navegador).
 * - UNA preference por orden: si ya tiene una, se reusa (se le pide el link a
 *   MP). Una orden que no está pendiente (pagada, vencida, cancelada) no
 *   genera ninguna.
 * - Si la conexión con MP no sirve (token vencido, permiso revocado), se
 *   devuelve NO_DISPONIBLE y la clienta elige otro medio; `tokenVigente` ya
 *   marcó la conexión para que el comercio vea "Reconectar" en Cobros.
 */

const API_MP = "https://api.mercadopago.com";

export type ResultadoCheckout =
  | { ok: true; initPoint: string }
  | { ok: false; motivo: "NO_DISPONIBLE" | "ORDEN_NO_PAGABLE" | "ERROR" };

export async function tokenDelComercio(negocioId: string) {
  const config = leerConfigAppMp();
  if (!config) return null;
  const token = await tokenVigente(
    { repo: crearRepoConexionSupabase(), mp: crearClienteOAuthMp(config) },
    negocioId,
  );
  return token.ok ? token : null;
}

async function mp(token: string, ruta: string, init?: RequestInit) {
  const respuesta = await fetch(`${API_MP}${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const json = (await respuesta.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: respuesta.ok, status: respuesta.status, json };
}

const linkDe = (json: Record<string, unknown> | null): string | null =>
  (json?.init_point as string | undefined) ?? (json?.sandbox_init_point as string | undefined) ?? null;

export async function iniciarCheckoutOrden(
  negocioId: string,
  ordenId: string,
): Promise<ResultadoCheckout> {
  try {
    const admin = createAdminClient();
    const { data: orden } = await admin
      .from("ordenes_tienda")
      .select("id, numero, estado, medio, total, vence_en, token_publico, cliente_nombre, mp_preference_id")
      .eq("id", ordenId)
      .eq("negocio_id", negocioId)
      .maybeSingle();
    if (
      !orden ||
      orden.estado !== "PENDIENTE_PAGO" ||
      (orden.medio !== "MP_CHECKOUT" && orden.medio !== "MP_CREDITO") ||
      new Date(orden.vence_en as string).getTime() <= Date.now()
    ) {
      return { ok: false, motivo: "ORDEN_NO_PAGABLE" };
    }

    const token = await tokenDelComercio(negocioId);
    if (!token) return { ok: false, motivo: "NO_DISPONIBLE" };

    // Ya tiene preference: se reusa la misma.
    if (orden.mp_preference_id) {
      const r = await mp(token.accessToken, `/checkout/preferences/${encodeURIComponent(orden.mp_preference_id as string)}`);
      const link = r.ok ? linkDe(r.json) : null;
      if (link) return { ok: true, initPoint: link };
    }

    const [{ data: negocio }, { data: config }] = await Promise.all([
      admin.from("negocios").select("slug").eq("id", negocioId).maybeSingle(),
      admin.from("configuracion_pos").select("posName").eq("negocio_id", negocioId).maybeSingle(),
    ]);
    if (!negocio?.slug) return { ok: false, motivo: "ERROR" };

    // `?n=`: el webhook sabe de qué comercio es el aviso sin confiar en él
    // (igual lee el pago con el token de ese comercio y cruza la cuenta).
    const webhook = urlDelPanel("/api/mercadopago/webhook", `?n=${negocioId}`);
    const cuerpo = armarPreferencia({
      ordenId: orden.id as string,
      negocioId,
      numero: orden.numero as number,
      total: Number(orden.total),
      medio: orden.medio as "MP_CHECKOUT" | "MP_CREDITO",
      nombreComercio: (config as { posName?: string } | null)?.posName ?? null,
      clienteNombre: orden.cliente_nombre as string,
      venceEn: new Date(orden.vence_en as string),
      urlRetorno: urlDeTienda(negocio.slug as string, `/orden/${orden.token_publico}`),
      urlNotificacion: webhook.startsWith("https://") ? webhook : null,
    });

    const creada = await mp(token.accessToken, "/checkout/preferences", {
      method: "POST",
      body: JSON.stringify(cuerpo),
      headers: { "X-Idempotency-Key": `preferencia-${orden.id}` },
    });
    const link = creada.ok ? linkDe(creada.json) : null;
    if (!link || !creada.json?.id) {
      console.error("[CHECKOUT MP] preference", creada.status, (creada.json as { message?: string } | null)?.message);
      return { ok: false, motivo: creada.status === 401 || creada.status === 403 ? "NO_DISPONIBLE" : "ERROR" };
    }

    // Se guarda solo si no tenía: dos pestañas a la vez no pisan la primera.
    await admin
      .from("ordenes_tienda")
      .update({ mp_preference_id: String(creada.json.id), actualizado_en: new Date().toISOString() })
      .eq("id", orden.id as string)
      .eq("negocio_id", negocioId)
      .is("mp_preference_id", null);

    return { ok: true, initPoint: link };
  } catch (e) {
    console.error("[CHECKOUT MP]", (e as Error).message);
    return { ok: false, motivo: "ERROR" };
  }
}
