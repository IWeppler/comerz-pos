import { redondearCantidad } from "@/shared/lib/unidad-venta";

/**
 * `productos_stock` tiene una fila por variante, aunque el carrito pueda
 * tener varias líneas de esa variante (unidad base + presentaciones). El
 * UPDATE ... FROM de PostgreSQL no suma filas fuente duplicadas: por eso el
 * payload legacy tiene que llegar agrupado por id.
 */
export function agruparStockLegacy(
  items: readonly { stockId: string | null; cantidad: number }[],
): { stock_id: string; cantidad: number }[] {
  const cantidadPorId = new Map<string, number>();

  for (const item of items) {
    if (!item.stockId) continue;
    cantidadPorId.set(
      item.stockId,
      redondearCantidad(
        (cantidadPorId.get(item.stockId) ?? 0) + Number(item.cantidad || 0),
      ),
    );
  }

  return [...cantidadPorId].map(([stock_id, cantidad]) => ({
    stock_id,
    cantidad,
  }));
}
