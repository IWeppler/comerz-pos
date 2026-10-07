import type { Rubro } from "@/entities/config/types";
import type { ItemResuelto } from "@/entities/compras/types";
import { normalizar } from "./category-suggestions";
import { inferirCategoriaFila } from "./inferir-categoria-fila";
import type { CategoriaReal } from "./resolve-import-categoria";

/**
 * Una línea del remito dentro de su grupo: una combinación concreta
 * (talle/color) con su cantidad.
 */
export type LineaCarga = {
  itemId: string;
  variante: string;
  cantidad: number;
  /** IMEI completados en pantalla para los aparatos de la línea que vinieron
   * sin número. Opcional: los borradores de antes no lo tienen. */
  imeis?: string[];
};

/** Una fila de la tabla del modo carga inicial = un producto a crear. */
export type FilaCargaInicial = {
  /** Clave estable de la fila (identidad del grupo). */
  key: string;
  rawNombre: string;
  lineas: LineaCarga[];
  /** Campos editables, ya prellenados. */
  nombre: string;
  categoriaId: string | null;
  /** Nombre de una categoría que todavía no existe en el comercio. Se crea
   * al confirmar, y solo si la persona la dejó puesta. */
  categoriaNombreNueva: string | null;
  marca: string;
  costo: number;
  precio: number;
  /** Solo informativo: de dónde salió la categoría, para poder marcar en la
   * fila las que se van a crear. */
  origenCategoria: string;
  /** Género tal como vino del remito. No se edita: hoy el sistema no lo
   * guarda en el producto (solo sobrevive como atributo en Ropa Bebé), así
   * que mostrarlo editable prometería algo que no se cumple. */
  genero: string | null;
  /** Producto existente al que ya está vinculada la fila: match del import o
   * creación ya confirmada. Con esto la fila no se vuelve a crear. */
  productoId: string | null;
  /** El import ya la reconoció contra el catálogo. Estas filas no se crean:
   * solo suman stock. */
  yaExistia: boolean;
};

/**
 * Identidad de un grupo. Incluye MARCA y GÉNERO, no solo el nombre.
 *
 * La pantalla vieja agrupa solo por `raw_nombre`, y eso funde productos
 * distintos: en el remito real del comercio nuevo, "babucha rustica" viene de
 * Bingo Fuel para bebé y de Cocos para beba, y "bermuda chino" viene para
 * nene y para hombre. Con la clave vieja son un producto; con esta, dos.
 * Pasa en 4 de 94 grupos ahí y en 32 de 1.309 en Estilo Bonito.
 */
export function claveDeGrupo(item: {
  raw_nombre: string;
  raw_marca?: string | null;
  raw_genero?: string | null;
}): string {
  return [
    normalizar(item.raw_nombre.trim()),
    normalizar((item.raw_marca ?? "").trim()),
    normalizar((item.raw_genero ?? "").trim()),
  ].join("|");
}

/** Precio de venta sugerido para la fila: lo que dijo el proveedor si vino,
 * y si no el costo por el recargo. Nunca 0 cuando hay costo — "Esperando
 * asignación" era la pantalla diciendo que no sabía algo que sí podía
 * calcular. */
export function precioSugerido(
  costo: number,
  precioDelProveedor: number | null | undefined,
  recargoPorcentaje: number,
): number {
  if (precioDelProveedor && precioDelProveedor > 0) return precioDelProveedor;
  if (costo > 0) return Math.ceil(costo * (1 + recargoPorcentaje / 100));
  return 0;
}

/**
 * Arma las filas de la tabla a partir de los ítems del remito.
 *
 * Todo llega prellenado con lo que se pudo inferir: nombre del remito, marca
 * y género que ya venían en columnas propias, categoría inferida contra el
 * árbol del comercio (o propuesta para crear), costo del remito y precio
 * calculado. La persona corrige, no completa desde cero.
 */
export function construirFilasCargaInicial({
  items,
  categorias,
  rubro,
  recargoPorcentaje,
}: {
  items: ItemResuelto[];
  categorias: CategoriaReal[];
  rubro: Rubro;
  recargoPorcentaje: number;
}): FilaCargaInicial[] {
  const grupos = new Map<string, ItemResuelto[]>();
  for (const item of items) {
    const clave = claveDeGrupo(item);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(item);
  }

  return Array.from(grupos.entries()).map(([key, delGrupo]) => {
    const primero = delGrupo[0];

    // El costo del grupo es el primero que no sea 0: en el remito del
    // comercio nuevo TODAS las líneas vienen en 0 (la planilla traía precio
    // de venta, no costo), y en los remitos de proveedor el costo se repite
    // en todas las líneas del mismo producto.
    const costo =
      delGrupo.find((i) => Number(i.precio_costo) > 0)?.precio_costo ?? 0;

    const sugeridoProveedor =
      delGrupo.find((i) => Number(i.precio_venta_sugerido) > 0)
        ?.precio_venta_sugerido ?? null;

    const inferida = inferirCategoriaFila({
      rawNombre: primero.raw_nombre,
      rawCategoria: primero.raw_categoria ?? null,
      rawCategoriaId: primero.raw_categoria_id ?? null,
      rawGenero: primero.raw_genero ?? null,
      categorias,
      rubro,
    });

    return {
      key,
      rawNombre: primero.raw_nombre,
      lineas: delGrupo.map((i) => ({
        itemId: i.id ?? "",
        variante: i.raw_variante || "Unico",
        cantidad: Number(i.cantidad) || 0,
      })),
      nombre: primero.raw_nombre.trim(),
      categoriaId: inferida.categoriaId,
      categoriaNombreNueva:
        inferida.origen === "NUEVA" ? inferida.nombre : null,
      // La de la planilla manda; si no vino, la deducida del nombre (electro).
      marca: primero.raw_marca?.trim() || primero.marca_inferida || "",
      costo: Number(costo) || 0,
      precio: precioSugerido(
        Number(costo) || 0,
        sugeridoProveedor,
        recargoPorcentaje,
      ),
      origenCategoria: inferida.origen,
      genero: primero.raw_genero ?? null,
      productoId: primero.producto_id,
      yaExistia: primero.estado_match !== "DESCONOCIDO",
    };
  });
}

/** Unidades totales de una fila. */
export function unidadesDeFila(fila: FilaCargaInicial): number {
  return fila.lineas.reduce((total, l) => total + l.cantidad, 0);
}

/**
 * Convierte las filas editadas de vuelta a los ítems que consume
 * `aprobarOrdenAction`. Cada línea del remito se lleva el producto, el costo
 * y el precio de SU fila — la cantidad puede haberse corregido en pantalla.
 */
export function filasAItems(
  filas: FilaCargaInicial[],
  itemsOriginales: ItemResuelto[],
  productosPorRawNombre: Record<string, string> = {},
): ItemResuelto[] {
  const porItemId = new Map<
    string,
    { fila: FilaCargaInicial; linea: LineaCarga }
  >();
  for (const fila of filas) {
    for (const linea of fila.lineas) {
      porItemId.set(linea.itemId, { fila, linea });
    }
  }

  return itemsOriginales.map((item) => {
    const encontrado = item.id ? porItemId.get(item.id) : undefined;
    if (!encontrado) return item;

    const { fila, linea } = encontrado;
    const productoId =
      fila.productoId ?? productosPorRawNombre[fila.rawNombre] ?? null;

    return {
      ...item,
      producto_id: productoId,
      cantidad: linea.cantidad,
      imeis_completados: linea.imeis ?? [],
      precio_costo: fila.costo,
      precio_venta_actualizado: fila.precio,
      estado_match:
        item.estado_match === "DESCONOCIDO" && productoId
          ? "NUEVO_ALIAS"
          : item.estado_match,
    };
  });
}
