import { normalizarBusqueda } from "@/shared/lib/normalizar-busqueda";

/**
 * Criterios de la lista de Inventario (/stock), en un solo lugar.
 *
 * Antes cada fila decidía por su cuenta: el producto pintaba ámbar con menos
 * de 5 y sus variantes, abiertas debajo, solo distinguían 0 de "hay" — el
 * mismo stock se veía de dos colores en dos renglones seguidos.
 */

/**
 * Umbral de "stock bajo". Fijo porque no hay stock mínimo por producto: el
 * tipo `Producto` declara `stock_minimo`, pero la columna no existe en la base
 * (verificado el 6/10/2026). Si algún día existe, entra acá.
 */
export const UMBRAL_STOCK_BAJO = 5;

export type NivelStock = "agotado" | "bajo" | "normal";

export function nivelStock(cantidad: number): NivelStock {
  if (!(cantidad > 0)) return "agotado";
  if (cantidad < UMBRAL_STOCK_BAJO) return "bajo";
  return "normal";
}

/** El punto de color de cada nivel (el número va siempre al lado: el color
 * solo no alcanza para quien no distingue rojo de verde). */
export const COLOR_NIVEL_STOCK: Record<NivelStock, string> = {
  agotado: "bg-danger",
  bajo: "bg-warning",
  normal: "bg-success",
};

interface ProductoBuscable {
  nombre: string;
  marca?: string | null;
  modelo?: string | null;
  producto_variantes?: { sku?: string | null }[] | null;
}

/**
 * ¿El producto matchea la búsqueda? Nombre, marca y modelo sin tildes
 * ("camion" encuentra "Camión", igual que el POS y Ctrl+K), y el SKU de
 * cualquier variante: escanear o tipear un código en Inventario tiene que
 * encontrar el producto, no solo escribir su nombre.
 */
export function coincideBusquedaInventario(
  producto: ProductoBuscable,
  busqueda: string,
): boolean {
  const q = normalizarBusqueda(busqueda);
  if (!q) return true;

  const textos = [producto.nombre, producto.marca, producto.modelo];
  if (textos.some((t) => t && normalizarBusqueda(t).includes(q))) return true;

  return (producto.producto_variantes ?? []).some(
    (v) => v.sku && normalizarBusqueda(v.sku).includes(q),
  );
}

/** Comparación de textos para ordenar: español, sin distinguir mayúsculas ni
 * tildes, y lo vacío al final (no al principio, donde taparía todo). */
export function compararTexto(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const ta = (a ?? "").trim();
  const tb = (b ?? "").trim();
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.localeCompare(tb, "es", { sensitivity: "base" });
}
