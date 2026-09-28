"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import type { AlertaCaja } from "../lib/alerta-caja";

/**
 * /caja → Auditoría (`20260928200000`). Toda la regla vive en la base:
 * `alertas_caja` arma las alertas, con permiso (`caja.ver_movimientos` o
 * `caja.ver_gerencial`) y filtro de negocio; acá solo se traducen errores.
 */

const MENSAJES: Record<string, string> = {
  SIN_PERMISO: "No tenés permiso para ver la auditoría de caja.",
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
  CLAVE_REQUERIDA: "No se encontró la alerta.",
};

function traducir(mensaje: string | undefined, porDefecto: string): string {
  const codigo = Object.keys(MENSAJES).find((c) => mensaje?.includes(c));
  return codigo ? MENSAJES[codigo] : porDefecto;
}

export async function getAlertasCajaAction(
  dias: number,
): Promise<{ data: AlertaCaja[] | null; error: string | null }> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("alertas_caja", { p_dias: dias });
  if (error) {
    console.error("Error cargando alertas de caja:", error);
    return { data: null, error: traducir(error.message, "No se pudieron cargar las alertas.") };
  }
  return {
    data: ((data ?? []) as AlertaCaja[]).map((a) => ({
      ...a,
      monto: a.monto === null ? null : Number(a.monto),
    })),
    error: null,
  };
}

export async function marcarAlertaRevisadaAction(
  clave: string,
  nota: string,
): Promise<{ error: string | null }> {
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("marcar_alerta_caja_revisada", {
    p_clave: clave,
    p_nota: nota.trim() || null,
  });
  if (error) {
    console.error("Error marcando alerta:", error);
    return { error: traducir(error.message, "No se pudo marcar la alerta.") };
  }
  revalidatePath("/caja");
  return { error: null };
}

export async function desmarcarAlertaRevisadaAction(
  clave: string,
): Promise<{ error: string | null }> {
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("desmarcar_alerta_caja_revisada", {
    p_clave: clave,
  });
  if (error) {
    console.error("Error desmarcando alerta:", error);
    return { error: traducir(error.message, "No se pudo volver a pendiente.") };
  }
  revalidatePath("/caja");
  return { error: null };
}

/** El número del aviso. Nunca falla: sin permiso o con error, 0. */
export async function getAlertasCajaPendientesAction(): Promise<number> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("alertas_caja_pendientes");
  if (error) return 0;
  return Number(data ?? 0);
}
