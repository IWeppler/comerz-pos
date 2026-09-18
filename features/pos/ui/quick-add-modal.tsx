"use client";

import { useEffect, useMemo, useState } from "react";
import { Producto } from "@/entities/productos/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { useCartStore } from "@/shared/store/cart-store";
import { toast } from "sonner";
import { Layers } from "lucide-react";
import { parseRawVariantString } from "@/entities/productos/lib/parse-variant-attributes";
import { resolverAtributosVariante } from "@/entities/productos/lib/build-propiedades-filtro";
import {
  formaInicialDeLinea,
  resolverImagenPrincipal,
} from "../lib/producto-a-carrito";

interface VarianteSeleccionada {
  varianteId: string | undefined;
  variante: string;
  precio: number | null;
  costo: number | null;
  sku: string | null;
  stockDisponible: number;
}

interface QuickAddModalProps {
  producto: Producto | null;
  isOpen: boolean;
  onClose: () => void;
  permitirVentaSinStock?: boolean;
  /** Cuando se pasa, se llama en vez de agregar al carrito de ventas del
   * POS — permite reutilizar este selector de variante desde otros flujos
   * (ej. Carga Rápida) sin tocar useCartStore. */
  onSelectVariante?: (seleccion: VarianteSeleccionada) => void;
}

export function QuickAddModal({
  producto,
  isOpen,
  onClose,
  permitirVentaSinStock = false,
  onSelectVariante,
}: Readonly<QuickAddModalProps>) {
  if (!producto) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      {isOpen ? (
        <QuickAddModalContent
          key={producto.id}
          producto={producto}
          isOpen={isOpen}
          onClose={onClose}
          permitirVentaSinStock={permitirVentaSinStock}
          onSelectVariante={onSelectVariante}
        />
      ) : null}
    </Dialog>
  );
}

function QuickAddModalContent({
  producto,
  isOpen,
  onClose,
  permitirVentaSinStock,
  onSelectVariante,
}: Readonly<{
  producto: Producto;
  isOpen: boolean;
  onClose: () => void;
  permitirVentaSinStock: boolean;
  onSelectVariante?: (seleccion: VarianteSeleccionada) => void;
}>) {
  const addItem = useCartStore((state) => state.addItem);
  const setIsOpenCart = useCartStore((state) => state.setIsOpen);

  const variantesArray = useMemo(() => {
    const list: Array<{
      variante: string;
      cantidad: number;
      varianteId: string | undefined;
      atributos?: Record<string, string>;
      precio: number | null;
      costo: number | null;
      sku: string | null;
    }> = [];
    let tieneAtributosEstructurados = false;
    producto.producto_variantes?.forEach((v) => {
      const atributos = resolverAtributosVariante(v);
      if (Object.keys(atributos).length > 0) tieneAtributosEstructurados = true;
      list.push({
        variante: v.nombre_display,
        cantidad: v.stock_disponible ?? v.stock,
        varianteId: v.id,
        atributos,
        precio: v.precio,
        // El catálogo público no trae `costo` (anon no lo tiene concedido);
        // acá siempre viene, porque esto es el POS. El ?? null es para el tipo,
        // no para un caso real — y de todos modos el costo que persiste en la
        // venta lo resuelve create-sale.ts contra la base.
        costo: v.costo ?? null,
        sku: v.sku ?? null,
      });
    });

    // Solo se recurre al stock legacy si el producto nunca se migró a
    // producto_variantes.atributos — si no, se duplican los grupos porque
    // ambas fuentes describen las mismas variantes. Estas filas vienen de
    // productos_stock, NO de producto_variantes: varianteId queda
    // undefined a propósito, nunca el id de la fila de stock legacy.
    if (!tieneAtributosEstructurados) {
      producto.stock?.forEach((s) =>
        list.push({
          variante: s.variante,
          cantidad: s.cantidad,
          varianteId: undefined,
          precio: null,
          costo: null,
          sku: null,
        }),
      );
    }
    return list;
  }, [producto]);

  const parsedVariants = useMemo(() => {
    const props: Record<string, Set<string>> = {};

    variantesArray.forEach((s) => {
      if (s.atributos && Object.keys(s.atributos).length > 0) {
        Object.entries(s.atributos).forEach(([k, val]) => {
          if (!props[k]) props[k] = new Set();
          props[k].add(val as string);
        });
      } else {
        const parsed = parseRawVariantString(s.variante || "");
        Object.entries(parsed).forEach(([k, val]) => {
          if (!props[k]) props[k] = new Set();
          props[k].add(val);
        });
      }
    });

    const result: Record<string, string[]> = {};
    Object.keys(props).forEach((k) => (result[k] = Array.from(props[k])));
    return { properties: result };
  }, [variantesArray]);

  const autoSelections = useMemo(() => {
    const selections: Record<string, string> = {};

    Object.entries(parsedVariants.properties).forEach(([propName, values]) => {
      if (values.length === 1) {
        selections[propName] = values[0];
      }
    });

    return selections;
  }, [parsedVariants]);

  const [selecciones, setSelecciones] =
    useState<Record<string, string>>(autoSelections);

  const isOptionAvailable = (propName: string, val: string) => {
    const testSelections = { ...selecciones, [propName]: val };
    return variantesArray.some((s) => {
      if (!permitirVentaSinStock && s.cantidad <= 0) return false;

      const attrs =
        s.atributos && Object.keys(s.atributos).length > 0
          ? s.atributos
          : parseRawVariantString(s.variante || "");

      return Object.entries(testSelections).every(
        ([k, selVal]) => attrs[k] === selVal,
      );
    });
  };

  useEffect(() => {
    if (!isOpen) return;

    const dimensionsCount = Object.keys(parsedVariants.properties).length;
    const selectionsCount = Object.keys(selecciones).length;

    if (dimensionsCount > 0 && dimensionsCount === selectionsCount) {
      const stockDeVariante = variantesArray.find((s) => {
        const attrs =
          s.atributos && Object.keys(s.atributos).length > 0
            ? s.atributos
            : parseRawVariantString(s.variante || "");
        return Object.entries(selecciones).every(
          ([k, selVal]) => attrs[k] === selVal,
        );
      });

      if (
        stockDeVariante &&
        (permitirVentaSinStock || stockDeVariante.cantidad > 0)
      ) {
        if (onSelectVariante) {
          onSelectVariante({
            varianteId: stockDeVariante.varianteId,
            variante: stockDeVariante.variante,
            precio: stockDeVariante.precio ?? producto.precio,
            costo: stockDeVariante.costo ?? producto.precio_costo ?? null,
            sku: stockDeVariante.sku,
            stockDisponible: stockDeVariante.cantidad,
          });
        } else {
          const precioBase = stockDeVariante.precio ?? producto.precio;
          const forma = formaInicialDeLinea(
            producto,
            stockDeVariante.varianteId,
            precioBase,
          );
          addItem({
            productoId: producto.id,
            nombre: producto.nombre || "Sin nombre",
            tipo: producto.tipo || "",
            variante: stockDeVariante.variante,
            varianteId: stockDeVariante.varianteId,
            // El precio de siempre, en la forma de la línea. Si hay una lista
            // activa, el ticket re-precia esta línea en cuanto entra (ver el
            // guard de `cart-panel-admin`); `precioBase` es lo que le
            // permite hacerlo sin tomar un precio ya descontado como base.
            precio: forma.precio,
            precioBase,
            precioBaseEfectivo: precioBase,
            costoBase: stockDeVariante.costo ?? producto.precio_costo ?? null,
            cantidad: 1,
            unidadMedida: producto.unidad_medida,
            presentacionId: forma.presentacionId,
            presentacionNombre: forma.presentacionNombre,
            factor: forma.factor,
            presentaciones: forma.presentaciones,
            imagenUrl: resolverImagenPrincipal(producto),
            stockMaximo: stockDeVariante.cantidad,
          });

          // toast.success("Agregado a la cuenta");
          setIsOpenCart(true);
        }
        onClose();
      }
    }
  }, [
    selecciones,
    parsedVariants,
    producto,
    isOpen,
    variantesArray,
    permitirVentaSinStock,
    addItem,
    setIsOpenCart,
    onClose,
    onSelectVariante,
  ]);

  return (
    <DialogContent className="sm:max-w-md p-0 overflow-hidden bg-card border-border">
      <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
        <DialogTitle className="flex items-center gap-2 text-lg font-bold">
          <Layers className="w-5 h-5 text-primary" />
          {producto.nombre}
        </DialogTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Selecciona la variante a vender.
        </p>
      </DialogHeader>

      <div className="p-5 space-y-6">
        {Object.entries(parsedVariants.properties).map(([propName, values]) => (
          <div key={propName}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
              {propName}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {values.map((val) => {
                const isSelected = selecciones[propName] === val;
                const hasStock = isOptionAvailable(propName, val);

                return (
                  <button
                    key={val}
                    type="button"
                    disabled={!hasStock}
                    onClick={() =>
                      setSelecciones((prev) => ({
                        ...prev,
                        [propName]: val,
                      }))
                    }
                    className={`h-12 rounded-xl text-xs font-semibold uppercase transition-all border ${
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground ring-2 ring-primary/20 cursor-pointer scale-[0.98]"
                        : hasStock
                          ? "border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted cursor-pointer"
                          : "border-border/30 bg-muted/30 text-muted-foreground opacity-50 cursor-not-allowed line-through decoration-muted-foreground/40"
                    }`}
                  >
                    {val}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </DialogContent>
  );
}
