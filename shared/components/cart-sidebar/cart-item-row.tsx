"use client";

import { CartItemStore } from "@/entities/cart/types";
import { Barcode, ShoppingBag, X } from "lucide-react";
import { CantidadControl } from "./cantidad-control";
import { esFraccionable, formatearCantidad } from "@/shared/lib/unidad-venta";
import {
  ABREVIATURA_UNIDAD,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";

interface CartItemRowProps {
  item: CartItemStore;
  onUpdateQuantity: (cantidad: number) => void;
  onRemove: () => void;
  /** La línea no se puede vender sin elegir el aparato (rubro electro). */
  esSerializada?: boolean;
  /** IMEI ya elegido, para mostrarlo en la línea. */
  imei?: string;
  /** Abre el selector de aparato. Sin esto el badge es informativo: en el
   * catálogo público no hay nada que elegir. */
  onElegirUnidad?: () => void;
  /** En los rubros de venta rápida (kiosco, almacén) el ticket va sin
   * miniaturas: son 96px de alto por renglón que se usan mejor mostrando un
   * ítem más. */
  mostrarImagen?: boolean;
}

/**
 * UNA línea del carrito, la misma en el ticket del POS y en el carrito del
 * catálogo público.
 *
 * ES UNA SOLA a propósito. Antes vivía adentro de `CartStepItems`, que además
 * de las líneas dibuja el subtotal y el botón de continuar — o sea que el
 * carrito público, que ya no tiene ni pasos ni ese pie, no podía usar las
 * líneas sin arrastrar todo lo demás. La alternativa era copiarlas, y una
 * línea de carrito duplicada es dos lugares donde arreglar el mismo bug de
 * precio.
 */
export function CartItemRow({
  item,
  onUpdateQuantity,
  onRemove,
  esSerializada = false,
  imei,
  onElegirUnidad,
  mostrarImagen = true,
}: Readonly<CartItemRowProps>) {
  const lineSubtotal = item.precio * item.cantidad;

  return (
    <div className="flex gap-3">
      {mostrarImagen && (
        <div className="h-24 w-18 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/40">
          {item.imagenUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imagenUrl}
              alt={item.nombre}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ShoppingBag className="h-5 w-5 text-muted-foreground/40" />
            </div>
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold uppercase tracking-wide text-foreground">
              {item.nombre}
            </p>
            {/* En la venta libre `variante` es la misma descripción que
                `nombre`: repetirla no dice nada, y "Venta libre" sí — es lo
                que avisa que este renglón no descuenta stock. */}
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {item.ventaLibre ? "Venta libre" : item.variante}
            </p>
            {/* Producto serializado: hasta que no se elija el aparato, la
                venta no se puede confirmar. El badge es el acceso al
                selector — sin esto la vendedora lee "requiere elegir unidad"
                y no tiene dónde elegirla hasta el paso de pago. */}
            {esSerializada && (
              <button
                type="button"
                onClick={onElegirUnidad}
                disabled={!onElegirUnidad}
                className={`mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest ${
                  imei ? "text-success" : "text-warning"
                } ${
                  onElegirUnidad
                    ? "underline underline-offset-2 hover:opacity-70"
                    : "cursor-default"
                }`}
              >
                <Barcode className="h-3 w-3 shrink-0" />
                {imei ?? "Elegir unidad (IMEI)"}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label={`Quitar ${item.nombre}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-end justify-between gap-3">
          <CantidadControl
            cantidad={item.cantidad}
            precio={item.precio}
            unidadMedida={item.unidadMedida}
            stockMaximo={item.stockMaximo}
            onChange={onUpdateQuantity}
          />

          <div className="text-right">
            {/* El precio por unidad de medida solo se muestra cuando se vende
                fraccionado: en una remera "x u." es ruido, en un fiambre es el
                dato que explica de dónde sale el subtotal. */}
            {esFraccionable(item.unidadMedida) && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {formatearCantidad(item.cantidad, item.unidadMedida)} × $
                {item.precio.toLocaleString("es-AR")}/
                {ABREVIATURA_UNIDAD[normalizarUnidadMedida(item.unidadMedida)]}
              </p>
            )}
            {/* El precio de siempre, tachado, cuando una lista de precios lo
                cambió. Es la señal por renglón de que el ticket no está a los
                precios de todos los días; la franja de arriba lo dice para el
                ticket entero. Sin lista, `precioBase` es igual a `precio` y
                acá no se dibuja nada. */}
            {item.precioBase != null && item.precioBase !== item.precio && (
              <p className="font-mono text-[10px] text-muted-foreground line-through">
                ${(item.precioBase * item.cantidad).toLocaleString("es-AR")}
              </p>
            )}
            <p className="font-mono text-sm font-medium text-foreground">
              ${lineSubtotal.toLocaleString("es-AR")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
