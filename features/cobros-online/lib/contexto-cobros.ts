import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/shared/config/supabase/server";

/**
 * La puerta de todo lo de Cobros online del PANEL (actions y rutas de OAuth).
 *
 * Tres chequeos, contra la BASE y no contra lo que dice el navegador:
 *   1. hay usuario;
 *   2. es ADMIN del negocio activo (`is_admin()`): configurar cobros y conectar
 *      una cuenta donde entra plata es del dueño, igual que escribir
 *      `configuracion_pos` (su policy de UPDATE pide lo mismo);
 *   3. el módulo está prendido para ese negocio
 *      (`negocios.pagos_online_habilitado`, lo prende solo el super admin).
 *
 * El negocio sale de `negocio_actual()`, que valida la membresía: la cookie
 * no es credencial.
 */

export type ErrorContexto = "sin_sesion" | "sin_permiso" | "modulo_apagado";

export type ContextoCobros =
  | { ok: true; supabase: SupabaseClient; usuarioId: string; negocioId: string }
  | { ok: false; error: ErrorContexto };

export async function contextoCobros(): Promise<ContextoCobros> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "sin_sesion" };

  const [{ data: esAdmin }, { data: negocioId }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("negocio_actual"),
  ]);
  if (!esAdmin || !negocioId) return { ok: false, error: "sin_permiso" };

  const { data: negocio } = await supabase
    .from("negocios")
    .select("pagos_online_habilitado")
    .eq("id", negocioId as string)
    .maybeSingle();
  // Fail-closed: sin dato, apagado.
  if (negocio?.pagos_online_habilitado !== true) return { ok: false, error: "modulo_apagado" };

  return { ok: true, supabase, usuarioId: user.id, negocioId: negocioId as string };
}

export const MENSAJE_CONTEXTO: Record<ErrorContexto, string> = {
  sin_sesion: "Tu sesión venció. Volvé a entrar.",
  sin_permiso: "Solo un administrador del comercio puede configurar los cobros online.",
  modulo_apagado: "Los cobros online no están activados para tu comercio.",
};
