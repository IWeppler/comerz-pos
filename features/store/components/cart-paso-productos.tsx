"use client";

import { Button } from "@/shared/ui/button";
import { CartItemStore } from "@/entities/cart/types";
import { CartItemRow } from "@/shared/components/cart-sidebar/cart-item-row";
import { BOTON_CATALOGO } from "../lib/estilos-catalogo";
import type { ReactNode } from "react";
import {
  categoriaCarrito,
  detalleVarianteCarrito,
} from "../lib/detalle-renglon-carrito";

/**
 * PASO 1: solo los productos.
 *
 * No hay ni un dato del pedido acá, y es el punto de tener dos pasos: mirar lo
 * que uno eligió y decidir si sigue comprando es una cosa, y cargar nombre,
 * dirección y forma de pago es otra. Mezcladas en una sola pantalla, el
 * formulario empuja los productos fuera de la vista justo cuando la clienta
 * quiere revisarlos.
 *
 * El pie tiene UNA acción: "Finalizar compra" con el total, a todo el ancho.
 * "Seguir comprando" es la salida, no una alternativa: va abajo, chica y como
 * link. El código de descuento va en el pie, arriba del botón: es parte de
 * cerrar la compra, no de revisar los productos.
 */
export function CartPasoProductos({
  items,
  total,
  onUpdateQuantity,
  onRemoveItem,
  onSeguirComprando,
  onContinuar,
  pie,
  children,
}: Readonly<{
  items: CartItemStore[];
  /** Lo que sale el carrito hoy: subtotal menos las promos que ya aplican. */
  total: number;
  onUpdateQuantity: (
    productoId: string,
    variante: string,
    cantidad: number,
  ) => void;
  onRemoveItem: (productoId: string, variante: string) => void;
  onSeguirComprando: () => void;
  onContinuar: () => void;
  /** Lo que va en el pie arriba del botón (el código de descuento). */
  pie?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="space-y-3">
          {items.map((item) => (
            <CartItemRow
              key={`${item.productoId}-${item.variante}`}
              item={item}
              categoria={categoriaCarrito(item)}
              detalleVariante={detalleVarianteCarrito(item)}
              onUpdateQuantity={(cantidad) =>
                onUpdateQuantity(item.productoId, item.variante, cantidad)
              }
              onRemove={() => onRemoveItem(item.productoId, item.variante)}
            />
          ))}
        </div>
        <div className="mt-5 space-y-5">{children}</div>
      </div>

      <div className="shrink-0 space-y-3 border-t border-border bg-card px-4 py-4">
        {pie}

        <Button
          type="button"
          onClick={onContinuar}
          className={`flex h-12 w-full items-center justify-between gap-3 px-4 text-sm font-semibold ${BOTON_CATALOGO}`}
        >
          <span>Finalizar compra</span>
          <span className="font-mono">${total.toLocaleString("es-AR")}</span>
        </Button>

        {/* Cierra el panel y deja el carrito intacto: el store vive afuera de
            este componente, así que volver a abrirlo lo encuentra igual. */}
        <Button
          type="button"
          variant="ghost"
          onClick={onSeguirComprando}
          className="mx-auto flex h-11 text-xs font-normal text-muted-foreground underline underline-offset-4 hover:bg-transparent hover:text-foreground"
        >
          Seguir comprando
        </Button>
      </div>
    </>
  );
}
