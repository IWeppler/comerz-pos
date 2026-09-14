import { type EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { destinoSeguroDesdeRedirect } from "@/features/auth/lib/destino-callback";

/**
 * Canje SERVER-SIDE de un link de mail (`token_hash` + `type`): invitación,
 * recuperación de contraseña, cambio de mail.
 *
 * POR QUÉ ESTA RUTA Y NO `{{ .ConfirmationURL }}`. Con ConfirmationURL,
 * GoTrue verifica el token y redirige al `redirect_to` con la sesión en el
 * HASH de la URL (`#access_token=…&type=invite`; verificado el 14/9/2026
 * siguiendo un invite real). El hash no llega al servidor, y
 * `/auth/actualizar-password` no monta ningún cliente de Supabase de
 * navegador que lo lea — así que la sesión no llegaba a las cookies,
 * `updateUser` fallaba y el invitado terminaba registrándose solo en
 * /onboarding. Acá `verifyOtp` escribe las cookies en la respuesta, y la
 * página siguiente ya tiene sesión de verdad.
 *
 * El template de mail tiene que apuntar acá:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next={{ .RedirectTo }}
 *
 * `next` lo escribe el mail, o sea cualquiera: se filtra con
 * `destinoSeguroDesdeRedirect`, que acepta paths y URLs absolutas del PROPIO
 * origen (así llega `{{ .RedirectTo }}`) y descarta el resto. Antes iba
 * directo a `new URL(next, request.url)`, que era un redirect abierto.
 */
const DESTINO_POR_DEFECTO = "/auth/actualizar-password";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const destino = destinoSeguroDesdeRedirect(
    searchParams.get("next"),
    origin,
    DESTINO_POR_DEFECTO,
  );

  if (token_hash && type) {
    const supabase = createClient(await cookies());
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      return NextResponse.redirect(`${origin}${destino}`);
    }

    console.error("[AUTH CONFIRM] canje fallido", {
      type,
      motivo: error.message,
      status: error.status,
    });
  }

  return NextResponse.redirect(
    `${origin}/auth?error=${encodeURIComponent("Enlace expirado o inválido")}`,
  );
}
