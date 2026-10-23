import "server-only";
import { randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { createClient } from "@/shared/config/supabase/server";
import { adminConfigurado, createAdminClient } from "@/shared/config/supabase/admin";
import {
  MARCA_CREDENCIAL_ANULADA,
  debeAnularCredencialPrevia,
} from "./credencial-previa";

/**
 * Efecto de `debeAnularCredencialPrevia`: corre en `/auth/callback` después de
 * un canje exitoso. Si la cuenta en la que acaba de entrar alguien con Google
 * trae una contraseña de un mail nunca verificado, la reemplaza por una
 * aleatoria (service_role) y cierra las demás sesiones: quien registró el mail
 * ajeno queda afuera, y esta sesión —la del dueño, probado por Google— sigue.
 *
 * Nunca voltea el login: un fallo se loguea fuerte y la persona entra igual.
 * Devuelve si anuló algo, para el log.
 */
export async function anularCredencialPreviaSiHaceFalta(
  supabase: ReturnType<typeof createClient>,
  usuario: User,
): Promise<boolean> {
  if (!debeAnularCredencialPrevia(usuario)) return false;

  if (!adminConfigurado) {
    console.error("[CREDENCIAL PREVIA] sin service_role: no se pudo anular", {
      usuarioId: usuario.id,
    });
    return false;
  }

  const { error: errorClave } = await createAdminClient().auth.admin.updateUserById(
    usuario.id,
    {
      // Nadie la conoce ni la va a usar: el dueño entra con Google o recupera.
      password: randomBytes(32).toString("base64url"),
      // app_metadata se mezcla con lo que ya tiene (provider, providers).
      app_metadata: { [MARCA_CREDENCIAL_ANULADA]: new Date().toISOString() },
    },
  );
  if (errorClave) {
    console.error("[CREDENCIAL PREVIA] no se pudo anular la contraseña", {
      usuarioId: usuario.id,
      motivo: errorClave.message,
    });
    return false;
  }

  // Las sesiones abiertas con la clave vieja siguen vivas por su refresh token
  // hasta que se las cierra. `others`: esta, la de Google, queda.
  const { error: errorSesiones } = await supabase.auth.signOut({ scope: "others" });
  if (errorSesiones) {
    console.error("[CREDENCIAL PREVIA] contraseña anulada pero quedaron sesiones", {
      usuarioId: usuario.id,
      motivo: errorSesiones.message,
    });
  }

  console.warn("[CREDENCIAL PREVIA] contraseña previa anulada al vincular Google", {
    usuarioId: usuario.id,
  });
  return true;
}
