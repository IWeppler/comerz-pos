"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { getRenglonesImeiPendienteAction } from "@/features/sales/actions/imei-pendiente";

/**
 * Acciones del comercio sobre una orden de la tienda.
 *
 * Van por RPC con la SESIÓN: el negocio sale de `current_negocio_id()` y el
 * permiso (`ventas.cobrar`) lo exige la base, no esta action. Un server action
 * es un endpoint; esconder el botón no alcanza.
 */

type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

const ERRORES: Record<string, string> = {
  SIN_PERMISO: "No tenés permiso para cobrar ventas.",
  SIN_NEGOCIO_ACTIVO: "Tu sesión no tiene un comercio activo. Recargá la página.",
  ORDEN_NO_ENCONTRADA: "No encontramos esa orden.",
  NO_ES_TRANSFERENCIA: "Esa orden no es por transferencia.",
  IMEI_FALTANTES: "Falta el IMEI de algún aparato.",
  IMEI_REPETIDO: "Pusiste el mismo IMEI en dos aparatos.",
  IMEI_DE_MAS: "Hay más IMEI que aparatos en la orden. Recargá la página.",
  UNIDADES_INVALIDAS: "No se pudieron leer los IMEI. Probá de nuevo.",
  ORDEN_NO_COBRABLE:
    "Esa orden ya no se puede cobrar (venció o se canceló) y su stock volvió a la venta. Si la clienta pagó igual, cobrala desde Vender.",
};

const traducir = (mensaje: string | undefined) =>
  ERRORES[mensaje?.trim() ?? ""] ?? "No se pudo completar. Probá de nuevo.";

export async function confirmarTransferenciaAction(ordenId: string): Promise<Resultado> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("confirmar_transferencia_orden", { p_orden: ordenId });
  if (error) {
    if (!ERRORES[error.message?.trim()]) console.error("[ORDENES] confirmar", error.code, error.message);
    return { ok: false, error: traducir(error.message) };
  }
  revalidatePath("/ordenes");
  const yaEstaba = (data as { ya_registrada?: boolean } | null)?.ya_registrada;
  return {
    ok: true,
    mensaje: yaEstaba ? "Esa orden ya estaba cobrada." : "¡Listo! La venta quedó registrada.",
  };
}

export async function cancelarOrdenAction(ordenId: string): Promise<Resultado> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("cancelar_orden_tienda", { p_orden: ordenId });
  if (error) {
    if (!ERRORES[error.message?.trim()]) console.error("[ORDENES] cancelar", error.code, error.message);
    return { ok: false, error: traducir(error.message) };
  }
  revalidatePath("/ordenes");
  return data
    ? { ok: true, mensaje: "Orden cancelada. Los productos volvieron a la venta." }
    : { ok: false, error: "Esa orden ya no está pendiente: no hay nada que cancelar." };
}

export interface AparatoAEntregar {
  itemId: string;
  nombre: string;
  variante: string | null;
  /** IMEI de esa variante que están en stock, para elegir con un toque. */
  disponibles: string[];
}

/**
 * Los aparatos de una orden pagada que todavía no tienen IMEI (productos que
 * llevan IMEI, un renglón por aparato). Vacío = se entrega sin pedir nada.
 * Mismo criterio que el historial (`getRenglonesImeiPendienteAction`).
 */
export async function aparatosAEntregarAction(
  ordenId: string,
): Promise<{ ok: true; aparatos: AparatoAEntregar[] } | { ok: false; error: string }> {
  const supabase = createClient(await cookies());
  const { data: orden } = await supabase
    .from("ordenes_tienda")
    .select("venta_id")
    .eq("id", ordenId)
    .maybeSingle();
  if (!orden?.venta_id) return { ok: true, aparatos: [] };

  const pendientes = await getRenglonesImeiPendienteAction(orden.venta_id as string);
  if (pendientes.error) return { ok: false, error: pendientes.error };
  if (pendientes.itemIds.length === 0) return { ok: true, aparatos: [] };

  const { data: renglones, error } = await supabase
    .from("ventas_items")
    .select("id, variante, variante_id, producto:productos(nombre)")
    .in("id", pendientes.itemIds)
    .order("id");
  if (error) return { ok: false, error: "No se pudieron leer los aparatos de la orden." };

  const varianteIds = [...new Set((renglones ?? []).map((r) => r.variante_id as string))];
  const { data: unidades } = await supabase
    .from("unidades_serie")
    .select("imei, producto_variante_id")
    .in("producto_variante_id", varianteIds)
    .eq("estado", "disponible")
    .order("fecha_ingreso", { ascending: true })
    .limit(200);

  return {
    ok: true,
    aparatos: (renglones ?? []).map((r) => {
      const producto = (Array.isArray(r.producto) ? r.producto[0] : r.producto) as { nombre?: string } | null;
      return {
        itemId: r.id as string,
        nombre: producto?.nombre ?? "Aparato",
        variante: (r.variante as string | null) ?? null,
        disponibles: (unidades ?? [])
          .filter((u) => u.producto_variante_id === r.variante_id)
          .map((u) => u.imei as string),
      };
    }),
  };
}

/**
 * PAGADA ↔ ENTREGADA. No toca venta, plata ni stock: por eso se deshace desde
 * el aviso en vez de pedir confirmación. Al entregar, los aparatos que llevan
 * IMEI lo reciben en la MISMA transacción (`marcar_orden_entregada`).
 */
export async function marcarEntregadaAction(
  ordenId: string,
  entregada: boolean,
  unidades: { itemId: string; imei: string }[] = [],
): Promise<Resultado> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("marcar_orden_entregada", {
    p_orden: ordenId,
    p_entregada: entregada,
    p_unidades: unidades.map((u) => ({ item_id: u.itemId, imei: u.imei })),
  });
  if (error) {
    if (error.message?.trim() === "IMEI_NO_DISPONIBLE") {
      return {
        ok: false,
        error: `El IMEI ${error.details ?? ""} ya está vendido o es de otro modelo. Revisá el aparato.`,
      };
    }
    if (!ERRORES[error.message?.trim()]) console.error("[ORDENES] entregar", error.code, error.message);
    return { ok: false, error: traducir(error.message) };
  }
  revalidatePath("/ordenes");
  if (!data) {
    return {
      ok: false,
      error: entregada ? "Esa orden ya no está pagada y sin entregar." : "Esa orden ya no estaba marcada como entregada.",
    };
  }
  return { ok: true, mensaje: entregada ? "Orden entregada." : "La orden volvió a «Para entregar»." };
}
