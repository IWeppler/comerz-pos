"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import {
  normalizarNotificaciones,
  type CategoriaNotificacion,
  type ListaNotificaciones,
} from "@/features/notificaciones/lib/notificaciones";

/**
 * La campana (N4, docs/notificaciones.md). Todo pasa por las RPC de N1: las
 * tablas no tienen acceso directo, y el filtro por negocio, rol y
 * configuración vive en la base (`mis_notificaciones`), no acá.
 *
 * Fail-closed hacia el lado silencioso: si algo falla, la campana queda en
 * cero o vacía. Una campana rota no puede romper la pantalla que la rodea.
 */

/** El número del ícono. Liviana: no arma la lista ni borra nada. */
export async function getNotificacionesSinLeerAction(): Promise<number> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("notificaciones_sin_leer");
  if (error) {
    console.error("[NOTIFICACIONES] contador:", error.message);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

/** La lista entera, al abrir la campana. */
export async function getMisNotificacionesAction(): Promise<ListaNotificaciones> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("mis_notificaciones");
  if (error) {
    console.error("[NOTIFICACIONES] lista:", error.message);
    return normalizarNotificaciones(null);
  }
  return normalizarNotificaciones(data);
}

export async function marcarNotificacionesLeidasAction(claves: string[]): Promise<boolean> {
  if (claves.length === 0) return true;
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("marcar_notificaciones_leidas", {
    p_claves: claves.slice(0, 200),
  });
  if (error) console.error("[NOTIFICACIONES] marcar leídas:", error.message);
  return !error;
}

/** "Limpiar leídas": las oculta para este usuario (vuelven si cambian). */
export async function limpiarNotificacionesLeidasAction(): Promise<boolean> {
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("limpiar_notificaciones_leidas");
  if (error) console.error("[NOTIFICACIONES] limpiar:", error.message);
  return !error;
}

// ─── N6: Configuración › Notificaciones (solo ADMIN; lo exige la base) ───────

export type RolAviso = "ADMIN" | "ENCARGADO";
export type MatrizRoles = Record<CategoriaNotificacion, Record<RolAviso, boolean>>;

const CATEGORIAS_CONFIG: CategoriaNotificacion[] = ["STOCK", "TIENDA", "PLAN", "PLATA"];

/** La matriz tal como se aplica hoy (defaults incluidos). null si no se pudo leer. */
export async function getRolesNotificacionesAction(): Promise<MatrizRoles | null> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("notificaciones_roles_efectivos");
  if (error || !data) {
    console.error("[NOTIFICACIONES] roles:", error?.message);
    return null;
  }
  const crudo = data as Record<string, Record<string, unknown>>;
  return Object.fromEntries(
    CATEGORIAS_CONFIG.map((c) => [
      c,
      { ADMIN: crudo[c]?.ADMIN === true, ENCARGADO: crudo[c]?.ENCARGADO === true },
    ]),
  ) as MatrizRoles;
}

export async function guardarRolesNotificacionesAction(matriz: MatrizRoles): Promise<{ ok: boolean }> {
  // Las cuatro categorías siempre: la base rechaza una forma incompleta.
  const roles = Object.fromEntries(
    CATEGORIAS_CONFIG.map((c) => [
      c,
      (["ADMIN", "ENCARGADO"] as RolAviso[]).filter((r) => matriz[c]?.[r] === true),
    ]),
  );
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("guardar_notificaciones_roles", { p_roles: roles });
  if (error) console.error("[NOTIFICACIONES] guardar roles:", error.message);
  return { ok: !error };
}
