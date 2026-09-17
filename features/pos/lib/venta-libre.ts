import type { CartItemStore } from "@/entities/cart/types";

/**
 * Venta libre: cobrar algo que no está en el catálogo.
 *
 * La regla de esta base es que el precio lo pone el SERVER, nunca el
 * carrito. Acá no hay contra qué revalidarlo —el renglón no es ningún
 * producto—, así que lo que se valida es la FORMA: que sea un número, que sea
 * positivo, que no sea absurdo. Y se valida en los DOS lados con esta misma
 * función: el POS antes de agregar la línea y `create-sale.ts` antes de
 * registrarla. Un server action es un endpoint; lo que el botón no deja
 * tipear, un request armado a mano sí.
 */

export const DESCRIPCION_LIBRE_MAX = 120;

/** Un renglón libre a más de esto no es una venta de mostrador: es un
 * dedo de más en el cero. Se rechaza en vez de cobrarlo. */
export const PRECIO_LIBRE_MAX = 99_999_999;

/** Prefijo del id local. NO es un uuid a propósito: si alguna consulta lo
 * mete en un `.in("producto_id", …)` PostgREST rebota con "invalid input
 * syntax for type uuid" en vez de buscar en silencio un producto que no
 * existe. El server lo saca de la lista ANTES de consultar. */
export const PREFIJO_ID_LIBRE = "libre:";

export function esIdVentaLibre(productoId: string | null | undefined): boolean {
  return typeof productoId === "string" && productoId.startsWith(PREFIJO_ID_LIBRE);
}

export type VentaLibreValidada = {
  descripcion: string;
  precio: number;
};

export type ResultadoVentaLibre =
  | { ok: true; valor: VentaLibreValidada }
  | { ok: false; error: string };

/**
 * Normaliza y valida descripción + precio. Devuelve el error tal como se le
 * muestra a la vendedora: es el mismo texto en el input y en el toast del
 * server, para que no haya dos formas de decir lo mismo.
 */
export function validarVentaLibre(entrada: {
  descripcion: unknown;
  precio: unknown;
}): ResultadoVentaLibre {
  const descripcion =
    typeof entrada.descripcion === "string"
      ? entrada.descripcion.trim().replace(/\s+/g, " ")
      : "";

  if (!descripcion) {
    return { ok: false, error: "Escribí qué estás cobrando." };
  }
  if (descripcion.length > DESCRIPCION_LIBRE_MAX) {
    return {
      ok: false,
      error: `La descripción no puede pasar los ${DESCRIPCION_LIBRE_MAX} caracteres.`,
    };
  }

  const precioCrudo =
    typeof entrada.precio === "string"
      ? Number(entrada.precio.replace(",", "."))
      : Number(entrada.precio);

  if (!Number.isFinite(precioCrudo) || precioCrudo <= 0) {
    return { ok: false, error: "Poné un precio mayor a cero." };
  }
  if (precioCrudo > PRECIO_LIBRE_MAX) {
    return { ok: false, error: "Ese precio es demasiado alto. Revisalo." };
  }

  // Al centavo. Sumar pesos en binario deja colas (0,1 + 0,2 = 0,30000000000000004)
  // que llegarían al total del ticket.
  const precio = Math.round(precioCrudo * 100) / 100;

  return { ok: true, valor: { descripcion, precio } };
}

/**
 * La línea del carrito. `nombre` y `variante` llevan la misma descripción:
 * el carrito identifica una línea por `productoId|variante`, así que dos
 * ventas libres con distinta descripción tienen que ser dos líneas, y con la
 * MISMA descripción y el mismo precio se suman como cantidad. El id local
 * lleva el precio adentro por eso: "Globos x12" a $500 y "Globos x12" a $600
 * son dos renglones distintos, no uno de dos unidades.
 */
export function crearLineaVentaLibre(
  valor: VentaLibreValidada,
  cantidad = 1,
): CartItemStore {
  return {
    productoId: `${PREFIJO_ID_LIBRE}${valor.precio}`,
    nombre: valor.descripcion,
    tipo: "Venta libre",
    variante: valor.descripcion,
    precio: valor.precio,
    precioBase: valor.precio,
    costoBase: 0,
    cantidad,
    unidadMedida: "UNIDAD",
    imagenUrl: null,
    // El tope lo pone el catálogo, y acá no hay catálogo.
    stockMaximo: Number.MAX_SAFE_INTEGER,
    ventaLibre: true,
  };
}
