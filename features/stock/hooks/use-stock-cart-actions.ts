"use client";

import { toast } from "sonner";
import type { Producto } from "@/entities/productos/types";
import { useCartStore } from "@/shared/store/cart-store";
import {
  obtenerPrimeraImagen,
  puedeVenderStock,
} from "../lib/stock-product-utils";

export function useStockCartActions(userRole: string) {
  const addItem = useCartStore((state) => state.addItem);
  const setIsOpen = useCartStore((state) => state.setIsOpen);
  const isAdmin = userRole === "ADMIN";

  const agregarAlCarrito = (
    producto: Producto,
    variante: string,
    stockMax: number,
  ) => {
    if (!puedeVenderStock(stockMax, isAdmin)) {
      toast.error("No hay stock suficiente.");
      return false;
    }

    // La variante llega como nombre; buscamos su precio propio en
    // producto_variantes (null = hereda del producto) antes de caer al
    // precio del producto.
    const varianteData = producto.producto_variantes?.find(
      (v) => v.nombre_display === variante,
    );

    addItem({
      productoId: producto.id,
      preciosPorCantidad: producto.precios_por_cantidad,
      nombre: producto.nombre,
      tipo: producto.tipo,
      variante,
      varianteId: varianteData?.id,
      cantidad: 1,
      precio: varianteData?.precio ?? producto.precio,
      unidadMedida: producto.unidad_medida,
      imagenUrl: obtenerPrimeraImagen(producto.imagen_url),
      stockMaximo: stockMax,
    });
    setIsOpen(true);
    return true;
  };

  return {
    isAdmin,
    agregarAlCarrito,
  };
}
