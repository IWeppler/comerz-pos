"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { detalleRenglon, nombreRenglon } from "../lib/nombre-renglon";

/**
 * Qué se puede devolver de una venta, y cuánto queda de cada renglón.
 *
 * SE PIDE AL SERVER Y NO SE ARMA CON LO QUE YA TIENE LA TABLA porque
 * `cantidad_devuelta` cambia con cada devolución: la grilla de /ventas se
 * cargó hace veinte minutos y puede estar mostrando un renglón que otra
 * vendedora ya devolvió. La RPC igual rechaza el exceso —el guard está en su
 * propio UPDATE— pero eso sería enterarse con el error; acá se abre el modal
 * con lo que de verdad queda.
 */
export interface RenglonDevolvible {
  ventaItemId: string;
  producto: string;
  variante: string;
  /** Precio unitario ya con el descuento del renglón restado. */
  precioFinal: number;
  cantidad: number;
  cantidadDevuelta: number;
  /** Lo que todavía se puede devolver. */
  disponible: number;
  /** Si su variante ya no existe, devolver al inventario no va a sumar nada.
   * Ver `restaurabilidad-venta.ts`: quedan 116 renglones así, todos previos al
   * 16/8. */
  puedeVolverAlStock: boolean;
}

export async function getRenglonesDevolviblesAction(
  ventaId: string,
): Promise<{ data: RenglonDevolvible[]; error: string | null }> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data: items, error } = await supabase
      .from("ventas_items")
      .select(
        "id, producto_id, variante, variante_id, cantidad, cantidad_devuelta, precio_final, es_venta_libre, producto:productos(nombre)",
      )
      .eq("venta_id", ventaId);

    if (error) {
      console.error("[DEVOLUCION] No se pudieron leer los renglones:", error);
      return { data: [], error: "No se pudieron cargar los renglones." };
    }

    const variantesVivas = new Set<string>();
    const variantesPedidas = (items ?? [])
      .map((item) => item.variante_id)
      .filter(Boolean) as string[];

    if (variantesPedidas.length > 0) {
      const { data: vivas } = await supabase
        .from("producto_variantes")
        .select("id")
        .in("id", variantesPedidas);

      for (const variante of vivas ?? []) variantesVivas.add(variante.id);
    }

    const renglones: RenglonDevolvible[] = (items ?? []).map((item) => {
      const cantidad = Number(item.cantidad || 0);
      const devuelta = Number(item.cantidad_devuelta || 0);
      const producto = Array.isArray(item.producto)
        ? item.producto[0]
        : item.producto;

      return {
        ventaItemId: item.id as string,
        producto: nombreRenglon(producto?.nombre as string | null, item),
        variante: detalleRenglon(item),
        precioFinal: Number(item.precio_final || 0),
        cantidad,
        cantidadDevuelta: devuelta,
        disponible: Math.max(0, cantidad - devuelta),
        puedeVolverAlStock:
          !!item.variante_id && variantesVivas.has(item.variante_id as string),
      };
    });

    return { data: renglones, error: null };
  } catch (err) {
    console.error("[DEVOLUCION] Error inesperado leyendo renglones:", err);
    return { data: [], error: "No se pudieron cargar los renglones." };
  }
}
