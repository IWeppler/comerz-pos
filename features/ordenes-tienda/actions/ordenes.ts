"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";

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
