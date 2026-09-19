"use client";

import { Check, Package, Scale } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  ABREVIATURA_UNIDAD,
  normalizarUnidadMedida,
} from "@/shared/lib/fiscal-producto";
import { esFraccionable, formatearCantidad } from "@/shared/lib/unidad-venta";
import {
  precioEnForma,
  presentacionesDisponibles,
  type PresentacionCarrito,
} from "@/shared/lib/presentaciones";
import { formatearMoneda } from "@/shared/utils/formatters";

interface SelectorFormaVentaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productoNombre: string;
  variante?: string | null;
  unidadMedida?: string | null;
  precioBase: number;
  stockMaximo: number;
  presentaciones: readonly PresentacionCarrito[];
  presentacionIdActual?: string | null;
  onElegir: (presentacionId: string | null) => void;
}

/**
 * La elección de forma de venta es una decisión de mostrador, no un campo de
 * formulario. Por eso son opciones grandes con precio y disponibilidad, no un
 * select: se entiende antes de agregar y funciona igual para corregir el
 * renglón desde el ticket.
 */
export function SelectorFormaVentaDialog({
  open,
  onOpenChange,
  productoNombre,
  variante,
  unidadMedida,
  precioBase,
  stockMaximo,
  presentaciones,
  presentacionIdActual = null,
  onElegir,
}: Readonly<SelectorFormaVentaDialogProps>) {
  const unidad = normalizarUnidadMedida(unidadMedida);
  const abreviatura = ABREVIATURA_UNIDAD[unidad];
  const baseFraccionable = esFraccionable(unidad);

  const elegir = (presentacionId: string | null) => {
    onElegir(presentacionId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 p-0 sm:max-w-md max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>¿Cómo lo vendés?</DialogTitle>
          <DialogDescription>
            {productoNombre}
            {variante && variante !== "Único" ? ` · ${variante}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => elegir(null)}
            className={`relative flex min-h-24 cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              presentacionIdActual === null
                ? "border-primary bg-primary/5"
                : "border-border bg-card"
            }`}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Scale className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {baseFraccionable ? "Suelto" : "Por unidad"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatearMoneda(precioBase)} por {abreviatura}
              </span>
              <span className="block text-xs text-muted-foreground">
                {formatearCantidad(stockMaximo, unidad)} disponibles
              </span>
            </span>
            {presentacionIdActual === null && (
              <Check className="absolute right-2 top-2 size-4 text-primary" />
            )}
          </button>

          {presentaciones.map((presentacion) => {
            const activa = presentacionIdActual === presentacion.id;
            const disponibles = presentacionesDisponibles(
              stockMaximo,
              presentacion.factor,
            );
            return (
              <button
                key={presentacion.id}
                type="button"
                onClick={() => elegir(presentacion.id)}
                disabled={disponibles <= 0}
                className={`relative flex min-h-24 items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45 ${
                  activa
                    ? "border-primary bg-primary/5"
                    : "cursor-pointer border-border bg-card hover:border-primary hover:bg-primary/5"
                }`}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Package className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {presentacion.nombre}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatearMoneda(precioEnForma(precioBase, presentacion))}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {formatearCantidad(presentacion.factor, unidad)} · {disponibles} disponibles
                  </span>
                </span>
                {activa && (
                  <Check className="absolute right-2 top-2 size-4 text-primary" />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
