/**
 * Validación del slug de negocio: la etiqueta que va a ser un subdominio
 * (`evens-indumentaria.comerz.app`) y la clave con la que la RLS resuelve el
 * catálogo público (`security.negocio_publico()`).
 *
 * Es un identificador de DNS, no un texto libre: por eso el formato es el de
 * una etiqueta de host (LDH: letters-digits-hyphen) y no "lo que quede de
 * slugificar el nombre". Hasta acá el slug salía de `nombre` sin ningún
 * chequeo, así que un negocio llamado "App" se llevaba `app.comerz.app` — el
 * host del panel privado.
 *
 * El mismo criterio está espejado como CHECK en la base
 * (20260811130000_negocios_slug_valido.sql). Esto es la puerta amable, el
 * CHECK es el freno: un slug se elige una vez y después es la URL que la
 * clienta manda por WhatsApp, así que no puede entrar uno inválido ni por un
 * camino que se olvide de validar.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;

/** Etiqueta de host: minúsculas, números y guiones, sin guión en las puntas. */
const FORMATO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Subdominios que nunca pueden ser de un negocio porque son (o van a ser) de
 * la plataforma. `app` es el panel privado y `www` la landing: dárselos a un
 * comercio no es un nombre feo, es perder el host.
 *
 * Va como Set exportado para que `negocio-slug.ts` resuelva el host contra
 * ESTA lista: dos listas de reservadas terminan diciendo cosas distintas.
 */
export const SLUGS_RESERVADOS = new Set([
  "app",
  "www",
  "admin",
  "api",
  "mail",
  "status",
  "support",
  "help",
  "blog",
  "docs",
  "cdn",
  "static",
  "assets",
  "auth",
  "login",
  "ingresar",
]);

export type ResultadoSlug =
  | { valido: true; slug: string }
  | { valido: false; error: string };

/**
 * Deriva un slug candidato desde el nombre del comercio. NO garantiza que el
 * resultado sea válido — puede quedar corto, vacío o reservado — así que el
 * resultado siempre pasa por `validarSlugNegocio`.
 */
export function slugDesdeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

export function validarSlugNegocio(entrada: string): ResultadoSlug {
  const slug = entrada.trim().toLowerCase();

  if (!slug) {
    return { valido: false, error: "La dirección web no puede estar vacía." };
  }

  if (slug.length < SLUG_MIN) {
    return {
      valido: false,
      error: `La dirección web necesita al menos ${SLUG_MIN} caracteres.`,
    };
  }

  if (slug.length > SLUG_MAX) {
    return {
      valido: false,
      error: `La dirección web no puede pasar de ${SLUG_MAX} caracteres.`,
    };
  }

  if (!FORMATO.test(slug)) {
    return {
      valido: false,
      error:
        "La dirección web solo admite minúsculas, números y guiones, y no puede empezar ni terminar con guión.",
    };
  }

  if (SLUGS_RESERVADOS.has(slug)) {
    return {
      valido: false,
      error: `"${slug}" está reservado por la plataforma. Elegí otra dirección web.`,
    };
  }

  return { valido: true, slug };
}
