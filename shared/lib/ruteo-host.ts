/**
 * Qué hacer con un request según el host y el path. Pura y sin IO a propósito:
 * el middleware pone el lookup del slug y los NextResponse, acá vive la
 * decisión, que es lo que hay que poder probar sin levantar el server.
 */

import { ROOT_DOMAIN, SITE_URL } from "./dominios";
import type { DestinoHost } from "./host-comerz";

/** Página del 404 propio de tienda inexistente. */
export const RUTA_TIENDA_NO_ENCONTRADA = "/tienda-no-encontrada";

/**
 * Paths de primer nivel que son de la PLATAFORMA, no de un catálogo.
 *
 * En un subdominio de tienda el catálogo se sirve desde la raíz, así que
 * `/campera-negra` es un producto y `/pos` sería... también un producto, si no
 * estuviera acá. Es la misma idea que `SLUGS_RESERVADOS` pero para el path.
 *
 * SI SE AGREGA UNA RUTA DE PRIMER NIVEL AL PANEL, VA EN ESTA LISTA. Olvidarse
 * hace que en los subdominios esa ruta se sirva como si fuera un producto (404
 * de catálogo), no que se filtre el panel: falla hacia el lado seguro, pero
 * falla.
 */
export const PATHS_DE_PLATAFORMA = [
  "auth",
  "admincomerz",
  "caja",
  "clientes",
  "compras",
  "configuracion",
  "empezar",
  // El nombre viejo de /empezar: next.config lo redirige, pero en un
  // subdominio de tienda primero tiene que llegar al panel.
  "onboarding",
  "invitacion",
  "ordenes",
  "perfil",
  "pos",
  "privacidad",
  "recuperar",
  "reportes",
  "seleccionar-negocio",
  "sesion-interrumpida",
  "stock",
  "terminos",
  "ventas",
] as const;

const PLATAFORMA = new Set<string>(PATHS_DE_PLATAFORMA);

export type AccionRuteo =
  /** No es un host de tienda: sigue el pipeline de siempre (auth, roles...). */
  | { tipo: "seguir" }
  /** Se sirve otra ruta sin que cambie la URL. */
  | { tipo: "rewrite"; pathname: string }
  | { tipo: "redirect"; destino: string }
  /** Slug que no existe: 404 propio, no una excepción. */
  | { tipo: "no-encontrada" };

/** Host del panel privado. Con wildcard es app.<raíz>; sin él, NEXT_PUBLIC_SITE_URL. */
export function urlDelPanel(pathname = "/", search = ""): string {
  const base = ROOT_DOMAIN ? `https://app.${ROOT_DOMAIN}` : SITE_URL;
  return `${base}${pathname}${search}`;
}

export function urlDeTienda(slug: string, pathname = "/", search = ""): string {
  const base = ROOT_DOMAIN
    ? `https://${slug}.${ROOT_DOMAIN}`
    : `${SITE_URL}/store/${slug}`;
  return `${base}${pathname === "/" ? "" : pathname}${search}`;
}

function primerSegmento(pathname: string): string {
  return pathname.split("/").filter(Boolean)[0] ?? "";
}

export interface EntradaRuteo {
  destino: DestinoHost;
  pathname: string;
  search?: string;
  /** null mientras no se resolvió; el middleware lo completa desde el cache. */
  tiendaExiste?: boolean | null;
}

export function decidirRuteo({
  destino,
  pathname,
  search = "",
  tiendaExiste = null,
}: EntradaRuteo): AccionRuteo {
  if (destino.tipo === "app") return { tipo: "seguir" };

  // La landing todavía no existe: hasta que exista, el dominio desnudo manda al
  // panel en vez de mostrar una página en blanco. Cuando haya landing, esto se
  // cambia por un rewrite a /landing y es el ÚNICO lugar que se toca.
  if (destino.tipo === "landing") {
    return { tipo: "redirect", destino: urlDelPanel(pathname, search) };
  }

  const { slug } = destino;

  // Slug que no resolvió contra la base. `false` es "no existe"; `null` es "no
  // se pudo saber", y ahí se deja pasar: la página resuelve el tenant por su
  // cuenta y hace su propio 404 si corresponde.
  if (tiendaExiste === false) return { tipo: "no-encontrada" };

  const segmento = primerSegmento(pathname);

  // El panel no se sirve desde el subdominio de una tienda: se manda a su host.
  // Si no, el mismo login viviría en cinco dominios y la cookie de sesión en
  // ninguno de los que importa.
  if (PLATAFORMA.has(segmento)) {
    return { tipo: "redirect", destino: urlDelPanel(pathname, search) };
  }

  // La ruta interna existe y es la única que renderiza, pero no se muestra: si
  // alguien llega a evens.comerz.app/store/evens/campera —un link viejo, un
  // enlace generado en modo path— se lo devuelve a la URL limpia. Sin esto la
  // ruta interna se filtra en la barra de direcciones y en los links copiados.
  if (segmento === "store") {
    const partes = pathname.split("/").filter(Boolean);
    const slugEnPath = partes[1];

    if (slugEnPath === slug) {
      const resto = partes.slice(2).join("/");
      return { tipo: "redirect", destino: `/${resto}${search}` };
    }
    // Catálogo de OTRO negocio pedido en este subdominio: se lo manda al suyo.
    if (slugEnPath) {
      const resto = partes.slice(2).join("/");
      return {
        tipo: "redirect",
        destino: urlDeTienda(slugEnPath, `/${resto}`, search),
      };
    }
    return { tipo: "redirect", destino: `/${search}` };
  }

  // Todo lo demás es catálogo: la raíz es la portada y un segmento suelto es un
  // producto. La URL no cambia; adentro se sirve /store/<slug>/...
  const resto = pathname === "/" ? "" : pathname;
  return { tipo: "rewrite", pathname: `/store/${slug}${resto}` };
}
