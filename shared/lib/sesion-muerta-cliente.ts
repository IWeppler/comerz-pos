import { RUTA_SALIR, esSalidaDeSesion } from "./salir-sesion";

/**
 * Detección, EN EL NAVEGADOR, de una sesión que el servidor ya no reconoce.
 *
 * EL INCIDENTE (12/9/2026, Estilo Bonito, PWA de iOS). Romina cerró sesión;
 * la PWA instalada —que tiene su propio frasco de cookies— siguió abierta en
 * /pos sin sesión. A partir de ahí cada consulta a PostgREST salía como
 * `anon`: `permission denied for table turnos_caja` (postgres_logs 13:51:30),
 * que PostgREST devuelve como **401 cuando el rol es anon**. El polling del
 * turno lo repetía cada 60 s, el server action del catálogo volvía roto, y la
 * pantalla quedaba "trabada" sin decir por qué. Nadie la mandaba al login:
 * `salir-sesion.ts` cubre el caso cuando lo detecta el SERVER (`getUser()` con
 * 403), y este archivo cubre cuando lo detecta el CLIENTE, que es el único que
 * ve las consultas browser→PostgREST del POS.
 *
 * DOS SEÑALES, y las dos son semánticas antes que un status:
 *
 *  1. `onAuthStateChange(SIGNED_OUT)` y `getSession() === null` al volver al
 *     frente (`vigilante-sesion.tsx`). Es lo que auth-js dice cuando un refresh
 *     rechazado ya lo llevó a borrar la sesión, o cuando otra ventana la borró.
 *
 *  2. Un 401 de PostgREST, como red de seguridad, con REGLA ESTRICTA
 *     (`esRespuestaDeSesionMuerta`): solo `/rest/v1/`, y solo si el cuerpo trae
 *     `code` `PGRST30x` (JWT vencido o inválido) o si NO hay cookie de sesión
 *     en este navegador (rol anon, el caso del incidente). Lo que NO cuenta:
 *     - `401 Invalid API key` de Kong: env rota, no sesión — hacer logout ahí
 *       es un loop login → 401 → salir.
 *     - refresh (`/auth/v1/token`) rechazado: auth-js ya lo resuelve solo y
 *       distingue proactivo de reactivo (`GoTrueClient._callRefreshToken`);
 *       si el access token sigue vivo CONSERVA la sesión, y acá matarla sería
 *       un falso positivo.
 *     - Storage, Auth y cualquier otro host.
 *
 * LA SALIDA es `/auth/salir`, no `/auth`: hay que BORRAR las cookies, y el
 * único lugar donde eso escribe de verdad es ese route handler. Una sola vez
 * por página y nunca desde el propio login, donde no tener sesión es lo normal.
 */

const RUTA_REST = "/rest/v1/";

/** Códigos de PostgREST para JWT vencido / inválido / sin rol utilizable. */
const CODIGOS_JWT = ["PGRST300", "PGRST301", "PGRST302", "PGRST303"];

export type SenalRest401 = {
  url: string;
  status: number;
  /** `code` del cuerpo JSON de PostgREST, si lo trajo. */
  codigo: string | null;
  /** Hay cookie `sb-<ref>-auth-token` en este navegador. */
  haySesionLocal: boolean;
};

export function esRespuestaDeSesionMuerta(senal: SenalRest401): boolean {
  if (senal.status !== 401) return false;
  if (!senal.url.includes(RUTA_REST)) return false;
  if (senal.codigo && CODIGOS_JWT.includes(senal.codigo)) return true;
  // Sin cookie de sesión el request salió como anon: 401 acá es
  // "permission denied" para un rol que nunca debería estar en el panel.
  if (!senal.haySesionLocal) return true;
  return false;
}

/**
 * Nombre de la cookie de sesión que escribe @supabase/ssr:
 * `sb-<ref del proyecto>-auth-token` (y sus chunks `.0`, `.1`).
 */
export function nombreCookieSesion(supabaseUrl: string): string | null {
  try {
    const ref = new URL(supabaseUrl).hostname.split(".")[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

export function hayCookieDeSesion(
  cookieHeader: string,
  supabaseUrl: string,
): boolean {
  const nombre = nombreCookieSesion(supabaseUrl);
  if (!nombre) return false;
  return cookieHeader
    .split(";")
    .some((c) => c.trim().startsWith(`${nombre}=`) || c.trim().startsWith(`${nombre}.`));
}

let yaSaliendo = false;

/** Va al handler de salida una sola vez. Devuelve si lo hizo. */
export function salirPorSesionMuerta(
  ubicacion: Pick<Location, "pathname" | "search" | "assign"> = window.location,
): boolean {
  if (yaSaliendo) return false;
  // En el login la sesión muerta es lo esperado; rebotar acá sería un loop.
  if (ubicacion.pathname.startsWith("/auth")) return false;
  if (esSalidaDeSesion(ubicacion.pathname, ubicacion.search)) return false;

  yaSaliendo = true;
  ubicacion.assign(RUTA_SALIR);
  return true;
}

/** Solo para tests. */
export function _reiniciarSalidaParaTests(): void {
  yaSaliendo = false;
}
