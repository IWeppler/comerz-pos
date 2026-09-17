"use client";

import { CartItemStore } from "@/entities/cart/types";
import Image from "next/image";
import { Button } from "@/shared/ui/button";
import { CartItemRow } from "./cart-item-row";

interface CartStepItemsProps {
  items: CartItemStore[];
  onUpdateQuantity: (
    productoId: string,
    variante: string,
    cantidad: number,
  ) => void;
  onRemoveItem: (productoId: string, variante: string) => void;
  totalCarrito: number;
  onContinueToPayment: () => void;
  continueLabel?: string;
  /** varianteId de las líneas que no se pueden vender sin elegir el aparato. */
  variantesSerializadas?: Set<string>;
  /** IMEI ya elegido por varianteId, para mostrarlo en la línea. */
  imeiPorVariante?: Record<string, string>;
  /** Abre el selector de aparato desde la línea. */
  onElegirUnidad?: () => void;
  /** En los rubros de venta rápida (kiosco, almacén) el ticket va sin
   * miniaturas: son 96px de alto por renglón que se usan mejor mostrando un
   * ítem más. Default true. */
  mostrarImagenes?: boolean;
  /**
   * Franja fija arriba de las líneas. Hoy la usa el selector de lista de
   * precios del POS, que tiene que estar VISIBLE mientras se carga el ticket
   * —no escondido en el paso de pago— porque cambia el precio de cada renglón.
   */
  encabezado?: React.ReactNode;
  /**
   * Lo que va DEBAJO de las líneas, adentro del área que scrollea. Hoy es el
   * renglón de venta libre del POS. Se muestra también con el ticket vacío,
   * porque cobrar algo sin cargar es justo lo que se hace cuando no hay nada
   * que agregar desde la grilla.
   */
  pieDeLineas?: React.ReactNode;
}

/**
 * El PASO de ticket del POS: las líneas, el subtotal y el botón de continuar
 * al pago.
 *
 * Las líneas las dibuja `CartItemRow`, que comparte con el carrito del
 * catálogo público. Lo que NO comparte es este componente: el carrito público
 * dejó de tener pasos, así que un subtotal con un botón "Continuar" abajo era
 * exactamente lo que sobraba ahí.
 */
export function CartStepItems({
  items,
  onUpdateQuantity,
  onRemoveItem,
  totalCarrito,
  onContinueToPayment,
  continueLabel = "Continuar al Pago",
  variantesSerializadas,
  imeiPorVariante,
  onElegirUnidad,
  mostrarImagenes = true,
  encabezado,
  pieDeLineas,
}: Readonly<CartStepItemsProps>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {encabezado}
      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            {/* `alt=""` a propósito: la ilustración no agrega nada que el
                texto de abajo no diga, así que anunciarla dos veces con un
                lector de pantalla es ruido.

                El PNG son 1230×1278 y 462 kB, pero en pantalla nunca pasa de
                160px: `sizes` es lo que hace que el optimizador de Next sirva
                una variante chica en WebP/AVIF en vez del original.

                `dark:opacity-50` porque la ilustración es gris casi blanco y
                NO se adapta al tema, al revés del ícono que reemplaza (usaba
                `currentColor`). Sobre fondo claro queda sutil, como estaba;
                sobre fondo oscuro, a full, es un carrito blanco que grita más
                que el texto que tiene al lado. */}
            <Image
              src="/empty-cart.png"
              alt=""
              width={1230}
              height={1278}
              sizes="160px"
              className="mb-2 h-40 w-auto dark:opacity-50"
            />
            <p className="text-sm font-medium">Tu carrito esta vacio</p>
            {pieDeLineas && (
              <div className="mt-4 w-full max-w-sm text-left">
                {pieDeLineas}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <CartItemRow
                key={`${item.productoId}-${item.variante}`}
                item={item}
                mostrarImagen={mostrarImagenes}
                esSerializada={
                  !!item.varianteId &&
                  variantesSerializadas?.has(item.varianteId)
                }
                imei={
                  item.varianteId
                    ? imeiPorVariante?.[item.varianteId]
                    : undefined
                }
                onElegirUnidad={onElegirUnidad}
                onUpdateQuantity={(cantidad) =>
                  onUpdateQuantity(item.productoId, item.variante, cantidad)
                }
                onRemove={() => onRemoveItem(item.productoId, item.variante)}
              />
            ))}
            {pieDeLineas && <div className="pt-1">{pieDeLineas}</div>}
          </div>
        )}
      </div>

      {items.length > 0 ? (
        <div className="shrink-0 border-t border-border bg-card p-3">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-xl font-medium uppercase text-foreground">
              Subtotal
            </span>
            <span className="font-mono text-xl font-medium text-foreground">
              ${totalCarrito.toLocaleString("es-AR")}
            </span>
          </div>
          <Button
            type="button"
            onClick={onContinueToPayment}
            className="h-12 w-full"
          >
            {continueLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
