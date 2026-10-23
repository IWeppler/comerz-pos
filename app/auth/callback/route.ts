import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { destinoSeguro } from "@/features/auth/lib/destino-callback";
import { anularCredencialPreviaSiHaceFalta } from "@/features/auth/lib/anular-credencial-previa";
import { marcarMailVerificadoSiLoProbo } from "@/features/auth/lib/marcar-mail-verificado";

/**
 * Canje del `code` de PKCE por una sesión.
 *
 * Es el otro flujo de mails de Supabase Auth: `/auth/confirm` entiende
 * `token_hash` + `verifyOtp`, que es el formato de la invitación de empleados,
 * pero el mail de confirmación de alta llega como PKCE
 * —`.../auth/v1/verify?token=pkce_...&redirect_to=X`— y ahí Supabase verifica
 * de su lado y redirige a `X?code=...`. Ese `code` no es una sesión: hay que
 * cambiarlo por una.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NUNCA MANDA A UNA PANTALLA DE ERROR
 *
 * Este handler SE EJECUTA DOS VECES con el mismo `code`. Medido en producción
 * el 9/9/2026, en una alta de prueba:
 *
 *   11:57:46  GET  /auth/v1/verify  303  (el click en el mail)
 *   11:57:48  POST /auth/v1/token   200  ← primer canje, sesión creada
 *   11:57:49  POST /auth/v1/token   404  ← MISMO code, 1,2 s después
 *
 * El `code` es de un solo uso, así que el segundo canje falla SIEMPRE. Y como
 * la respuesta que ve el navegador es la del segundo, la versión anterior de
 * este archivo mandaba a `/auth?error=El enlace venció` a alguien que acababa
 * de quedar logueado. Eso explica a las cuatro personas que entre agosto y
 * septiembre confirmaron el mail, iniciaron sesión y nunca crearon su negocio:
 * el sistema las autenticó y acto seguido les dijo que el link no servía.
 *
 * Por qué corre dos veces no está identificado. NO es el service worker
 * (`public/sw.js` no tiene `NavigationRoute` ni handler de `fetch`: solo
 * cachea imágenes, `_next/static` y Storage) y no es un reintento del cliente
 * (los dos POST salen con user agent `node`, o sea dos ejecuciones reales de
 * este handler). Queda el prefetch del navegador o del cliente de correo.
 *
 * El arreglo no depende de saberlo: pase lo que pase, esto termina SIEMPRE en
 * `destino`. Es la única forma de que la segunda pasada no pueda arruinar lo
 * que logró la primera.
 *
 * Y no se pierde nada, porque un cartel de "el enlace venció" no le cambiaba
 * la acción a nadie: `/empezar` es público y detecta si hay sesión — con
 * sesión arranca en el paso 2 (crear el negocio) y sin sesión muestra el paso
 * 1 (registrarse), que es exactamente lo que la persona tiene que hacer en
 * cada caso. Antes de volver a poner un redirect a `/auth` acá, leer el
 * párrafo de arriba.
 * ─────────────────────────────────────────────────────────────────────────
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Solo rutas internas: un `next` absoluto convertiría esto en un redirect
  // abierto, o sea un link con nuestro dominio que lleva a cualquier lado.
  // El filtro vive en `destino-callback.ts`, con sus tests — `//evil.com` es
  // el caso que se escapa de la intuición.
  const destino = destinoSeguro(searchParams.get("next"));

  if (code) {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      // El login con Google que se vincula a una cuenta con una contraseña de
      // un mail nunca verificado: esa clave puede ser de otro. Ver
      // `credencial-previa.ts`.
      await anularCredencialPreviaSiHaceFalta(supabase, data.session.user);
      // El link de "Reenviar" del banner de verificación llega acá.
      await marcarMailVerificadoSiLoProbo(data.session);
    }

    if (error) {
      // Se loguea con `haySesion` porque es el dato que distingue los dos
      // motivos posibles de fallo, y sin él no se pueden separar en Vercel:
      // true = la segunda pasada del doble canje, inofensiva; false = un link
      // de verdad vencido, o el `code_verifier` que quedó en OTRO navegador
      // (la persona se registró en la compu y abrió el mail en el celular).
      const {
        data: { user },
      } = await supabase.auth.getUser();

      console.error("[AUTH CALLBACK] canje fallido", {
        motivo: error.message,
        status: error.status,
        haySesion: Boolean(user),
      });
    }
  }

  return NextResponse.redirect(`${origin}${destino}`);
}
