"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { esIconoNovedad, type IconoNovedad } from "@/features/notificaciones/lib/texto-novedad";

/**
 * El editor de Novedades (N5) de /admincomerz/novedades. Todo por RPC: las
 * tablas no tienen acceso directo y cada función exige super admin EN LA BASE
 * (`security.is_super_admin()`); acá se valida el formato, no el permiso.
 */

export type NovedadAdmin = {
  id: string;
  titulo: string;
  icono: IconoNovedad;
  cuerpo: string;
  publicadaEn: string | null;
  creadoEn: string;
  actualizadoEn: string;
  vistas: number;
};

export async function listarNovedadesAdminAction(): Promise<NovedadAdmin[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("novedades_admin");
  if (error) {
    console.error("[NOVEDADES] listar:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((n) => ({
    id: String(n.id),
    titulo: String(n.titulo ?? ""),
    icono: esIconoNovedad(n.icono) ? n.icono : "sparkles",
    cuerpo: String(n.cuerpo ?? ""),
    publicadaEn: typeof n.publicada_en === "string" ? n.publicada_en : null,
    creadoEn: String(n.creado_en ?? ""),
    actualizadoEn: String(n.actualizado_en ?? ""),
    vistas: Number(n.vistas ?? 0),
  }));
}

type Resultado = { ok: true; id: string } | { ok: false; error: string };

export async function guardarNovedadAction(input: {
  id: string | null;
  titulo: string;
  icono: string;
  cuerpo: string;
  publicar: boolean;
}): Promise<Resultado> {
  const titulo = input.titulo.trim();
  if (titulo.length < 1 || titulo.length > 120) return { ok: false, error: "El título va de 1 a 120 caracteres." };
  if (!esIconoNovedad(input.icono)) return { ok: false, error: "Elegí un ícono de la lista." };
  if (input.cuerpo.length > 4000) return { ok: false, error: "El texto no puede pasar los 4.000 caracteres." };

  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("guardar_novedad", {
    p_id: input.id,
    p_titulo: titulo,
    p_icono: input.icono,
    p_cuerpo: input.cuerpo,
    p_publicar: input.publicar,
  });
  if (error || typeof data !== "string") {
    console.error("[NOVEDADES] guardar:", error?.message);
    return { ok: false, error: error?.message.includes("SIN_PERMISO") ? "No tenés permiso." : "No se pudo guardar." };
  }
  revalidatePath("/admincomerz/novedades");
  return { ok: true, id: data };
}

export async function eliminarNovedadAction(id: string): Promise<{ ok: boolean }> {
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("eliminar_novedad", { p_id: id });
  if (error) console.error("[NOVEDADES] eliminar:", error.message);
  revalidatePath("/admincomerz/novedades");
  return { ok: !error };
}
