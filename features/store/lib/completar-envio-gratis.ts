import type { Producto } from "@/entities/productos/types";
import type { CartItemStore } from "@/entities/cart/types";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import type { OpcionPagoPublica } from "@/shared/lib/opciones-pago-publicas";
import { calcularTotalesPedido, progresoEnvioGratis, type ConfigEnvioGratis } from "@/shared/lib/totales-pedido-publico";
import { esFraccionable } from "@/shared/lib/unidad-venta";

/** Simula UNA unidad disponible con la misma cuenta del carrito. Nunca usa el
 * precio de cabecera si la variante tiene precio propio, ni suma el flete. */
export function elegirParaEnvioGratis({ productos, items, promociones, opcionPago, config, destino }: {
  productos: Producto[];
  items: CartItemStore[];
  promociones: PromocionDB[];
  opcionPago: OpcionPagoPublica | null;
  config?: ConfigEnvioGratis | null;
  destino?: "LOCAL" | "LEJOS" | null;
}) {
  const base = (lineas: CartItemStore[]) => {
    const total = calcularTotalesPedido({ items: lineas, promociones, opcionPago });
    return total.subtotal - (total.descuento?.monto ?? 0);
  };
  const baseActual = base(items);
  const actual = progresoEnvioGratis({ items, base: baseActual, config });
  if (!items.length || !actual.aplica || actual.alcanzado || (destino === "LEJOS" && config?.envio_gratis_alcance !== "TODOS")) return [];
  const presentes = new Set(items.map(i => i.productoId));
  const candidatos = productos.flatMap(producto => {
    if (!producto.publicado || !producto.slug || presentes.has(producto.id) || esFraccionable(producto.unidad_medida)) return [];
    return (producto.producto_variantes ?? []).flatMap(variante => {
      const precio = variante.precio ?? producto.precio;
      if (variante.activa === false || !Number.isFinite(variante.stock) || variante.stock < 1 || !Number.isFinite(precio) || precio <= 0) return [];
      const item: CartItemStore = { productoId: producto.id, varianteId: variante.id, nombre: producto.nombre, tipo: producto.tipo, variante: variante.nombre_display, precio, cantidad: 1, unidadMedida: producto.unidad_medida, stockMaximo: variante.stock };
      const baseSiguiente = base([...items, item]);
      const siguiente = progresoEnvioGratis({ items: [...items, item], base: baseSiguiente, config });
      if (!siguiente.alcanzado && siguiente.porcentaje <= actual.porcentaje) return [];
      return [{ producto, variante, precio, gastoAdicional: Math.max(0, baseSiguiente - baseActual), alcanza: siguiente.alcanzado, progreso: siguiente.porcentaje }];
    });
  });
  candidatos.sort((a, b) => Number(b.alcanza) - Number(a.alcanza) ||
    (a.alcanza ? a.gastoAdicional - b.gastoAdicional : b.progreso - a.progreso || a.gastoAdicional - b.gastoAdicional) ||
    a.producto.id.localeCompare(b.producto.id) || a.variante.id.localeCompare(b.variante.id));
  const vistos = new Set<string>();
  return candidatos.filter(c => { if (vistos.has(c.producto.id)) return false; vistos.add(c.producto.id); return true; }).slice(0, 4);
}
