"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { COOKIE_NEGOCIO_ACTIVO } from "@/shared/lib/negocio-activo";
import { urlBaseDeLaRequest } from "@/shared/lib/url-base-request";
import { enviarVerificacionEmailAction } from "./verificacion-email";

export interface RegistroState {
  error: string;
  success?: boolean;
  /** A dónde mandarlo. Vacío = quedarse en la pantalla y leer `aviso`. */
  destino?: string;
  /** Mensaje cuando NO hay sesión inmediata (confirmación por email prendida). */
  aviso?: string;
  /** A qué dirección se mandó, para ofrecer el reenvío sin volver a pedirla. */
  email?: string;
}

/**
 * Alta de cuenta propia. La puerta del onboarding self-service.
 *
 * Hasta acá no existía: el modo "registro" del panel escribía en
 * `solicitudes_comercio` —datos de contacto, sin cuenta— y Comerz contestaba
 * por WhatsApp. Ahora el usuario crea su cuenta y sigue solo hasta adentro.
 *
 * Lo que este action NO hace: crear el negocio. Eso son los pasos 2 y 3 del
 * stepper, y van separados porque la RPC de alta necesita una sesión — la
 * cuenta tiene que existir antes. Si alguien abandona en el medio queda con
 * cuenta y sin negocio, que es un estado válido: el login y el middleware lo
 * devuelven a /onboarding y retoma en el paso 2.
 */
export async function registrarseAction(
  prevState: RegistroState,
  formData: FormData,
): Promise<RegistroState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const nombre = String(formData.get("nombre") ?? "").trim();

  if (!email || !password || !nombre) {
    return { error: "Completá tu nombre, email y contraseña." };
  }

  // Mismo piso que pide Supabase por defecto. Se valida acá para dar un
  // mensaje en castellano en vez del error crudo del proveedor.
  if (password.length < 6) {
    return { error: "La contraseña necesita al menos 6 caracteres." };
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: "Revisá el email." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nombre },
      // A dónde vuelve después de confirmar. Sale del host REAL del request y
      // no de una constante de build: probando en localhost, el mail tiene que
      // volver a localhost, no a producción.
      //
      // OJO: si esta URL no está en la lista de Redirect URLs de Supabase, el
      // servidor la ignora EN SILENCIO y usa el "Site URL" del proyecto. Eso es
      // lo que hacía que el mail llevara a localhost:3000 aunque acá se mandara
      // otra cosa. Las dos puntas tienen que estar permitidas allá.
      //
      // Va a /auth/callback y no directo a /onboarding porque el link llega en
      // formato PKCE: lo que aterriza es un `code`, no una sesión, y alguien
      // tiene que canjearlo.
      emailRedirectTo: `${await urlBaseDeLaRequest()}/auth/callback?next=/onboarding`,
    },
  });

  if (error) {
    console.error("[REGISTRO]", error);
    // Supabase responde lo mismo para "ya existe" que para otros errores según
    // la config de privacidad, así que no se afirma cuál fue.
    return {
      error:
        "No pudimos crear la cuenta. Puede que ya exista una con ese email — probá entrar o recuperar la contraseña.",
    };
  }

  // Sin sesión = el proyecto tiene la confirmación por email prendida. No es un
  // error: es el otro camino válido, y hay que decirlo en vez de dejar la
  // pantalla como si no hubiera pasado nada.
  if (!data.session) {
    return {
      error: "",
      success: true,
      email,
      aviso:
        "Te mandamos un mail para confirmar la cuenta. Abrilo y volvé para terminar de crear tu comercio.",
    };
  }

  // Cuenta nueva: no pertenece a ningún negocio todavía. Se limpia por las
  // dudas una cookie de negocio de una sesión anterior en el mismo navegador —
  // apuntaría a un negocio que este usuario no integra.
  cookieStore.delete(COOKIE_NEGOCIO_ACTIVO);

  // Hay sesión, o sea que el proyecto NO exige confirmar para entrar. El mail
  // de verificación se manda igual, pero como aviso y no como puerta: la
  // persona sigue derecho al paso 2 y la deuda queda a la vista en el panel
  // (ver `estadoVerificacionEmail`). Es el paso que hacía perder altas —
  // obligaba a irse a la casilla justo cuando todavía no vio nada del
  // producto.
  //
  // Un fallo del envío NO puede voltear un alta que ya está hecha: se loguea y
  // el usuario tiene el botón de reenviar en el banner.
  if (!data.user?.email_confirmed_at) {
    const envio = await enviarVerificacionEmailAction(email);
    if (!envio.ok) {
      console.error("[REGISTRO] verificación no enviada", envio.mensaje);
    }
  }

  return { error: "", success: true, destino: "/onboarding" };
}

/**
 * Qué hacer con una cuenta que no pertenece a ningún negocio.
 *
 * Con el alta self-service abierta, "sin negocio" dejó de significar una sola
 * cosa. Hay dos personas distintas en ese estado y mandarlas al mismo lugar
 * deja a una de las dos golpeando una puerta cerrada:
 *
 *   - Alguien que se registró para abrir SU comercio y todavía no lo creó
 *     (o abandonó a mitad). Tiene que poder seguir: /onboarding.
 *   - Un empleado invitado que entró antes de usar el link de la invitación.
 *     Crear un negocio propio sería exactamente lo que NO quiere hacer.
 *
 * Se distinguen por la invitación pendiente, que es el único rastro que dejó
 * quien lo invitó.
 */
export async function destinoSinNegocio(
  supabase: ReturnType<typeof createClient>,
  email: string | undefined,
): Promise<{ destino: string; error: string; negocioId: string | null }> {
  if (!email) return { destino: "/onboarding", error: "", negocioId: null };

  // La invitación pendiente se ACEPTA acá mismo, no se le pide que vuelva al
  // mail. El link del mail estuvo roto hasta el 14/9/2026 (la sesión llegaba
  // en el hash y nadie la leía), y aun arreglado, mandar a alguien logueado
  // a buscar un link es la puerta cerrada que este helper existe para evitar.
  // El mail verificado de la sesión es la credencial: `aceptar_invitaciones_
  // pendientes` solo toca invitaciones dirigidas a ese mail.
  const { data: negocioId, error } = await supabase.rpc(
    "aceptar_invitaciones_pendientes",
  );

  if (error) {
    console.error("[ACEPTAR INVITACIONES PENDIENTES]", error);
    return {
      destino: "",
      error:
        "Tenés una invitación pendiente pero no se pudo aceptar. Probá de nuevo en un rato o pedile a tu encargada que te invite otra vez.",
      negocioId: null,
    };
  }

  if (negocioId) {
    return { destino: "/", error: "", negocioId: negocioId as string };
  }

  return { destino: "/onboarding", error: "", negocioId: null };
}
