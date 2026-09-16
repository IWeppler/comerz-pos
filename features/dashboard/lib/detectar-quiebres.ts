import { ProductoPanel } from "@/entities/productos/types";
import { Venta, VentaItem } from "@/entities/ventas/types";

export type QuiebreProducto = {
  productoId: string;
  nombre: string;
  unidadesVendidas: number;
};

export type StockCriticoRotacionItem = {
  productoId: string;
  nombre: string;
  variante: string;
  cantidad: number;
  unidadesVendidas: number;
};

/** Ventana fija de "rotación reciente" — independiente del selector de
 * período del dashboard. La comparten todas las reglas de esta familia
 * (quiebres, stock crítico, riesgo por categoría) para no tener criterios
 * de "qué está rotando de verdad" divergentes entre sí. */
export const VENTANA_ROTACION_DIAS = 14;

const UMBRAL_STOCK_CRITICO = 3;

/**
 * Unidades vendidas por `producto_id` dentro de los últimos `ventanaDias`
 * días — la base de "qué está rotando de verdad ahora mismo" que usan
 * tanto `detectarQuiebresRotacion` como `detectarStockCriticoRotacion`
 * (y el riesgo por categoría), para no duplicar el mismo recorrido de
 * ventas con criterios de fecha ligeramente distintos en cada lugar.
 */
export function calcularUnidadesVendidasRecientes(
  ventasOperativas: Venta[],
  ventanaDias: number,
  ahora: Date,
): Map<string, number> {
  const inicioVentana = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate() - ventanaDias,
  );

  const unidadesPorProducto = new Map<string, number>();

  for (const venta of ventasOperativas) {
    const fecha = new Date(venta.fecha_venta);
    if (fecha < inicioVentana) continue;

    const items = (venta.ventas_items || []) as VentaItem[];
    for (const item of items) {
      if (!item.producto_id) continue;
      const actual = unidadesPorProducto.get(item.producto_id) ?? 0;
      unidadesPorProducto.set(
        item.producto_id,
        actual + Number(item.cantidad || 0),
      );
    }
  }

  return unidadesPorProducto;
}

/**
 * "Quiebre de rotación reciente": producto que SÍ tuvo demanda en los
 * últimos `ventanaDias` días pero HOY está en stock total 0 — a diferencia
 * de "stock crítico" (≤3, sigue vendible) esto ya está perdiendo ventas
 * ahora mismo. Ordenado por unidades vendidas en la ventana (el que más
 * se pedía primero, mayor urgencia de reponer).
 */
export function detectarQuiebresRotacion(
  ventasOperativas: Venta[],
  productos: ProductoPanel[],
  ventanaDias: number,
  ahora: Date,
): QuiebreProducto[] {
  const unidadesPorProducto = calcularUnidadesVendidasRecientes(
    ventasOperativas,
    ventanaDias,
    ahora,
  );

  if (unidadesPorProducto.size === 0) return [];

  const productosById = new Map(productos.map((p) => [p.id, p]));

  const quiebres: QuiebreProducto[] = [];
  for (const [productoId, unidadesVendidas] of unidadesPorProducto) {
    const producto = productosById.get(productoId);
    if (!producto) continue;

    const stockTotal = (producto.stock || []).reduce(
      (acc, s) => acc + Number(s.cantidad || 0),
      0,
    );
    if (stockTotal > 0) continue;

    quiebres.push({ productoId, nombre: producto.nombre, unidadesVendidas });
  }

  return quiebres.sort((a, b) => b.unidadesVendidas - a.unidadesVendidas);
}

/**
 * Stock crítico "de verdad": variantes con stock bajo (1 a
 * UMBRAL_STOCK_CRITICO unidades) que pertenecen a un producto con VENTAS
 * en los últimos `ventanaDias` días. Reemplaza la regla vieja de "stock
 * ≤3 en TODO el catálogo", que en indumentaria disparaba con ~90% de los
 * productos (confirmado: 1677 productos) porque no distinguía mercadería
 * que rota de la que nunca se mueve.
 */
export function detectarStockCriticoRotacion(
  ventasOperativas: Venta[],
  productos: ProductoPanel[],
  ventanaDias: number,
  ahora: Date,
): StockCriticoRotacionItem[] {
  const unidadesPorProducto = calcularUnidadesVendidasRecientes(
    ventasOperativas,
    ventanaDias,
    ahora,
  );

  if (unidadesPorProducto.size === 0) return [];

  const productosById = new Map(productos.map((p) => [p.id, p]));

  const criticos: StockCriticoRotacionItem[] = [];
  for (const [productoId, unidadesVendidas] of unidadesPorProducto) {
    const producto = productosById.get(productoId);
    if (!producto) continue;

    (producto.stock || []).forEach((s) => {
      const cantidad = Number(s.cantidad || 0);
      if (cantidad > 0 && cantidad <= UMBRAL_STOCK_CRITICO) {
        criticos.push({
          productoId,
          nombre: producto.nombre,
          variante: s.variante,
          cantidad,
          unidadesVendidas,
        });
      }
    });
  }

  return criticos.sort((a, b) => b.unidadesVendidas - a.unidadesVendidas);
}
