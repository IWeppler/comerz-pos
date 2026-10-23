"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { urlBaseDeLaRequest } from "@/shared/lib/url-base-request";
import { hayCupoAuth } from "@/shared/lib/limite-auth";
import { MENSAJE_DEMASIADOS_INTENTOS } from "@/shared/lib/limites-auth";

export interface EnvioVerificacionState {
  ok: boolean;
  mensaje: string;
}

/**
 * Manda (o vuelve a mandar) el mail para verificar el correo.
 *
 * Existe porque la verificación dejó de bloquear el alta: si no frena, tiene
 * que haber un botón para pedirla de nuevo — el mail se pierde, cae en spam, o
 * la persona se registra y recién a la semana se acuerda.
 *
 * El camino principal es un MAGIC LINK. Al abrirlo, `/auth/callback` (o
 * `/auth/confirm`, según el template) ve una sesión abierta por link del correo
 * y deja la marca `email_verificado_en` (ver `marcar-mail-verificado.ts`), que
 * es lo que apaga el banner.
 *
 * Hasta el 22/10/2026 se probaba primero `resend({ type: "signup" })`. Con
 * "Confirm email" apagado, Supabase da a TODA cuenta por confirmada y ese
 * reenvío contesta OK sin mandar nada: el botón decía "te lo mandamos" y no
 * salía ningún mail. Queda como segundo intento para el día que se prenda la
 * confirmación y el magic link de una cuenta sin confirmar falle.
 *
 * Con sesión, el destinatario es el mail de la SESIÓN, no el que manda el
 * navegador: el botón es para verificar la cuenta propia, no para mandarle
 * links a cualquier casilla registrada.
 */
export async function enviarVerificacionEmailAction(
  email: string,
): Promise<EnvioVerificacionState> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const destinatario = (user?.email ?? email)?.trim().toLowerCase();

  if (!destinatario) {
    return { ok: false, mensaje: "No sabemos a qué dirección mandarlo." };
  }

  // Cada pedido manda un mail. Ver `limites-auth.ts`.
  if (!(await hayCupoAuth("VERIFICACION", destinatario, { registrar: true }))) {
    return { ok: false, mensaje: MENSAJE_DEMASIADOS_INTENTOS };
  }

  const redirect = `${await urlBaseDeLaRequest()}/auth/callback?next=/`;

  const { error: errorOtp } = await supabase.auth.signInWithOtp({
    email: destinatario,
    options: {
      // NO crear la cuenta desde acá: este botón es para una que ya existe.
      // Con `true`, un mail mal tipeado daría de alta un usuario fantasma.
      shouldCreateUser: false,
      emailRedirectTo: redirect,
    },
  });

  if (!errorOtp) {
    return { ok: true, mensaje: "Listo, te mandamos el link de verificación." };
  }

  const { error: errorResend } = await supabase.auth.resend({
    type: "signup",
    email: destinatario,
    options: { emailRedirectTo: redirect },
  });

  if (!errorResend) {
    return { ok: true, mensaje: "Listo, te lo mandamos de nuevo." };
  }

  console.error("[VERIFICACION EMAIL]", { errorOtp, errorResend });

  // El error más frecuente acá no es un bug sino el límite de envíos del SMTP
  // de Supabase, y decir "esperá un minuto" es accionable; "algo salió mal",
  // no.
  const esRateLimit =
    /rate|limit|seconds|too many/i.test(errorOtp.message ?? "") ||
    /rate|limit|seconds|too many/i.test(errorResend.message ?? "");

  return {
    ok: false,
    mensaje: esRateLimit
      ? "Esperá un minuto antes de pedirlo otra vez."
      : "No pudimos mandarlo ahora. Probá de nuevo en un rato.",
  };
}
