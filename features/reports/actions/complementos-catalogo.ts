"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import type { AnalisisComplementos } from "../lib/complementos-catalogo";

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
