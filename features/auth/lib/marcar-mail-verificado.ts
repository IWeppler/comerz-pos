import "server-only";
import type { Session } from "@supabase/supabase-js";
import { adminConfigurado, createAdminClient } from "@/shared/config/supabase/admin";
import {
  MARCA_MAIL_VERIFICADO,
  metodoPruebaElMail,
} from "./verificacion-email";

/** Los métodos del claim `amr` del access token recién emitido. */
function metodosDeLaSesion(session: Session): string[] {
  try {
    const payload = JSON.parse(
      Buffer.from(session.access_token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { amr?: { method?: string }[] };
    return (payload.amr ?? []).map((a) => a.method ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Si la sesión se abrió con un link del correo (magic link de "Reenviar",
 * recuperación, invitación, confirmación), deja la marca de mail verificado.
 * Corre en `/auth/callback` y `/auth/confirm` después de un canje exitoso.
 *
 * Por qué una marca propia: con "Confirm email" apagado, ni
 * `email_confirmed_at` ni `email_verified` de la identidad cambian cuando una
 * cuenta ya "confirmada" abre un magic link — el banner no se iría nunca.
 *
 * Nunca voltea el login: un fallo se loguea y la persona entra igual (a lo
 * sumo sigue viendo el aviso).
 */
export async function marcarMailVerificadoSiLoProbo(session: Session): Promise<void> {
  if (session.user.app_metadata?.[MARCA_MAIL_VERIFICADO]) return;
  if (!metodoPruebaElMail(metodosDeLaSesion(session))) return;

  if (!adminConfigurado) {
    console.error("[MAIL VERIFICADO] sin service_role: no se pudo marcar", {
      usuarioId: session.user.id,
    });
    return;
  }

  const { error } = await createAdminClient().auth.admin.updateUserById(session.user.id, {
    // app_metadata se mezcla con lo que ya tiene (provider, providers).
    app_metadata: { [MARCA_MAIL_VERIFICADO]: new Date().toISOString() },
  });
  if (error) {
    console.error("[MAIL VERIFICADO] no se pudo marcar", {
      usuarioId: session.user.id,
      motivo: error.message,
    });
  }
}
