"use client";

import { Producto } from "@/entities/productos/types";
import { ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useLinkCatalogo } from "@/shared/lib/use-negocio";
import { PrecioConDescuento } from "./precio-con-descuento";

interface ProductCardProps {
  producto: Producto;
  priority?: boolean;
  origenCarrito?: boolean;
}

const getImagenesProducto = (imagenUrl: Producto["imagen_url"]) => {
  if (Array.isArray(imagenUrl)) return imagenUrl;
  if (typeof imagenUrl !== "string") return [];

  try {
    const parsed = JSON.parse(imagenUrl);
    return Array.isArray(parsed) ? parsed : [imagenUrl];
  } catch {
    return [imagenUrl];
  }
};

export function ProductCard({
  producto,
  priority = false,
  origenCarrito = false,
}: Readonly<ProductCardProps>) {
  const primeraImagen =
    getImagenesProducto(producto.grid_url)[0] ||
    getImagenesProducto(producto.imagen_url)[0] ||
    null;
  // El link es al catálogo del negocio que se está viendo: fuera de un
  // catálogo no hay tienda a la que ir.
  const linkCatalogo = useLinkCatalogo();
  const linkDestino = producto.slug ? `${linkCatalogo(producto.slug)}${origenCarrito ? "?origen=sugerencia-carrito" : ""}` : "#";

  return (
    <div
      key={producto.id}
      className="group relative flex flex-col transition-all"
    >
      <Link
        href={linkDestino}
        className="aspect-[4/5] bg-card relative overflow-hidden flex items-center justify-center w-full border border-border/40"
      >
        {primeraImagen ? (
          <div className="relative w-full h-full overflow-hidden">
            <Image
              src={primeraImagen}
              alt={producto.nombre || "Producto"}
              fill
              className="object-cover hover:scale-105 transition-transform duration-500"
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 20vw"
              priority={priority}
            />
          </div>
        ) : (
          <ShoppingBag
            className="w-10 h-10 text-muted-foreground/20"
            strokeWidth={1}
          />
        )}
      </Link>

      <div className="pt-4 flex flex-col">
        <Link href={linkDestino}>
          <h3 className="font-semibold text-foreground text-sm uppercase tracking-wide truncate">
            {producto.nombre || "Sin nombre"}
          </h3>
        </Link>
        <div className="mt-1">
          <PrecioConDescuento
            precio={producto.precio || 0}
            categoria={producto.tipo}
            classNamePrecio="text-sm font-bold text-foreground"
          />
        </div>
      </div>
    </div>
  );
}
