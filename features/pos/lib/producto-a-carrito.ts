import type { Producto } from "@/entities/productos/types";
import type { ProductoCargado } from "@/features/carga-rapida/types";
import {
  aPresentacionCarrito,
  precioEnForma,
  presentacionDefault,
  presentacionesDeVariante,
  type PresentacionCarrito,
} from "@/shared/lib/presentaciones";

/**
 * Con qué FORMA entra al carrito una variante recién tocada, y con qué
 * presentaciones a mano para cambiarla desde el ticket.
 *
 * Se agrega en la presentación marcada como default si hay una; si no, en la
 * unidad base. Un solo toque en la grilla tiene que seguir siendo un solo
 * toque: el que vende globos de a pack marca el pack como default y no elige
 * nada más; el que vende crema suelta no marca ninguna y el balde queda a un
 * cambio de selector en la línea.
 *
 * `precioBase` es por unidad base (ya con lista si corresponde); el precio de
 * la línea sale en su forma.
 */
export function formaInicialDeLinea(
  producto: Pick<Producto, "producto_presentaciones">,
  varianteId: string | undefined,
  precioBase: number,
): {
  presentacionId: string | null;
  presentacionNombre: string | null;
  factor: number;
  precio: number;
  presentaciones: PresentacionCarrito[] | undefined;
} {
  const inicial = presentacionDefault(
    producto.producto_presentaciones,
    varianteId ?? null,
  );
  return formaElegidaDeLinea(
    producto,
    varianteId,
    precioBase,
    inicial?.id ?? null,
  );
}

/**
 * Resuelve una forma elegida explícitamente en el selector visual. `null` es
 * la unidad base; un id es una presentación. La lista aplicable viaja siempre
 * para que el ticket pueda reabrir el mismo selector sin consultar de nuevo.
 */
export function formaElegidaDeLinea(
  producto: Pick<Producto, "producto_presentaciones">,
  varianteId: string | undefined,
  precioBase: number,
  presentacionId: string | null,
): {
  presentacionId: string | null;
  presentacionNombre: string | null;
  factor: number;
  precio: number;
  presentaciones: PresentacionCarrito[] | undefined;
} {
  const aplicables = presentacionesDeVariante(
    producto.producto_presentaciones,
    varianteId ?? null,
  ).map(aPresentacionCarrito);
  const elegida = presentacionId
    ? (aplicables.find((p) => p.id === presentacionId) ?? null)
    : null;
  return {
    presentacionId: elegida?.id ?? null,
    presentacionNombre: elegida?.nombre ?? null,
    factor: elegida?.factor ?? 1,
    precio: precioEnForma(precioBase, elegida),
    presentaciones: aplicables.length > 0 ? aplicables : undefined,
  };
}

/**
 * Adapta lo que reporta la Carga rápida a un `Producto` completo, para que lo
 * recién cargado entre por EL MISMO camino que un producto tocado en la
 * grilla (resolución de variantes, selector de variante, alta al carrito) sin
 * esperar a que React Query recargue el catálogo.
 *
 * Lo que no viaja en el reporte va en su valor vacío honesto: sin imágenes,
 * sin slug, sin costo y sin stock legacy. Nada de eso lo lee este camino —
 * el carrito usa precio, y el costo real lo resuelve `create-sale` contra la
 * base al confirmar la venta.
 */
export function productoCargadoAProducto(cargado: ProductoCargado): Producto {
  return {
    id: cargado.id,
    nombre: cargado.nombre,
    tipo: cargado.tipo,
    precio: cargado.precio,
    unidad_medida: cargado.unidad_medida,
    precio_costo: 0,
    imagen_url: null,
    thumbnail_url: null,
    grid_url: null,
    creado_en: new Date().toISOString(),
    publicado: true,
    slug: null,
    stock: [],
    producto_variantes: cargado.variantes.map((v) => ({
      id: v.id,
      nombre_display: v.nombre_display,
      precio: v.precio,
      costo: null,
      stock: v.stock,
    })),
    producto_presentaciones: cargado.presentaciones,
  };
}

/** Las tres columnas de imagen guardan un JSON array serializado, pero los
 * productos viejos guardaron un string suelto. Este parseo estaba copiado en
 * pos-terminal.tsx (dos veces) y en quick-add-modal.tsx. */
function parsearUrls(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor as string[];
  if (typeof valor !== "string" || valor === "") return [];
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed : [valor];
  } catch {
    return [valor];
  }
}

/**
 * Imagen para la card / la línea del carrito. El orden es por tamaño servido:
 * grid (320px) primero, después thumbnail (150px) y por último la original.
 */
export function resolverImagenPrincipal(
  producto: Pick<Producto, "imagen_url" | "thumbnail_url" | "grid_url">,
): string | null {
  return (
    parsearUrls(producto.grid_url)[0] ??
    parsearUrls(producto.thumbnail_url)[0] ??
    parsearUrls(producto.imagen_url)[0] ??
    null
  );
}

export interface VarianteVendible {
  variante: string;
  cantidad: number;
  precio: number | null;
  /** producto_variantes.id real; undefined en el fallback legacy (productos_stock). */
  varianteId: string | undefined;
}

/**
 * Variantes que se pueden vender ahora mismo.
 *
 * Solo se recurre al stock legacy (productos_stock) si el producto nunca se
 * migró a producto_variantes — si no, se duplica el conteo porque ambas
 * fuentes describen el mismo stock. En ese fallback `varianteId` queda
 * undefined a propósito: nunca es el id de la fila de stock legacy.
 */
export function resolverVariantesVendibles(
  producto: Producto,
  permitirVentaSinStock: boolean,
): VarianteVendible[] {
  const todas: VarianteVendible[] = [];

  producto.producto_variantes?.forEach((v) =>
    todas.push({
      variante: v.nombre_display,
      cantidad: v.stock_disponible ?? v.stock,
      precio: v.precio,
      varianteId: v.id,
    }),
  );

  if ((producto.producto_variantes?.length ?? 0) === 0) {
    producto.stock?.forEach((s) =>
      todas.push({
        variante: s.variante,
        cantidad: s.cantidad,
        precio: null,
        varianteId: undefined,
      }),
    );
  }

  return permitirVentaSinStock ? todas : todas.filter((v) => v.cantidad > 0);
}
