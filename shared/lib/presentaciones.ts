import { normalizarUnidadMedida } from "./fiscal-producto";
import {
  DECIMALES_CANTIDAD,
  esFraccionable,
  normalizarCantidadVendible,
  redondearCantidad,
} from "./unidad-venta";

/**
 * Presentaciones comerciales: UN stock, varias formas de venderlo.
 *
 * Una presentación ("Balde 4,7 kg", "Pack x10") dice cuántas unidades del
 * stock de la variante consume una venta (`factor`) y a qué precio se vende.
 * NO tiene stock propio: lo que hay de una presentación es
 * `floor(stock / factor)`, derivado. La unidad base del producto es la
 * presentación implícita con factor 1 y no es una fila.
 *
 * Este módulo es la autoridad en TypeScript de tres cosas que la base también
 * decide, y los dos lados tienen que decir lo mismo (mismo criterio que
 * `temporada-categoria.ts` contra `categoria_en_temporada`):
 *
 *   - la conversión `cantidad_base()` ↔ `public.cantidad_base(numeric, numeric)`
 *   - la regla del factor entero ↔ trigger `producto_presentaciones_validar`
 *   - la regla de precio FIJO / HEREDADO ↔ el CHECK `producto_presentaciones_precio_fijo`
 *
 * EL FACTOR NO DERIVA EL PRECIO. Un balde a $12.000/kg no vale $56.400 salvo
 * que la presentación diga HEREDADO, que es una decisión explícita.
 */

export const REGLAS_PRECIO_PRESENTACION = ["FIJO", "HEREDADO"] as const;
export type ReglaPrecioPresentacion =
  (typeof REGLAS_PRECIO_PRESENTACION)[number];

export function normalizarReglaPrecio(valor: unknown): ReglaPrecioPresentacion {
  return REGLAS_PRECIO_PRESENTACION.includes(valor as ReglaPrecioPresentacion)
    ? (valor as ReglaPrecioPresentacion)
    : "FIJO";
}

/** La fila tal como la traen el catálogo del panel y la ficha del producto. */
export interface Presentacion {
  id: string;
  producto_id?: string;
  /** null = aplica a todas las variantes del producto. */
  variante_id: string | null;
  nombre: string;
  factor: number;
  regla_precio: ReglaPrecioPresentacion | string;
  precio: number | null;
  /** NO viene por el catálogo público. */
  costo?: number | null;
  sku: string | null;
  es_default: boolean;
  visible_catalogo?: boolean;
  activa: boolean;
  orden?: number;
}

/** Lo que edita la ficha y viaja a la action. `id` ausente = fila nueva. */
export interface PresentacionInput {
  id?: string;
  variante_id: string | null;
  nombre: string;
  factor: number;
  regla_precio: ReglaPrecioPresentacion;
  precio: number | null;
  costo: number | null;
  sku: string | null;
  es_default: boolean;
  visible_catalogo: boolean;
  activa: boolean;
  orden: number;
}

/**
 * cantidad_stock = cantidad_presentacion × factor, a la resolución del stock.
 * Espejo de `public.cantidad_base`.
 */
export function cantidadBase(cantidadPresentacion: number, factor: number): number {
  return redondearCantidad(cantidadPresentacion * factor);
}

/**
 * Cuántas presentaciones ENTERAS se pueden vender con el stock que hay. Es lo
 * que se muestra como "disponibles" de una presentación; nunca se guarda.
 */
export function presentacionesDisponibles(stock: number, factor: number): number {
  if (!Number.isFinite(stock) || !Number.isFinite(factor) || factor <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(redondearCantidad(stock) / factor + 1e-9));
}

/**
 * Cantidad válida para vender o ingresar en esta forma. Con presentación se
 * exige ENTERO —una presentación es discreta, medio balde no existe— y la
 * fracción vive solo en la unidad base de un producto fraccionable. Devuelve
 * la cantidad en la unidad en que se tipeó (presentaciones o base), o null.
 */
export function normalizarCantidadEnForma(
  valor: unknown,
  unidad: unknown,
  presentacion: { factor: number } | null,
): number | null {
  if (!presentacion) return normalizarCantidadVendible(valor, unidad);
  // "UNIDAD" fuerza entero por la regla de siempre; el techo y el resto de
  // los rechazos son los mismos.
  const entera = normalizarCantidadVendible(valor, "UNIDAD");
  if (entera === null) return null;
  // Y la conversión no puede quedar en cero por redondeo (factor 0,0001).
  return cantidadBase(entera, presentacion.factor) > 0 ? entera : null;
}

/**
 * Precio de UNA presentación. `precioBase` es el precio efectivo de la
 * variante en la unidad base (ya resuelto por `precioBaseDeVariante` y, si
 * corresponde, por la lista). Con FIJO la lista NO aplica: el precio de la
 * presentación es un número que alguien fijó, no una regla.
 */
export function precioDePresentacion(
  presentacion: Pick<Presentacion, "regla_precio" | "precio" | "factor">,
  precioBase: number,
): number | null {
  const regla = normalizarReglaPrecio(presentacion.regla_precio);
  if (regla === "FIJO") {
    const fijo = Number(presentacion.precio);
    return Number.isFinite(fijo) && fijo > 0 ? fijo : null;
  }
  const base = Number(precioBase);
  if (!Number.isFinite(base) || base <= 0) return null;
  return Math.round(base * presentacion.factor);
}

/** El costo por unidad BASE que congela el renglón de venta. */
export function costoBaseDePresentacion(
  presentacion: Pick<Presentacion, "costo" | "factor">,
  costoBase: number,
): number {
  const propio = Number(presentacion.costo);
  if (Number.isFinite(propio) && propio > 0 && presentacion.factor > 0) {
    return Number((propio / presentacion.factor).toFixed(4));
  }
  return Number.isFinite(costoBase) ? costoBase : 0;
}

export type ErrorPresentacion =
  | "NOMBRE_VACIO"
  | "FACTOR_INVALIDO"
  | "FACTOR_ENTERO"
  | "PRECIO_FIJO_INVALIDO"
  | "COSTO_NEGATIVO"
  | "NOMBRE_DUPLICADO"
  | "SKU_DUPLICADO"
  | "DEFAULT_DUPLICADA";

/**
 * Valida el conjunto de presentaciones de un producto tal como lo va a
 * guardar la action. Espejo de los CHECK e índices únicos de la tabla, para
 * que el error tenga nombre y fila ANTES de viajar y no como un 23505.
 */
export function validarPresentaciones(
  presentaciones: PresentacionInput[],
  unidadMedida: unknown,
): { indice: number; error: ErrorPresentacion }[] {
  const errores: { indice: number; error: ErrorPresentacion }[] = [];
  const fraccionable = esFraccionable(normalizarUnidadMedida(unidadMedida));
  const nombresVistos = new Map<string, number>();
  const skusVistos = new Map<string, number>();
  const defaultsVistos = new Set<string>();

  presentaciones.forEach((p, indice) => {
    const alcance = p.variante_id ?? "";
    const nombre = p.nombre.trim().toLowerCase();

    if (!nombre) errores.push({ indice, error: "NOMBRE_VACIO" });

    if (!Number.isFinite(p.factor) || p.factor <= 0) {
      errores.push({ indice, error: "FACTOR_INVALIDO" });
    } else if (!fraccionable && !Number.isInteger(p.factor)) {
      errores.push({ indice, error: "FACTOR_ENTERO" });
    } else if (redondearCantidad(p.factor) !== p.factor) {
      errores.push({ indice, error: "FACTOR_INVALIDO" });
    }

    if (
      p.regla_precio === "FIJO" &&
      (p.precio === null || !Number.isFinite(p.precio) || p.precio <= 0)
    ) {
      errores.push({ indice, error: "PRECIO_FIJO_INVALIDO" });
    }

    if (p.costo !== null && (!Number.isFinite(p.costo) || p.costo < 0)) {
      errores.push({ indice, error: "COSTO_NEGATIVO" });
    }

    const claveNombre = `${alcance}|${nombre}`;
    if (nombre && nombresVistos.has(claveNombre)) {
      errores.push({ indice, error: "NOMBRE_DUPLICADO" });
    } else {
      nombresVistos.set(claveNombre, indice);
    }

    const sku = p.sku?.trim() ?? "";
    if (sku) {
      if (skusVistos.has(sku)) errores.push({ indice, error: "SKU_DUPLICADO" });
      else skusVistos.set(sku, indice);
    }

    if (p.es_default && p.activa) {
      if (defaultsVistos.has(alcance)) {
        errores.push({ indice, error: "DEFAULT_DUPLICADA" });
      } else {
        defaultsVistos.add(alcance);
      }
    }
  });

  return errores;
}

export const MENSAJE_ERROR_PRESENTACION: Record<ErrorPresentacion, string> = {
  NOMBRE_VACIO: "La presentación necesita un nombre.",
  FACTOR_INVALIDO: `El factor tiene que ser mayor a 0 (hasta ${DECIMALES_CANTIDAD} decimales).`,
  FACTOR_ENTERO:
    "Este producto se vende por unidad: el factor tiene que ser entero.",
  PRECIO_FIJO_INVALIDO: "Con precio fijo, el precio tiene que ser mayor a 0.",
  COSTO_NEGATIVO: "El costo no puede ser negativo.",
  NOMBRE_DUPLICADO: "Ya hay una presentación con ese nombre.",
  SKU_DUPLICADO: "Ese código ya está en otra presentación.",
  DEFAULT_DUPLICADA: "Solo una presentación puede ser la predeterminada.",
};

/**
 * Las presentaciones que aplican a UNA variante: las suyas y las del producto
 * entero, con la específica ganando cuando comparten nombre. Solo activas.
 */
export function presentacionesDeVariante(
  presentaciones: readonly Presentacion[] | null | undefined,
  varianteId: string | null | undefined,
): Presentacion[] {
  if (!presentaciones?.length) return [];
  const porNombre = new Map<string, Presentacion>();
  for (const p of presentaciones) {
    if (!p.activa) continue;
    if (p.variante_id !== null && p.variante_id !== varianteId) continue;
    const clave = p.nombre.trim().toLowerCase();
    const previa = porNombre.get(clave);
    if (!previa || (previa.variante_id === null && p.variante_id !== null)) {
      porNombre.set(clave, p);
    }
  }
  return [...porNombre.values()].sort(
    (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.factor - b.factor,
  );
}

/**
 * Lo que una línea del carrito guarda de cada presentación: lo justo para
 * cambiar de forma y re-preciar sin volver al catálogo (el ticket no lo
 * recibe, a propósito). Sin costo ni sku.
 */
export type PresentacionCarrito = Pick<
  Presentacion,
  "id" | "nombre" | "factor" | "regla_precio" | "precio"
>;

export function aPresentacionCarrito(p: Presentacion): PresentacionCarrito {
  return {
    id: p.id,
    nombre: p.nombre,
    factor: Number(p.factor),
    regla_precio: p.regla_precio,
    precio: p.precio == null ? null : Number(p.precio),
  };
}

/**
 * El precio de UNA línea en la forma en que se vende: por presentación si la
 * hay, por unidad base si no. `precioBase` es el precio por unidad base ya
 * resuelto (con lista, si corresponde). Si la presentación no tiene precio
 * cae al base × factor como último recurso visible: el server la rechaza
 * igual, y acá lo que importa es no mostrar $0.
 */
export function precioEnForma(
  precioBase: number,
  presentacion: PresentacionCarrito | null | undefined,
): number {
  if (!presentacion) return precioBase;
  return (
    precioDePresentacion(presentacion, precioBase) ??
    Math.round(precioBase * presentacion.factor)
  );
}

/**
 * Tope de cantidad de una línea en su forma: el stock (en base) entra entero
 * en la unidad base, y en presentaciones alcanza para `floor(stock / factor)`.
 */
export function topeCantidadEnForma(
  stockMaximo: number,
  presentacion: { factor: number } | null | undefined,
): number {
  if (!presentacion) return stockMaximo;
  return presentacionesDisponibles(stockMaximo, presentacion.factor);
}

/** La default de esa variante, si hay. Sin default se vende la unidad base. */
export function presentacionDefault(
  presentaciones: readonly Presentacion[] | null | undefined,
  varianteId: string | null | undefined,
): Presentacion | null {
  return (
    presentacionesDeVariante(presentaciones, varianteId).find(
      (p) => p.es_default,
    ) ?? null
  );
}
