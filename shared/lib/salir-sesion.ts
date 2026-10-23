/**
 * La salida ORDENADA de una sesión que el servidor ya no reconoce.
 *
 * EL BUG QUE RESUELVE (incidente 7/9/2026, Estilo Bonito, PWA de iOS).
 *
 * El middleware y las páginas usan dos fuentes distintas para "¿hay sesión?",
 * y eso es a propósito: el middleware verifica el JWT LOCAL con `getClaims()`
 * —sin viaje de red, ver `contexto-desde-claims.ts`— y las páginas llaman a
 * `getUser()`, que sí le pregunta al servidor de Auth.
 *
 * Las dos coinciden salvo en una ventana: la sesión fue REVOCADA en el
 * servidor pero el access token todavía no venció (hasta 1 h). Ahí el
 * middleware dice "logueada, rol ADMIN" y la página recibe
 * `403 Session not found`. Con `redirect("/auth")` el ciclo se cierra solo:
 *
 *   /      → middleware deja pasar (claims OK)
 *   /      → layout: getUser() 403 → redirect /auth
 *   /auth  → middleware: hay user y hay rol → redirect / (gate 5)
 *   ...    → ERR_TOO_MANY_REDIRECTS, pantalla negra en la PWA
 *
 * Medido en los logs de Supabase: dos tandas de 11 respuestas
 * `403 "Session not found"` (23:25 y 23:29), que son los dos intentos de la
 * usuaria antes de que Safari corte el rebote.
 *
 * Cómo pasa que la sesión esté revocada y las cookies vivas: la PWA instalada
 * en iOS tiene su PROPIO frasco de cookies, separado del Safari normal, así
 * que cerrar sesión en uno mata la sesión del servidor y deja al otro con un
 * token firmado y vigente. La rotación de refresh token —que hoy hacen el
 * middleware y el navegador por separado— llega al mismo lugar.
 *
 * LA SALIDA. Redirigir a `/auth` no alcanza porque no BORRA nada: hay que
 * pasar por un route handler, que es el único contexto donde el `setAll` del
 * cliente de Supabase realmente escribe cookies (en un Server Component ese
 * `catch` se las traga — ver `shared/config/supabase/server.ts`). Sin cookies,
 * la vuelta por el middleware ve `user = null` y el login carga.
 */

/** Route handler que cierra la sesión y limpia las cookies. */
export const RUTA_SALIR = "/auth/salir";

/**
 * Marca en la URL del login de que se llegó por una sesión caída, no por un
 * logout a mano. Sirve para dos cosas: decirle a la persona por qué está de
 * vuelta acá, y —lo que importa— frenar el gate 5 del middleware, que si no
 * la devolvería al panel con el mismo token muerto y el rebote empezaría otra
 * vez.
 */
export const PARAM_SESION = "sesion";
export const VALOR_SESION_VENCIDA = "vencida";

/**
 * La pantalla de login. Se llamaba `/auth` hasta el 23/10/2026; `/auth` queda
 * como redirect (next.config) y como prefijo de los handlers (`callback`,
 * `confirm`, `salir`, `actualizar-password`), que están grabados en los
 * templates de mail de Supabase y en las URLs de retorno de Google.
 */
export const RUTA_LOGIN = "/ingresar";

export const DESTINO_LOGIN_SESION_VENCIDA =
  `${RUTA_LOGIN}?${PARAM_SESION}=${VALOR_SESION_VENCIDA}` as const;

/**
 * Rutas donde el middleware NO puede rebotar a un usuario "logueado" al panel,
 * porque son justamente las que existen para deshacer esa sesión.
 *
 * Es el segundo freno, independiente del borrado de cookies: si el handler
 * fallara —red, deploy a medias, cookie que no se borra— el loop sigue sin
 * poder ocurrir.
 */
export function esSalidaDeSesion(pathname: string, search: string): boolean {
  if (pathname === RUTA_SALIR || pathname.startsWith(`${RUTA_SALIR}/`)) {
    return true;
  }
  return new URLSearchParams(search).get(PARAM_SESION) === VALOR_SESION_VENCIDA;
}
