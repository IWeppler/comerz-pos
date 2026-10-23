"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { urlBaseDeLaRequest } from "@/shared/lib/url-base-request";
import { hayCupoAuth } from "@/shared/lib/limite-auth";
import { MENSAJE_DEMASIADOS_INTENTOS } from "@/shared/lib/limites-auth";

export interface ResetPasswordState {
  error: string;
  success: boolean;
}

export async function resetPasswordAction(
  prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const email = formData.get("email") as string;

  if (!email) {
    return { error: "Por favor, ingresá un correo válido.", success: false };
  }

  // Cada pedido manda un mail: tope por IP y por mail. Ver `limites-auth.ts`.
  if (!(await hayCupoAuth("RECUPERAR", email, { registrar: true }))) {
    return { error: MENSAJE_DEMASIADOS_INTENTOS, success: false };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Del host REAL del request, no de NEXT_PUBLIC_SITE_URL: esa es una constante
  // de build que apunta a producción, así que probando en localhost el mail de
  // recuperación mandaba a app.comerz.app. Mismo criterio que el alta.
  const originUrl = await urlBaseDeLaRequest();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Redirigimos a la vista donde el usuario escribirá la NUEVA contraseña.
    // Si esta URL no está en las Redirect URLs de Supabase, el servidor la
    // ignora sin avisar y usa el Site URL del proyecto.
    redirectTo: `${originUrl}/auth/actualizar-password`,
  });

  if (error) {
    console.error("Error al enviar email de recuperación:", error);
    return { 
      error: "No pudimos enviar el correo. Verificá que la dirección sea correcta.", 
      success: false 
    };
  }

  return { error: "", success: true };
}