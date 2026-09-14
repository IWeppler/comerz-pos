import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { COOKIE_NEGOCIO_ACTIVO } from "@/shared/lib/negocio-activo";
import type { ConfiguracionPOS } from "@/entities/config/types";

export interface ConfigPosDeLaRequest {
  id: string | null;
  posName: string | null;
  posLogo: string | null;
  /** El tipo viene de ConfiguracionPOS: el layout lo pasa derecho al Sidebar y
   * a la navbar, así que un `string` suelto acá se convertiría en un `as` allá. */
  modo_caja: ConfiguracionPOS["modo_caja"];
  /** No lo usa el layout: lo usan las PÁGINAS que este mismo request va a
   * renderizar (el panel y Carga Rápida), que antes se leían la fila otra vez
   * solo por esta columna. Viaja acá porque la lectura ya se está pagando.
   * Se normaliza en el consumidor con `normalizarRubro`, que es fail-closed. */
  rubro: ConfiguracionPOS["rubro"];
  /** Para el aviso de vencimiento del certificado de ARCA (layout): solo
   * con modo ARCA vale la pena ir a mirar las credenciales. */
  modo_facturacion: ConfiguracionPOS["modo_facturacion"];
  arca_ambiente: ConfiguracionPOS["arca_ambiente"];
}

/**
 * La configuración del negocio activo, UNA sola vez por request.
 *
 * `configuracion_pos` es una fila por negocio que cambia una vez por mes, y se
 * estaba leyendo ~2.950 veces por día: el `generateMetadata` del layout raíz la
 * pedía en CADA request —incluidas las peticiones RSC— solo para el título de
 * la pestaña, y el layout del dashboard la volvía a pedir por su cuenta en el
 * mismo request. En la base cuesta 0,16 ms; lo que cuesta es el viaje de red,
 * que no aparece en ninguna métrica de Postgres.
 *
 * `cache()` de React deduplica dentro del MISMO render: `generateMetadata` y el
 * layout comparten la respuesta, así que dos viajes pasan a ser uno. No es un
 * caché entre requests — cada navegación vuelve a leer, y por eso un cambio de
 * configuración se ve al instante sin invalidar nada. Ese era justamente el
 * riesgo de cachear esto con `unstable_cache`: la config gobierna el modo de
 * caja y el recargo, y servirla vieja es el bug del recargo al 5% otra vez.
 *
 * Sigue pasando por RLS, con el cliente del usuario. Se descartó resolverlo con
 * el cliente de service_role justamente por eso: el aislamiento entre negocios
 * es la policy, no el código que la llama.
 */
/**
 * Si el navegador trae la cookie de sesión de Supabase.
 *
 * Es una comprobación de PRESENCIA, no de validez —el token puede estar
 * vencido— y alcanza para lo único que decide acá: si vale la pena pagar el
 * viaje a la base. Quien manda sigue siendo la RLS; esto no autoriza nada.
 *
 * Se mira la cookie en vez de llamar a `auth.getUser()` porque eso serían dos
 * viajes en lugar del que se quiere evitar.
 *
 * El corte es por el prefijo `sb-` a secas y NO por el nombre completo
 * (`sb-<ref>-auth-token`, que además se numera `.0`, `.1` cuando el token no
 * entra en una cookie): el error de los dos lados no cuesta lo mismo. De más
 * es una consulta que sobraba, o sea lo que ya pasaba. De menos es la config
 * en null con sesión válida, y ahí `modo_caja` cae al fallback "UNICA" y una
 * vendedora ve y cierra el turno de otra. Un cambio de nomenclatura de
 * supabase-js tiene que costar lo primero, nunca lo segundo.
 *
 * Queda afuera `-code-verifier`, que existe durante el login en /auth y
 * todavía no es una sesión.
 */
function haySesion(cookieStore: Awaited<ReturnType<typeof cookies>>): boolean {
  return cookieStore
    .getAll()
    .some(
      ({ name, value }) =>
        name.startsWith("sb-") &&
        !name.includes("code-verifier") &&
        Boolean(value),
    );
}

export const leerConfigPos = cache(
  async (): Promise<ConfigPosDeLaRequest | null> => {
    const cookieStore = await cookies();

    // Sin negocio elegido no hay configuración que leer, y son muchas de las
    // requests: el login, el onboarding, la landing y todo el catálogo público
    // pasan por el layout raíz. Antes cada una de esas pagaba una consulta que
    // la RLS iba a responder vacía de todos modos.
    if (!cookieStore.get(COOKIE_NEGOCIO_ACTIVO)?.value) return null;

    // Tener negocio elegido no implica estar logueado: la cookie dura 30 días
    // y sobrevive a que la sesión expire o a que el refresh falle, y este
    // layout es el RAÍZ, así que también corre en el catálogo público, donde
    // el visitante es `anon` a propósito. `anon` tiene GRANT solo sobre las
    // columnas públicas de `configuracion_pos` —`modo_caja` NO está entre
    // ellas—, así que la consulta volvía 42501 y llenaba el log del error de
    // abajo, que existe para avisar de otra cosa. Sin sesión no hay panel que
    // configurar: no se consulta.
    if (!haySesion(cookieStore)) return null;

    const supabase = createClient(cookieStore);
    const { data, error } = await supabase
      .from("configuracion_pos")
      .select("id, posName, posLogo, modo_caja, rubro, modo_facturacion, arca_ambiente")
      .limit(1)
      .maybeSingle();

    // Devolver null y seguir es lo correcto —el layout tiene fallbacks y una
    // pestaña sin el nombre del comercio no justifica una pantalla de error—
    // pero NO puede ser silencioso: uno de los campos que se pierde es
    // `modo_caja`, y el fallback es "UNICA". O sea que un fallo de lectura no
    // deja al panel sin marca, deja a un negocio POR_USUARIO comportándose
    // como caja única, donde una vendedora ve y cierra el turno de otra.
    // Si esto aparece en el log, no es cosmético.
    if (error) {
      console.error("[CONFIG] No se pudo leer configuracion_pos:", error);
    }

    return (data as ConfigPosDeLaRequest | null) ?? null;
  },
);
