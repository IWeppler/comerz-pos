import "server-only";
import { headers } from "next/headers";
import { adminConfigurado, createAdminClient } from "@/shared/config/supabase/admin";
import { consultaDeCupo, ipDelPedido, type AccionAuth } from "./limites-auth";

/**
 * Efecto de `limites-auth.ts` contra `intentos_auth` (migración
 * `20261022200000`), con service_role: anon y authenticated no ven la tabla.
 *
 * FALLA ABIERTO: si la base no contesta (o la migración no está), se deja pasar
 * y se loguea. Dejar a todos los comercios sin poder entrar por un error del
 * contador es peor que un rato sin límite.
 */

async function consulta(accion: AccionAuth, email: string | null | undefined) {
  const h = await headers();
  return consultaDeCupo(accion, {
    ip: ipDelPedido(h.get("x-forwarded-for"), h.get("x-real-ip")),
    email,
  });
}

/**
 * ¿Puede intentarlo? Con `registrar`, además anota este intento (recuperar,
 * registro, verificación: cada pedido cuenta). El login NO registra acá: anota
 * solo los fallidos con `anotarIntentoFallido`.
 */
export async function hayCupoAuth(
  accion: AccionAuth,
  email: string | null | undefined,
  { registrar }: { registrar: boolean },
): Promise<boolean> {
  if (!adminConfigurado) return true;
  const c = await consulta(accion, email);
  if (!c) return true;

  const { data, error } = await createAdminClient().rpc("auth_cupo_disponible", {
    p_accion: accion,
    p_claves: c.claves,
    p_maximos: c.maximos,
    p_ventana_seg: c.ventanaSeg,
    p_registrar: registrar,
  });
  if (error) {
    console.error("[LIMITE AUTH] no se pudo consultar el cupo (se deja pasar)", {
      accion,
      motivo: error.message,
    });
    return true;
  }
  return data !== false;
}

export async function anotarIntentoFallido(
  accion: AccionAuth,
  email: string | null | undefined,
): Promise<void> {
  if (!adminConfigurado) return;
  const c = await consulta(accion, email);
  if (!c) return;

  const { error } = await createAdminClient().rpc("auth_registrar_intento", {
    p_accion: accion,
    p_claves: c.claves,
  });
  if (error) {
    console.error("[LIMITE AUTH] no se pudo anotar el intento", {
      accion,
      motivo: error.message,
    });
  }
}
