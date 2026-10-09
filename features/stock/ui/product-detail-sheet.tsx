"use client";

import { useState, useEffect } from "react"; // 1. Importamos hooks de React
import { Producto } from "@/entities/productos/types";
import { UnidadesSeriePanel } from "./unidades-serie-panel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import { Badge } from "@/shared/ui/badge";
import {
  Leaf,
  AlignLeft,
  Image as ImageIcon,
  Zap,
  ShoppingCart,
} from "lucide-react";
import Image from "next/image";

import { ProductEditDetailSheet } from "./edit-sheet";
import { EliminarProductoModal } from "./delete-modal";
import { useCartStore } from "@/shared/store/cart-store";
import { Button } from "@/shared/ui/button";
import { formatearMoneda } from "@/shared/utils/formatters";

interface ProductDetailSheetProps {
  producto: Producto;
  children: React.ReactNode;
  userRole?: string;
}

// --- HELPERS ---
const capitalizar = (str: string) => {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).replace("_", " ");
};

const obtenerPrimeraImagen = (imagenUrl: unknown): string | null => {
  if (!imagenUrl) return null;
  if (Array.isArray(imagenUrl) && imagenUrl.length > 0) return imagenUrl[0];
  if (typeof imagenUrl === "string") {
    if (imagenUrl.startsWith("[")) {
      try {
        const parsed = JSON.parse(imagenUrl);
        return Array.isArray(parsed) ? parsed[0] : imagenUrl;
      } catch {
        return imagenUrl;
      }
    }
    return imagenUrl;
  }
  return null;
};

export function ProductDetailSheet({
  producto,
  children,
  userRole = "USER",
}: Readonly<ProductDetailSheetProps>) {
  const primeraImagen = obtenerPrimeraImagen(producto.imagen_url);
  const isAdmin = userRole === "ADMIN";
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();

    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const addItem = useCartStore((state) => state.addItem);
  const setCartOpen = useCartStore((state) => state.setIsOpen);

  const stockDisponible = producto.stock?.filter((s) => s.cantidad > 0) || [];

  // La tabla legacy `productos_stock` no tiene columna de precio: buscamos
  // el precio propio de la variante por nombre en `producto_variantes`
  // (misma fuente que ya usa stock-table.tsx), y si no está seteado (null =
  // hereda) o no hay match, caemos al precio del producto.
  const precioPorVariante = new Map(
    (producto.producto_variantes ?? []).map((v) => [
      v.nombre_display,
      v.precio,
    ]),
  );

  const [varianteSeleccionada, setVarianteSeleccionada] = useState<string>(
    stockDisponible.length > 0 ? stockDisponible[0].variante : "",
  );

  // `productos_stock` (de donde sale `stockDisponible`) se relaciona por
  // nombre de variante y no trae el id; el panel de números de serie sí lo
  // necesita, así que se resuelve contra producto_variantes por el mismo
  // nombre_display que ya usa el mapa de precios de arriba.
  const varianteSeleccionadaId =
    (producto.producto_variantes ?? []).find(
      (v) => v.nombre_display === varianteSeleccionada,
    )?.id ?? null;

  const handleAñadirAlCarrito = () => {
    if (!varianteSeleccionada) return;

    const stockDeVariante =
      stockDisponible.find((s) => s.variante === varianteSeleccionada)
        ?.cantidad || 0;

    // Necesitas asegurarte de que esta función obtenerPrimeraImagen esté definida o disponible
    const primeraImagen = obtenerPrimeraImagen(producto.imagen_url);

    addItem({
      productoId: producto.id,
      preciosPorCantidad: producto.precios_por_cantidad,
      nombre: producto.nombre,
      tipo: producto.tipo,
      variante: varianteSeleccionada,
      cantidad: 1,
      precio: precioPorVariante.get(varianteSeleccionada) ?? producto.precio,
      unidadMedida: producto.unidad_medida,
      imagenUrl: primeraImagen,
      stockMaximo: stockDeVariante,
    });

    setCartOpen(true);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={`overflow-y-auto px-4 sm:px-6 outline-none ${
          isMobile ? "max-h-[90vh] rounded-t-3xl pb-10" : "w-full sm:max-w-lg"
        }`}
      >
        {isMobile && (
          <div className="w-full flex justify-center pt-2 pb-4">
            <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full" />
          </div>
        )}

        <SheetHeader className="pb-4 border-b border-border/50 text-left mt-0">
          <SheetTitle className="text-xl flex items-center gap-2">
            <Leaf className="w-5 h-5 text-success" />
            Ficha del Producto
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-2 md:space-y-4 pt-1 md:pt-6 pb-1 md:pb-8">
          <div className="flex flex-col gap-4 items-start">
            <div className="w-24 h-24 sm:w-auto sm:h-64 rounded-xl bg-muted flex items-center justify-center overflow-hidden border border-border shrink-0 ">
              {primeraImagen ? (
                <Image
                  src={primeraImagen}
                  alt={producto.nombre}
                  width={112}
                  height={112}
                  className="object-cover w-full h-full"
                />
              ) : (
                <ImageIcon className="w-8 h-8 text-muted-foreground opacity-50" />
              )}
            </div>
            <div className="pt-1 w-full">
              <div className="flex items-center justify-between">
                <h3 className="text-xl sm:text-2xl font-semibold text-foreground leading-tight">
                  {producto.nombre}
                </h3>
                <div className="text-2xl font-semibold">
                  {formatearMoneda(producto.precio)}
                </div>
              </div>
              <div className="flex flex-col gap-2 mt-1">
                <div className="flex items-center">
                  <Badge
                    variant="secondary"
                    className="capitalize text-xs sm:text-sm"
                  >
                    {capitalizar(producto.tipo)}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5 pt-2">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-1.5 text-foreground uppercase tracking-wider">
                <AlignLeft className="w-4 h-4" />
                Descripción
              </h4>
              <div className="text-sm text-foreground bg-muted/40 p-4 rounded-xl border border-border/50 leading-relaxed min-h-30">
                {producto.descripcion ? (
                  <p className="whitespace-pre-wrap">{producto.descripcion}</p>
                ) : (
                  <p className="italic opacity-60">
                    No hay descripción detallada para este producto.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* SECCIÓN DE ACCIONES MÓVIL (Visible para todos) */}
          <div className="sm:hidden pt-6 mt-4 border-t border-border">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 text-foreground uppercase tracking-wider mb-4">
              <Zap className="w-4 h-4 text-warning" />
              Acciones
            </h4>

            <div className="flex flex-col gap-4">
              {/* Selector de variante y Botón de Venta (Para TODOS los usuarios) */}
              <div className="space-y-3 bg-muted/30 p-4 rounded-xl border border-border/50">
                {stockDisponible.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {stockDisponible.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setVarianteSeleccionada(s.variante)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                            varianteSeleccionada === s.variante
                              ? "bg-neutral-800 text-white border-neutral-800"
                              : "bg-background text-foreground border-border hover:bg-muted"
                          }`}
                        >
                          {s.variante} (Quedan {s.cantidad})
                        </button>
                      ))}
                    </div>
                    <Button
                      onClick={handleAñadirAlCarrito}
                      disabled={!varianteSeleccionada}
                      className="w-full h-12"
                    >
                      <ShoppingCart className="w-5 h-5 mr-2" />
                      Agregar al Carrito
                    </Button>
                  </>
                ) : (
                  <div className="text-center py-3 text-muted-foreground font-medium text-sm">
                    Producto sin stock disponible
                  </div>
                )}
              </div>

              {/* Trazabilidad por aparato. No renderiza nada si la variante
                  no tiene unidades serializadas. */}
              <UnidadesSeriePanel varianteId={varianteSeleccionadaId} />

              {/* Botones de Admin (Solo visibles si es ADMIN) */}
              {isAdmin && (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="flex justify-center w-full [&>button]:w-full">
                    <ProductEditDetailSheet producto={producto} />
                  </div>
                  <div className="flex justify-center w-full [&>button]:w-full">
                    <EliminarProductoModal
                      id={producto.id}
                      nombre={producto.nombre}
                      tipo={producto.tipo}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
