import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { HEADER_NEGOCIO_SLUG, slugDesdeHost } from "@/shared/lib/negocio-slug";
import {
  COOKIE_IMPERSONATE,
  HEADER_IMPERSONATE,
  HEADER_NEGOCIO_ACTIVO,
  leerCookie,
  leerCookieNegocioActivo,
} from "@/shared/lib/negocio-activo";
import { reportarErrorCliente } from "@/shared/lib/reportar-error-cliente";
import { RUTA_SALIR } from "@/shared/lib/salir-sesion";
import {
  esRespuestaDeSesionMuerta,
  hayCookieDeSesion,
  salirPorSesionMuerta,
} from "@/shared/lib/sesion-muerta-cliente";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

/**
 * Headers de tenant, resueltos EN CADA REQUEST (no al crear el cliente).
 *
 * Por qué en cada request y no una vez: createBrowserClient de @supabase/ssr
 * es singleton — la primera llamada del navegador queda cacheada en el módulo
 * y todas las siguientes devuelven ESA instancia, con los headers congelados.
 * Como el login y el selector navegan con router.push (navegación blanda, sin
 * recargar la página), un cliente creado antes de que existiera la cookie
 * `negocio_activo_id` se quedaba sin header para el resto de la sesión: en la
 * base, security.current_negocio_id() devolvía NULL y la policy restrictive
 * `same_negocio` filtraba TODO. Síntoma: las páginas server-rendered mostraban
 * los datos (el cliente de servidor sí lee la cookie por request) y cualquier
 * consulta desde el navegador volvía vacía, sin error visible.
 *
 * Solo le pasaba a quien pertenece a más de un negocio: con una sola membresía
 * current_negocio_id() cae al fallback y el header no hace falta.
 */
const headersNegocio = (): Record<string, string> => {
  if (typeof window === "undefined") return {};

  const headers: Record<string, string> = {};

  // En el navegador no pasa el middleware, así que el slug del negocio sale
  // del host. Las consultas del carrito público (anon) lo necesitan para que
  // la RLS sepa de qué tienda son el stock y los precios.
  const negocioSlug = slugDesdeHost(window.location.hostname);
  if (negocioSlug) headers[HEADER_NEGOCIO_SLUG] = negocioSlug;

  // Para el usuario logueado, el negocio activo sale de la cookie que dejó el
  // login o el selector de negocio.
  const negocioActivo = leerCookieNegocioActivo(document.cookie);
  if (negocioActivo) headers[HEADER_NEGOCIO_ACTIVO] = negocioActivo;

  // Modo Dios del super admin. Por eso la cookie no es httpOnly: el cliente de
  // browser tiene que poder reenviarla como header.
  const impersonando = leerCookie(document.cookie, COOKIE_IMPERSONATE);
  if (impersonando) headers[HEADER_IMPERSONATE] = impersonando;

  return headers;
};

/** El `code` del cuerpo de error de PostgREST, sin consumir la respuesta. */
async function leerCodigoPostgrest(respuesta: Response): Promise<string | null> {
  try {
    const cuerpo = (await respuesta.clone().json()) as { code?: unknown };
    return typeof cuerpo?.code === "string" ? cuerpo.code : null;
  } catch {
    return null;
  }
}

/**
 * Cliente del PANEL: lleva la sesión del usuario. NO usarlo en el catálogo
 * público — para eso está `createPublicBrowserClient`, abajo, que explica por
 * qué mandar la sesión ahí rompe la tienda.
 *
 * OJO con las cookies: acá no se pasa `cookieOptions`, y es a propósito. Sin
 * `domain`, la cookie de sesión queda host-only, o sea pegada a app.comerz.app
 * y a ningún otro host. Poner `domain: ".comerz.app"` para "compartir la sesión
 * entre subdominios" mandaría la sesión de la dueña al catálogo público de los
 * 4 negocios, en un host que sirve HTML a cualquiera. Hay un test que falla si
 * aparece (`cookies-dominio.test.ts`).
 */
export const createClient = () =>
  createBrowserClient(supabaseUrl, supabaseKey, {
    global: {
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        for (const [clave, valor] of Object.entries(headersNegocio())) {
          headers.set(clave, valor);
        }
        const respuesta = await fetch(input, { ...init, headers });

        // Red de seguridad contra la sesión zombie: un 401 de PostgREST que
        // sea de verdad "no hay sesión" manda a /auth/salir. La regla es
        // estricta a propósito (JWT rechazado, o request salido como anon) —
        // ver `sesion-muerta-cliente.ts` para el incidente y los falsos
        // positivos que NO deben disparar esto.
        if (respuesta.status === 401) {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const codigo = await leerCodigoPostgrest(respuesta);
          const senal = {
            url,
            status: respuesta.status,
            codigo,
            haySesionLocal: hayCookieDeSesion(document.cookie, supabaseUrl),
          };
          if (esRespuestaDeSesionMuerta(senal) && salirPorSesionMuerta()) {
            reportarErrorCliente({
              tipo: "sesion-muerta",
              mensaje: `401 en ${new URL(url).pathname}: sesión ausente o rechazada, se sale por ${RUTA_SALIR}.`,
              detalle: { codigo, haySesionLocal: senal.haySesionLocal },
            });
          }
        }
        return respuesta;
      },
    },
  });

/**
 * `createSupabaseClient` no es singleton: llamarlo por cada useEffect crea un
 * GoTrueClient por llamada (y su warning de "Multiple GoTrueClient instances").
 * Se cachea por slug, que es lo único que cambia entre instancias.
 */
const crearClientePublico = (slugNegocio: string | null) =>
  createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: slugNegocio
      ? { headers: { [HEADER_NEGOCIO_SLUG]: slugNegocio } }
      : undefined,
  });

const clientesPublicos = new Map<
  string,
  ReturnType<typeof crearClientePublico>
>();

/**
 * Cliente del CATÁLOGO PÚBLICO en el navegador. Siempre anónimo, nunca con
 * sesión. Es el espejo de `createPublicClient` del server, y existe por el
 * mismo motivo que aquel (ver el comentario largo en `supabase/server.ts`):
 *
 * `createBrowserClient` de @supabase/ssr manda la sesión que encuentre en las
 * cookies. Un visitante logueado deja de ser `anon`, la RLS pasa a evaluar la
 * restrictive de `authenticated` —negocio ACTIVO del usuario, no el slug de la
 * tienda— y devuelve cero filas: es el incidente del 2/8, que se arregló en el
 * server y quedó vivo acá. En el catálogo el visitante no tiene identidad: la
 * tienda se sirve igual para todos, siempre por slug.
 *
 * El slug viene de la ruta (`useSlugNegocio`), NO del host, porque el catálogo
 * se sirve de dos formas y solo una tiene el slug en el host. Resolviéndolo por
 * host, en modo path (comerz.app/store/evens) no había header, la policy
 * `negocio_publico()` devolvía NULL y estas consultas volvían VACÍAS —
 * verificado contra PostgREST: sin header `[]`, con header las 3 promociones.
 */
export const createPublicBrowserClient = (slugNegocio: string | null) => {
  const clave = slugNegocio ?? "";

  const cacheado = clientesPublicos.get(clave);
  if (cacheado) return cacheado;

  const cliente = crearClientePublico(slugNegocio);
  clientesPublicos.set(clave, cliente);
  return cliente;
};
