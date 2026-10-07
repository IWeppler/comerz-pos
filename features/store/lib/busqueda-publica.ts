import type { Producto } from "@/entities/productos/types";
import { normalizarBusqueda } from "@/shared/lib/normalizar-busqueda";
import { coincideConBusqueda } from "./coincide-busqueda";
import { crearPasaFiltroStock, type ConfigVisibilidad } from "./catalogo-core";

/** El buscador es global dentro de la tienda: nunca hereda la categoría,
 * selección compartida ni filtros de la página que se estaba mirando. */
export function rutaBusquedaPublica(rutaCatalogo: string, consulta: string) {
  if (rutaCatalogo === "#") return "#";
  const q = consulta.trim();
  return `${rutaCatalogo}?${q ? new URLSearchParams({ q }) : "ver=todo"}`;
}

export function puedeBuscarSinNavegar(pathname: string, rutaCatalogo: string, params: URLSearchParams) {
  // Next puede devolver el path interno bajo un rewrite por subdominio.
  const esPortada = pathname === rutaCatalogo ||
    (rutaCatalogo === "/" && /^\/store\/[^/]+\/?$/.test(pathname));
  // Estos parámetros intervienen en metadata: al quitarlos debe volver al server.
  return esPortada && !["categoria", "sub", "productos"].some((p) => params.has(p));
}

export function buscarEnCatalogoPublico(productos: Producto[], consulta: string, config?: ConfigVisibilidad | null) {
  const pasaStock = crearPasaFiltroStock(config);
  const visibles = productos.filter((p) => p.publicado && p.slug && pasaStock(p));
  const q = normalizarBusqueda(consulta);
  if (!q) return { total: visibles.length, productos: [], sugerencias: [] as string[] };
  const relevancia = (p: Producto) => {
    if (p.producto_variantes?.some((v) => normalizarBusqueda(v.sku ?? "") === q)) return 4;
    const nombre = normalizarBusqueda(p.nombre);
    return nombre === q ? 3 : nombre.startsWith(q) ? 2 : 1;
  };
  const coincidencias = visibles.filter((p) => coincideConBusqueda(p, consulta))
    .sort((a, b) => relevancia(b) - relevancia(a) || (b.creado_en ?? "").localeCompare(a.creado_en ?? ""));
  const sugerencias = new Map<string, string>();
  for (const producto of coincidencias) {
    for (const texto of [producto.nombre, producto.marca, producto.modelo]) {
      if (!texto || !normalizarBusqueda(texto).includes(q)) continue;
      const clave = normalizarBusqueda(texto);
      if (!sugerencias.has(clave)) sugerencias.set(clave, texto.trim());
      if (sugerencias.size === 3) break;
    }
    if (sugerencias.size === 3) break;
  }
  return { total: coincidencias.length, productos: coincidencias.slice(0, 4), sugerencias: [...sugerencias.values()] };
}
