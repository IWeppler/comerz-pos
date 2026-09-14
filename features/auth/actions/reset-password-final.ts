"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import {
  COOKIE_NEGOCIO_ACTIVO,
  COOKIE_NEGOCIO_MAX_AGE,
} from "@/shared/lib/negocio-activo";
import { refrescarClaimDeMembresias } from "../lib/refrescar-claim";

export interface UpdatePasswordState {
  error: string;
  success: boolean;
  /** Solo cuando vino de una invitación: a dónde mandarla después. */
  destino?: string;
}

export async function resetPasswordFinalAction(
  prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirm_password") as string;
  // Viene del link del mail de invitación. Si está, además de la contraseña
  // hay que sumar a la persona al negocio que la invitó.
  const invitacion = (formData.get("invitacion") as string) || null;

  if (!password || !confirmPassword) {
    return { error: "Todos los campos son obligatorios.", success: false };
  }

  if (password !== confirmPassword) {
    return { error: "Las contraseñas no coinciden.", success: false };
  }

  if (password.length < 6) {
    return {
      error: "La contraseña debe tener al menos 6 caracteres.",
      success: false,
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase.auth.updateUser({
    password: password,
  });

  if (error) {
    console.error("Error al actualizar la contraseña:", error);
    return {
      error: "Hubo un problema al actualizar la contraseña.",
      success: false,
    };
  }

  // La invitación se acepta por dos vías, y la segunda es la que importa:
  //
  //  1. Por token, si vino `?invitacion=` en la URL (el link del mail).
  //  2. Por EMAIL: toda invitación PENDIENTE del mail de esta sesión. Cubre al
  //     que llegó sin el parámetro —link viejo con la sesión en el hash,
  //     template sin `next`, un "olvidé mi contraseña" en el medio— y es lo
  //     que hace que el invitado no termine en /onboarding creando un negocio
  //     propio. El mail verificado por Auth es la credencial; el token nunca
  //     lo fue (`aceptar_invitacion` ya exigía que coincidieran).
  let negocioId: string | null = null;

  if (invitacion) {
    const { data, error: errorInvitacion } = await supabase.rpc(
      "aceptar_invitacion",
      { p_token: invitacion },
    );
    if (errorInvitacion) {
      // No se corta: la vía por email de abajo puede resolverlo igual (el
      // token puede ser de una invitación que ya se aceptó, o de otra).
      console.error("[ACEPTAR INVITACION AL CREAR PASSWORD]", errorInvitacion);
    } else {
      negocioId = (data as string | null) ?? null;
    }
  }

  if (!negocioId) {
    const { data, error: errorPendientes } = await supabase.rpc(
      "aceptar_invitaciones_pendientes",
    );
    if (errorPendientes) {
      console.error("[ACEPTAR INVITACIONES PENDIENTES]", errorPendientes);
    } else {
      negocioId = (data as string | null) ?? null;
    }
  }

  if (negocioId) {
    cookieStore.set(COOKIE_NEGOCIO_ACTIVO, negocioId, {
      path: "/",
      maxAge: COOKIE_NEGOCIO_MAX_AGE,
      sameSite: "lax",
      httpOnly: false,
    });

    // El claim del token todavía dice "sin negocio": sin esto el middleware
    // rebota a /pos contra el selector hasta que el token se renueve solo.
    await refrescarClaimDeMembresias(supabase, "aceptar invitación (password)");

    return { error: "", success: true, destino: "/pos" };
  }

  if (invitacion) {
    // Había un token y ninguna de las dos vías lo aceptó: hay que decirlo.
    return {
      error:
        "Tu contraseña quedó guardada, pero la invitación no se pudo aceptar (puede estar vencida). Pedile a tu encargada que te invite de nuevo.",
      success: false,
    };
  }

  return { error: "", success: true };
}
