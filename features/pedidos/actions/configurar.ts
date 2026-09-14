"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";

/**
 * Prende o apaga "Enviar pedidos a la caja". La RPC hace las dos cosas en
 * una transacción: la config y el permiso `ventas.cobrar` del rol VENDEDOR
 * (se lo saca al prender, se lo devuelve al apagar). Ver la migración
 * 20260915130000 para el porqué de hacerlo junto.
 */
export async function configurarPedidosACajaAction(
  activo: boolean,
): Promise<{ success: boolean; error: string | null }> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase.rpc("configurar_pedidos_a_caja", {
    p_activo: activo,
  });

  if (error) {
    const m = error.message ?? "";
    if (m.includes("FEATURE_NO_INCLUIDA")) {
      return { success: false, error: "Tu plan no incluye pedidos a caja." };
    }
    if (m.includes("SIN_PERMISO") || error.code === "42501") {
      return { success: false, error: "Solo un administrador puede cambiar esto." };
    }
    console.error("[PEDIDOS] No se pudo configurar pedidos a caja:", error);
    return { success: false, error: "No se pudo guardar el cambio." };
  }

  revalidatePath("/configuracion");
  revalidatePath("/pos");
  return { success: true, error: null };
}
