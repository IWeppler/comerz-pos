"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { seleccionarAsociaciones, type AnalisisComplementos } from "../lib/complementos-catalogo";

export async function getComplementosCatalogoAction(): Promise<{ data: AnalisisComplementos | null; error: string | null }> {
  const db = createClient(await cookies());
  const { data, error } = await db.rpc("analisis_complementos_catalogo");
  if (error) {
    if (error.code === "42501") return { data: null, error: null };
    console.error("[INTELLIGENCE] analisis_complementos_catalogo:", error.message);
    return { data: null, error: "No pudimos cargar las asociaciones. Intentá de nuevo." };
  }
  return { data: data as AnalisisComplementos | null, error: null };
}

export async function configurarComplementoAction(a: string, b: string, activo: boolean): Promise<{ error: string | null }> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(a) || !uuid.test(b) || a === b || typeof activo !== "boolean") return { error: "Elegí dos productos distintos." };
  const db = createClient(await cookies());
  const { data, error } = await db.rpc("configurar_complemento_catalogo", { p_producto_a: a, p_producto_b: b, p_activo: activo });
  if (error || data !== activo) return { error: error?.code === "42501" ? "Solo un administrador puede cambiar estas asociaciones." : "No pudimos guardar la asociación. Intentá de nuevo." };
  revalidatePath("/");
  revalidatePath("/reportes");
  return { error: null };
}

/** La asociación sugerida más fuerte (no activada), para una fila de
 * "Requiere tu atención". Usa la misma selección que la lista de asociaciones,
 * así el aviso y la lista nunca se contradicen. */
export type AsociacionSugerida = {
  producto_a: string;
  producto_b: string;
  producto_a_id: string;
  producto_b_id: string;
  ventas_juntas: number;
};

/** Solo para ADMIN: quien no puede activar nada no ve la fila. */
export async function getAsociacionSugeridaAction(): Promise<AsociacionSugerida | null> {
  const { data } = await getComplementosCatalogoAction();
  if (!data || !data.puede_editar) return null;
  const sugerida = seleccionarAsociaciones(data.pares).find((p) => !p.activo);
  return sugerida
    ? {
        producto_a: sugerida.producto_a,
        producto_b: sugerida.producto_b,
        producto_a_id: sugerida.producto_a_id,
        producto_b_id: sugerida.producto_b_id,
        ventas_juntas: sugerida.ventas_juntas,
      }
    : null;
}
