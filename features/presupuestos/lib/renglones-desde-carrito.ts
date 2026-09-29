import { esIdVentaLibre, validarVentaLibre } from "@/features/pos/lib/venta-libre";

/**
 * Del carrito del POS al payload de `crear_presupuesto`.
 *
 * Del carrito se usa SOLO qué producto, qué variante y cuánto. El precio lo
 * resuelve la base (`coalesce(variante.precio, producto.precio)`): un precio
 * que viaja desde el navegador se elige con las DevTools abiertas. La única
 * excepción es la venta libre, igual que en la venta: no hay contra qué
 * revalidarla, así que se valida la forma con la misma función que el POS.
 *
 * Lo que la cotización todavía NO sabe cotizar se rechaza nombrando el
 * renglón, en vez de sacarlo en silencio del papel (docs/presupuestos.md):
 *   - Presentaciones (el balde de 4,7 kg): el precio de la presentación no es
 *     `variante ?? producto`, y cotizarla a precio de kilo sería mentir.
 */

/** Lo mínimo que el server action acepta del carrito. */
export type RenglonCarrito = {
  productoId: string;
  varianteId?: string | null;
  /** Nombre de la variante: respaldo para resolverla si falta el id. */
  variante?: string | null;
  nombre?: string | null;
  cantidad: number;
  precio?: number | null;
  presentacionId?: string | null;
  presentacionNombre?: string | null;
  ventaLibre?: boolean;
};

export type RenglonCatalogo = {
  tipo: "CATALOGO";
  productoId: string;
  /** null = el carrito no lo trajo; el server lo resuelve por nombre. */
  varianteId: string | null;
  varianteNombre: string;
  nombre: string;
  cantidad: number;
};

export type RenglonLibre = {
  tipo: "LIBRE";
  descripcion: string;
  precio: number;
  cantidad: number;
};

export type RenglonCotizacion = RenglonCatalogo | RenglonLibre;

export type ResultadoRenglones =
  | { ok: true; renglones: RenglonCotizacion[] }
  | { ok: false; error: string };

export const RENGLONES_MAX = 200;

export function renglonesDesdeCarrito(items: unknown): ResultadoRenglones {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "El carrito está vacío." };
  }
  if (items.length > RENGLONES_MAX) {
    return {
      ok: false,
      error: `Una cotización no puede tener más de ${RENGLONES_MAX} renglones.`,
    };
  }

  const conPresentacion: string[] = [];
  const renglones: RenglonCotizacion[] = [];

  for (const crudo of items as RenglonCarrito[]) {
    const cantidad = Number(crudo?.cantidad);
    const nombre = String(crudo?.nombre ?? "").trim() || "Producto";

    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return { ok: false, error: `La cantidad de "${nombre}" no es válida.` };
    }

    if (crudo.ventaLibre === true || esIdVentaLibre(crudo.productoId)) {
      const libre = validarVentaLibre({
        descripcion: crudo.nombre,
        precio: crudo.precio,
      });
      if (!libre.ok) return { ok: false, error: libre.error };
      renglones.push({
        tipo: "LIBRE",
        descripcion: libre.valor.descripcion,
        precio: libre.valor.precio,
        cantidad,
      });
      continue;
    }

    if (crudo.presentacionId) {
      conPresentacion.push(
        crudo.presentacionNombre ? `${nombre} (${crudo.presentacionNombre})` : nombre,
      );
      continue;
    }

    if (typeof crudo.productoId !== "string" || !crudo.productoId) {
      return { ok: false, error: `"${nombre}" no tiene producto asociado.` };
    }

    renglones.push({
      tipo: "CATALOGO",
      productoId: crudo.productoId,
      varianteId:
        typeof crudo.varianteId === "string" && crudo.varianteId
          ? crudo.varianteId
          : null,
      varianteNombre: String(crudo.variante ?? ""),
      nombre,
      cantidad,
    });
  }

  if (conPresentacion.length > 0) {
    return {
      ok: false,
      error: `Las presentaciones todavía no se pueden cotizar: ${conPresentacion.join(", ")}. Cambialas a la unidad base.`,
    };
  }

  return { ok: true, renglones };
}

/** El jsonb que recibe `crear_presupuesto`. Los de catálogo ya tienen que
 * tener la variante resuelta. */
export function payloadRpc(
  renglones: RenglonCotizacion[],
  variantePorRenglon: (r: RenglonCatalogo) => string,
) {
  return renglones.map((r) =>
    r.tipo === "LIBRE"
      ? {
          venta_libre: true,
          descripcion: r.descripcion,
          precio: r.precio,
          cantidad: r.cantidad,
        }
      : {
          producto_id: r.productoId,
          variante_id: variantePorRenglon(r),
          cantidad: r.cantidad,
        },
  );
}
