"use client";

import { ShoppingBag } from "lucide-react";
import type { CartItemStore } from "@/entities/cart/types";
import type { TotalesPedido } from "@/shared/lib/totales-pedido-publico";
import { esFraccionable, formatearCantidad } from "@/shared/lib/unidad-venta";
import { detalleVarianteCarrito } from "../../lib/detalle-renglon-carrito";
import { pesos } from "./formato";

/**
 * El resumen del pedido: productos (solo lectura: para cambiar algo se vuelve
 * al carrito), cupón y desglose. NO CALCULA NADA: recibe los totales ya
 * resueltos, los mismos que viajan a la orden y al mensaje de WhatsApp.
 *
 * Descuento y recargo son renglones propios, nunca absorbidos en el total: un
 * comercio puede tener los dos sobre el mismo medio.
 */
export function ResumenCheckout({
  items,
  totales,
  cupon,
  extra,
  retiro = false,
}: Readonly<{
  items: CartItemStore[];
  totales: TotalesPedido;
  cupon?: React.ReactNode;
  extra?: React.ReactNode;
  /** Retiro en el local: el envío no es "a calcular", no hay. */
  retiro?: boolean;
}>) {
  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        {items.map((item) => {
          const detalle = [detalleVarianteCarrito(item), item.presentacionNombre].filter(Boolean).join(" · ");
          // Por unidad, el número solo ("2"); por peso, con la unidad ("0,750 kg").
          const cantidad = esFraccionable(item.unidadMedida)
            ? formatearCantidad(item.cantidad, item.unidadMedida)
            : String(item.cantidad);
          return (
            <li key={`${item.productoId}-${item.variante}-${item.presentacionId ?? ""}`} className="flex items-center gap-3">
              <div className="relative shrink-0">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg border border-border bg-background">
                  {item.imagenUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imagenUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ShoppingBag className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[11px] font-semibold text-background">
                  {cantidad}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.nombre}</p>
                {detalle && <p className="truncate text-xs text-muted-foreground">{detalle}</p>}
              </div>
              <span className="shrink-0 text-sm font-medium">{pesos(item.precio * item.cantidad)}</span>
            </li>
          );
        })}
      </ul>

      {cupon}
      {extra}

      <div className="space-y-1.5 border-t border-border pt-4 text-sm">
        <Renglon etiqueta="Subtotal" valor={pesos(totales.subtotal)} />
        {totales.descuento && (
          <Renglon etiqueta={totales.descuento.etiqueta} valor={`− ${pesos(totales.descuento.monto)}`} tono="text-success" />
        )}
        {totales.recargo && (
          <Renglon etiqueta={totales.recargo.etiqueta} valor={`+ ${pesos(totales.recargo.monto)}`} tono="text-warning" />
        )}
        <Renglon
          etiqueta="Envío"
          valor={
            !totales.envio
              ? retiro
                ? "Retiro gratis"
                : "Completá la entrega"
              : totales.envio.etiqueta === "Envío gratis"
                ? "Gratis"
                : pesos(totales.envio.monto)
          }
        />
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-4">
        <span className="text-base font-semibold">Total</span>
        <span className="text-2xl font-bold">{pesos(totales.total)}</span>
      </div>
    </div>
  );
}

function Renglon({
  etiqueta,
  valor,
  tono = "text-muted-foreground",
}: Readonly<{ etiqueta: string; valor: string; tono?: string }>) {
  return (
    <div className={`flex items-center justify-between gap-3 ${tono}`}>
      <span className="min-w-0 truncate">{etiqueta}</span>
      <span className="shrink-0 font-medium">{valor}</span>
    </div>
  );
}
