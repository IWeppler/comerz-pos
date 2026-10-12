import "server-only";
import { createAdminClient } from "@/shared/config/supabase/admin";
import { tokenDelComercio } from "./checkout-mp-servidor";
import { conciliarTransferencias, type PagoMp } from "./conciliar-transferencias";
import type { PagoCheckout } from "./preferencia-mp";
import { pagoParaLaBase, pagoQueDecideLaOrden } from "./webhook-mp";

/**
 * Concilia los pagos de UN negocio contra su Mercado Pago y registra la venta
 * de cada orden pagada:
 *   1. CHECKOUT (MP / cuotas sin tarjeta): busca los pagos de cada orden por su
 *      `external_reference` y aplica el que decide (`pagoQueDecideLaOrden`)
 *      con `aplicar_pago_mp_orden`, la MISMA puerta que el webhook. Es su red
 *      de seguridad: si el aviso no llegó, el pago se registra igual cuando
 *      alguien mira (o cuando llega un aviso sin firma).
 *   2. TRANSFERENCIA al alias de MP: por monto exacto y ventana
 *      (`conciliar-transferencias.ts`).
 *   3. Recién después vence las impagas: así un pago del último minuto se
 *      registra antes de que su orden devuelva el stock.
 *
 * Nunca se confía en lo que trae el navegador (el regreso de MP con
 * `?status=approved`): siempre se lee el pago de la API con el token del
 * comercio.
 *
 * La disparan las LECTURAS (STOPGAP #1, sin job). A lo sumo una vez cada 30 s
 * por negocio. NUNCA lanza.
 */

const API_MP = "https://api.mercadopago.com";
const MARGEN_BUSQUEDA_MS = 5 * 60 * 1000;

type Admin = ReturnType<typeof createAdminClient>;

/** Un pago leído de la API, aplicado a su orden. Lo comparten webhook y conciliación. */
export async function aplicarPagoMp(
  admin: Admin,
  negocioId: string,
  ordenId: string,
  pago: PagoCheckout,
  origen: "MP_WEBHOOK" | "SISTEMA",
): Promise<{ ok: true; resultado: string } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc("aplicar_pago_mp_orden", {
    p_negocio: negocioId,
    p_orden: ordenId,
    p_origen: origen,
    p_pago: pagoParaLaBase(pago),
  });
  if (error) {
    console.error("[PAGO MP] aplicar", { ordenId, pago: String(pago.id), error: error.message });
    return { ok: false, error: error.message };
  }
  if (data !== "APLICADO" && data !== "DUPLICADO") {
    console.warn("[PAGO MP]", data, { ordenId, pago: String(pago.id), status: pago.status });
  }
  return { ok: true, resultado: data as string };
}

async function buscarPagos(token: string, params: Record<string, string>): Promise<unknown[] | null> {
  const query = new URLSearchParams({ sort: "date_created", criteria: "desc", limit: "100", ...params });
  const respuesta = await fetch(`${API_MP}/v1/payments/search?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  if (!respuesta.ok) {
    console.error("[CONCILIACION MP] search", respuesta.status);
    return null;
  }
  return ((await respuesta.json()) as { results?: unknown[] }).results ?? [];
}

async function registrar(
  admin: Admin,
  negocioId: string,
  ordenId: string,
  pago: { id: number | string; status?: string; transaction_amount?: number; currency_id?: string },
  extra: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await admin.rpc("_registrar_venta_orden_tienda", {
    p_negocio: negocioId,
    p_orden: ordenId,
    p_origen: "SISTEMA",
    p_usuario: null,
    p_pago: {
      mp_payment_id: String(pago.id),
      clave: `mp:${pago.id}:approved`,
      estado_mp: pago.status,
      monto: pago.transaction_amount,
      moneda: pago.currency_id,
      ...extra,
    },
  });
  if (error) {
    console.error("[CONCILIACION MP] registrar", { ordenId, error: error.message });
    return false;
  }
  return true;
}

export async function conciliarPagosNegocio(negocioId: string): Promise<number> {
  try {
    const admin = createAdminClient();

    const { data: turno } = await admin.rpc("tomar_turno_conciliacion_mp", {
      p_negocio: negocioId,
      p_segundos: 30,
    });
    if (!turno) return 0;

    const { data: pendientes } = await admin
      .from("ordenes_tienda")
      .select("id, medio, estado, total, creado_en, vence_en, mp_preference_id, mp_payment_id")
      .eq("negocio_id", negocioId)
      .in("estado", ["PENDIENTE_PAGO", "EN_PROCESO"])
      .is("stock_liberado_en", null);

    let registradas = 0;
    const token = pendientes?.length ? await tokenDelComercio(negocioId) : null;

    if (token && pendientes?.length) {
      // ─── 1. Checkout: por external_reference ───
      const deCheckout = pendientes.filter((o) => o.medio !== "TRANSFERENCIA" && o.mp_preference_id);
      for (const orden of deCheckout) {
        const pagos = await buscarPagos(token.accessToken, { external_reference: orden.id as string });
        if (!pagos) continue;
        const decide = pagoQueDecideLaOrden({
          ordenId: orden.id as string,
          total: Number(orden.total),
          estadoOrden: orden.estado as string,
          mpPaymentIdOrden: (orden.mp_payment_id as string | null) ?? null,
          pagos: pagos as PagoCheckout[],
          mpUserId: token.mpUserId,
        });
        if (!decide) continue;
        const r = await aplicarPagoMp(admin, negocioId, orden.id as string, decide, "SISTEMA");
        if (r.ok && r.resultado === "APLICADO" && decide.status === "approved") registradas++;
      }

      // ─── 2. Transferencias al alias: por monto y ventana ───
      const deTransferencia = pendientes.filter((o) => o.medio === "TRANSFERENCIA");
      if (deTransferencia.length) {
        const desde = new Date(
          Math.min(...deTransferencia.map((o) => new Date(o.creado_en as string).getTime())) - MARGEN_BUSQUEDA_MS,
        );
        const pagos = (await buscarPagos(token.accessToken, {
          range: "date_created",
          begin_date: desde.toISOString(),
          end_date: new Date().toISOString(),
        })) as PagoMp[] | null;

        if (pagos?.length) {
          const ids = pagos.map((p) => String(p.id));
          const { data: usados } = await admin
            .from("ordenes_tienda")
            .select("mp_payment_id")
            .eq("negocio_id", negocioId)
            .in("mp_payment_id", ids);

          const { coincidencias, ambiguas } = conciliarTransferencias({
            ordenes: deTransferencia.map((o) => ({
              id: o.id as string,
              total: Number(o.total),
              creadoEn: new Date(o.creado_en as string),
              venceEn: new Date(o.vence_en as string),
            })),
            pagos,
            mpUserId: token.mpUserId,
            pagosYaUsados: new Set((usados ?? []).map((u) => String(u.mp_payment_id))),
          });
          if (ambiguas > 0) console.warn("[CONCILIACION MP] ambiguas", { negocioId, ambiguas });

          for (const { ordenId, pago } of coincidencias) {
            const ok = await registrar(admin, negocioId, ordenId, pago, {
              // Solo la forma del pago: nada de quién pagó.
              resumen: {
                operation_type: pago.operation_type,
                payment_type_id: pago.payment_type_id,
                date_approved: pago.date_approved ?? null,
              },
            });
            if (ok) registradas++;
          }
        }
      }
    }

    // ─── 3. Recién ahora, vencer ───
    await admin.rpc("liberar_ordenes_tienda_vencidas", { p_negocio: negocioId });

    if (registradas) console.info("[CONCILIACION MP] registradas", { negocioId, registradas });
    return registradas;
  } catch (e) {
    console.error("[CONCILIACION MP]", (e as Error).message);
    return 0;
  }
}
