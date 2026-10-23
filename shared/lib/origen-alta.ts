/**
 * De dónde vino un comercio nuevo: el código de referido (`?ref=`) y la
 * campaña (`utm_*`) con que llegó a /empezar.
 *
 * El dato tiene que sobrevivir a TODO el camino del alta, que no es una sola
 * pantalla: el registro manda un mail que puede abrirse en otro dispositivo,
 * Google sale y vuelve, y la persona puede crear la cuenta hoy y el negocio
 * mañana. Por eso no viaja en la URL sino en una cookie que el middleware
 * escribe al primer ingreso, y se guarda dos veces en `user_metadata`:
 *
 *   - en el `signUp` (alta por mail): cubre al que confirma desde el celular
 *     y sigue ahí, donde la cookie no existe;
 *   - al crear el negocio, si todavía no estaba: cubre a Google, que no pasa
 *     por el `signUp`.
 *
 * Gana el PRIMER origen (first touch): quien llegó por la tienda de una
 * conocida y después vio un anuncio, fue referido por la conocida.
 *
 * Si no vino nada, no se guarda nada: "sin origen" es `null`, no "orgánico".
 * Pasarlo a `negocios` (y premiar el referido) es el paso siguiente, con
 * migración; ver docs/alta-y-sesion.md.
 */

export const COOKIE_ORIGEN_ALTA = "comerz_origen_alta";

/** 60 días: lo que tarda alguien en decidirse entre ver el link y registrarse. */
export const COOKIE_ORIGEN_ALTA_MAX_AGE = 60 * 24 * 60 * 60;

/** La clave en `user_metadata`. */
export const METADATA_ORIGEN_ALTA = "origen_alta";

const CAMPOS = ["ref", "utm_source", "utm_medium", "utm_campaign"] as const;

export type OrigenAlta = Partial<Record<(typeof CAMPOS)[number], string>>;

const LARGO_MAXIMO = 64;

/**
 * Lo que viene en la URL lo escribe cualquiera y termina en `user_metadata` y
 * en el panel de /admincomerz: se acepta solo un identificador corto. Un valor
 * raro se descarta campo por campo, sin voltear a los demás.
 */
function limpiar(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim().toLowerCase();
  if (!limpio || limpio.length > LARGO_MAXIMO) return null;
  return /^[a-z0-9._-]+$/.test(limpio) ? limpio : null;
}

function normalizar(fuente: (campo: string) => unknown): OrigenAlta | null {
  const origen: OrigenAlta = {};
  for (const campo of CAMPOS) {
    const valor = limpiar(fuente(campo));
    if (valor) origen[campo] = valor;
  }
  return Object.keys(origen).length > 0 ? origen : null;
}

/** El origen que trae la URL, o `null` si no trae ninguno válido. */
export function origenDesdeQuery(params: URLSearchParams): OrigenAlta | null {
  return normalizar((campo) => params.get(campo));
}

export function serializarOrigen(origen: OrigenAlta): string {
  return JSON.stringify(origen);
}

/**
 * Lee la cookie. Se vuelve a limpiar porque la cookie también la escribe
 * cualquiera; una cookie rota es "sin origen", nunca un error del alta.
 */
export function leerOrigen(valor: string | undefined | null): OrigenAlta | null {
  if (!valor) return null;
  try {
    return origenDesdeObjeto(JSON.parse(valor));
  } catch {
    return null;
  }
}

/** Lo mismo desde un objeto ya parseado (el jsonb `negocios.origen_alta`). */
export function origenDesdeObjeto(crudo: unknown): OrigenAlta | null {
  if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
  return normalizar((campo) => (crudo as Record<string, unknown>)[campo]);
}

/**
 * El link de alta que reparte una tienda: el slug del comercio es su código
 * de referido. `medio` separa el botón "Crear mi tienda" de la firma "Hecho
 * con Comerz", para saber cuál de los dos trae gente.
 */
export function queryAltaDesdeTienda(slug: string, medio: "boton" | "firma"): string {
  const params = new URLSearchParams({
    ref: slug,
    utm_source: "tienda",
    utm_medium: medio,
  });
  return `?${params.toString()}`;
}
