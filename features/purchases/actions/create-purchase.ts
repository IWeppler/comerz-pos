"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { traerTodo } from "@/shared/lib/traer-todo";
import { hashRemitoProveedor } from "../lib/hash-remito";
import {
  resolverCategoriaImport,
  mapGeneroRopaBebe,
  type CategoriaReal,
} from "../lib/resolve-import-categoria";

export type RawOrderItem = {
  raw_nombre: string;
  raw_variante: string;
  cantidad: number;
  precio_costo: number;
  /** Precio al público sugerido por el proveedor. null = la planilla no lo
   * trae; 0 sería "vender a $0" y pisaría el precio actual del producto. */
  precio_venta?: number | null;
  raw_categoria?: string | null;
  raw_genero?: string | null;
  raw_sku?: string | null;
  raw_marca?: string | null;
  /** Número de serie de ESTA línea. Lo trae la planilla propia de electro
   * (un aparato por fila); la planilla de un proveedor casi nunca. Viaja
   * hasta `aprobar_orden_compra`, que crea la fila en `unidades_serie`. */
  raw_imei?: string | null;
};

/** Agrega el género (vocabulario cerrado Ropa Bebé) al string de atributos
 * "libres" que ya viene armado (talle, color, etc.) — mismo formato
 * "Nombre: Valor / Nombre: Valor" que parsea parseVarianteAtributos en
 * merge-purchase.ts. */
function conGeneroAgregado(rawVariante: string, generoValor: string): string {
  const base = rawVariante && rawVariante !== "Unico" ? rawVariante : "";
  const segmento = `Género: ${generoValor}`;
  return base ? `${base} / ${segmento}` : segmento;
}

export interface RemitoDuplicado {
  ordenId: string;
  estado: string;
  creadoEn: string;
  proveedor: string;
}

export async function procesarPedidoAction(
  proveedor: string,
  items: RawOrderItem[],
  /**
   * Subir igual un archivo que ya se había subido. Es una decisión de la
   * persona —el proveedor mandó dos veces la misma mercadería— así que el
   * remito forzado queda SIN huella: no participa del guard ni contra los que
   * vengan después. Mismo criterio que `p_forzar` en la importación de
   * planilla, resuelto sin columna nueva.
   */
  forzar = false,
  /** A quién se le compró (`proveedores`). `proveedor` es el nombre del
   * ingreso, no el proveedor. La FK compuesta impide uno de otro negocio. */
  proveedorId: string | null = null,
) {
  console.log(">>> [SERVER ACTION] 1. Iniciando procesarPedidoAction...");
  console.log(
    `>>> [SERVER ACTION] 2. Proveedor: ${proveedor}, Items a procesar: ${items?.length}`,
  );

  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    console.log(">>> [SERVER ACTION] 3. Verificando sesión...");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error(
        ">>> [SERVER ACTION] ERROR: Usuario no autenticado",
        authError,
      );
      return {
        success: false,
        error: "No autorizado. Inicia sesión nuevamente.",
      };
    }

    if (!proveedor || !items || items.length === 0) {
      console.warn(">>> [SERVER ACTION] WARN: Faltan datos.");
      return { success: false, error: "Faltan datos para procesar el pedido." };
    }

    console.log(">>> [SERVER ACTION] 4. Calculando presupuesto total...");
    const total_presupuestado = items.reduce(
      (acc, item) =>
        acc + Number(item.cantidad || 0) * Number(item.precio_costo || 0),
      0,
    );
    console.log(
      ">>> [SERVER ACTION] Total presupuestado:",
      total_presupuestado,
    );

    console.log(
      ">>> [SERVER ACTION] 5. Insertando cabecera de orden_compra...",
    );
    // Huella del contenido. El unique parcial que ya existe
    // (`uq_ordenes_compra_hash_planilla`, por negocio y solo donde el hash no
    // es null) hace el trabajo: no hace falta migración, solo dejar de
    // escribir null. Ver `hash-remito.ts` para lo que costó no tenerlo.
    const hashPlanilla = forzar ? null : hashRemitoProveedor(items);

    const { data: orden, error: errorOrden } = await supabase
      .from("ordenes_compra")
      .insert({
        proveedor,
        fecha_remito: new Date().toISOString(),
        total_presupuestado: isNaN(total_presupuestado)
          ? 0
          : total_presupuestado,
        estado: "PENDIENTE",
        hash_planilla: hashPlanilla,
        proveedor_id: proveedorId,
      })
      .select("id")
      .single();

    // 23505 = unique_violation: este mismo archivo ya se subió. NO es un error
    // para la persona: es la respuesta correcta, y lo único útil que se puede
    // hacer con ella es llevarla al remito que ya existe. Se devuelve con su
    // estado, porque "ya lo subiste y está pendiente" y "ya lo subiste y el
    // stock entró" son dos situaciones muy distintas.
    if (errorOrden?.code === "23505" && hashPlanilla) {
      const { data: existente } = await supabase
        .from("ordenes_compra")
        .select("id, estado, creado_en, proveedor")
        .eq("hash_planilla", hashPlanilla)
        .maybeSingle();

      if (existente) {
        console.warn(
          `>>> [SERVER ACTION] Remito duplicado: mismo contenido que ${existente.id} (${existente.estado}).`,
        );
        return {
          success: false,
          duplicado: {
            ordenId: existente.id as string,
            estado: existente.estado as string,
            creadoEn: existente.creado_en as string,
            proveedor: existente.proveedor as string,
          } satisfies RemitoDuplicado,
          error:
            "Este archivo ya se subió antes. Abrí el remito que ya existe o subilo igual si es mercadería nueva.",
        };
      }
    }

    if (errorOrden || !orden) {
      console.error(
        ">>> [SERVER ACTION] ERROR BD ORDEN:",
        JSON.stringify(errorOrden, null, 2),
      );
      return {
        success: false,
        error:
          "Error guardando cabecera: " + (errorOrden?.message || "Desconocido"),
      };
    }

    console.log(
      `>>> [SERVER ACTION] 6. Cabecera creada (ID: ${orden.id}). Buscando historial de productos...`,
    );

    const [
      { data: productos, error: prodError },
      { data: diccionario, error: dicError },
      { data: categoriasReales, error: catError },
    ] = await Promise.all([
      // Paginados: es el historial contra el que se matchean los nombres del
      // proveedor. Truncado, un producto que existe no se reconoce y el remito
      // lo da de alta de nuevo. `diccionario_alias` de Evens ya pasó las 1.000
      // filas, así que también entraba en el corte.
      traerTodo("remito: productos", (desde, hasta) =>
        supabase
          .from("productos")
          .select("id, nombre, precio_costo", { count: "exact" })
          .range(desde, hasta),
      ),
      traerTodo("remito: alias", (desde, hasta) =>
        supabase
          .from("diccionario_alias")
          .select("raw_nombre, producto_id", { count: "exact" })
          .eq("proveedor", proveedor)
          .range(desde, hasta),
      ),
      traerTodo("remito: categorías", (desde, hasta) =>
        supabase
          .from("categorias")
          .select("id, nombre, slug, parent_id", { count: "exact" })
          .range(desde, hasta),
      ),
    ]);

    if (catError) {
      console.error(
        ">>> [SERVER ACTION] WARN: Error al buscar categorías:",
        catError,
      );
      await supabase.from("ordenes_compra").delete().eq("id", orden.id);
      return {
        success: false,
        error: "Error buscando categorías existentes: " + catError,
      };
    }

    if (prodError) {
      console.error(
        ">>> [SERVER ACTION] WARN: Error al buscar productos:",
        prodError,
      );
      await supabase.from("ordenes_compra").delete().eq("id", orden.id);
      return {
        success: false,
        error: "Error buscando productos existentes: " + prodError,
      };
    }

    if (dicError) {
      console.error(
        ">>> [SERVER ACTION] WARN: Error al buscar diccionario:",
        dicError,
      );
      await supabase.from("ordenes_compra").delete().eq("id", orden.id);
      return {
        success: false,
        error: "Error buscando alias del proveedor: " + dicError,
      };
    }

    console.log(
      `>>> [SERVER ACTION] 7. Mapeando ${items.length} items para insertar...`,
    );
    const categoriasParaResolver: CategoriaReal[] = categoriasReales || [];
    const itemsProcesados = items.map((item) => {
      let estado_match = "DESCONOCIDO";
      let producto_id = null;

      // Resolución de categoría contra el árbol REAL — nunca "primera
      // palabra pluralizada" ni auto-creación acá. Si no resuelve con
      // confianza, queda sin categoría para elegir a mano en la
      // conciliación (ver resolverCategoriaImport).
      const resolucion = resolverCategoriaImport(
        item.raw_nombre,
        item.raw_categoria ?? null,
        item.raw_genero ?? null,
        categoriasParaResolver,
      );

      const rawCategoriaResuelta = resolucion?.categoriaNombre ?? null;
      const rawCategoriaIdResuelta = resolucion?.categoriaId ?? null;
      // El género solo sobrevive como atributo de variante si la fila
      // resolvió a una subcategoría de Ropa Bebé — para el resto fue
      // solo señal de desambiguación y se descarta acá.
      const rawVarianteConGenero = resolucion?.esRopaBebe
        ? conGeneroAgregado(
            item.raw_variante?.trim() || "Unico",
            mapGeneroRopaBebe(item.raw_genero ?? null),
          )
        : item.raw_variante?.trim() || "Unico";

      const nombreLimpioExcel = item.raw_nombre?.trim().toLowerCase() || "";
      const aliasMatch = diccionario?.find(
        (a) => a.raw_nombre?.trim().toLowerCase() === nombreLimpioExcel,
      );

      if (aliasMatch) {
        producto_id = aliasMatch.producto_id;
      } else {
        const exactMatch = productos?.find(
          (p) => p.nombre?.trim().toLowerCase() === nombreLimpioExcel,
        );
        if (exactMatch) producto_id = exactMatch.id;
      }

      if (producto_id) {
        const productoReal = productos?.find((p) => p.id === producto_id);
        if (productoReal) {
          if (
            item.precio_costo > 0 &&
            item.precio_costo > Number(productoReal.precio_costo || 0)
          ) {
            estado_match = "MODIFICADO";
          } else {
            estado_match = "PERFECTO";
          }
        }
      }

      return {
        orden_id: orden.id,
        raw_nombre: item.raw_nombre?.trim() || "Desconocido",
        raw_variante: rawVarianteConGenero,
        raw_categoria: rawCategoriaResuelta,
        raw_categoria_id: rawCategoriaIdResuelta,
        raw_sku: item.raw_sku?.trim() || null,
        raw_marca: item.raw_marca?.trim() || null,
        raw_genero: item.raw_genero?.trim() || null,
        raw_imei: item.raw_imei?.trim() || null,
        cantidad: isNaN(Number(item.cantidad)) ? 0 : Number(item.cantidad),
        precio_costo: isNaN(Number(item.precio_costo))
          ? 0
          : Number(item.precio_costo),
        // Se guarda como SUGERIDO: el precio que termina en productos.precio
        // es el que se aprueba en la conciliación, no este.
        precio_venta_sugerido:
          item.precio_venta === null ||
          item.precio_venta === undefined ||
          isNaN(Number(item.precio_venta)) ||
          Number(item.precio_venta) <= 0
            ? null
            : Number(item.precio_venta),
        estado_match,
        producto_id,
        variante_match: producto_id ? rawVarianteConGenero : null,
      };
    });

    console.log(
      ">>> [SERVER ACTION] 8. Insertando items en lotes (chunks) a la base de datos...",
    );

    // Inserción en lotes para evitar saturar el payload de Supabase si el Excel es enorme
    const CHUNK_SIZE = 500;
    let insertError = null;

    for (let i = 0; i < itemsProcesados.length; i += CHUNK_SIZE) {
      const chunk = itemsProcesados.slice(i, i + CHUNK_SIZE);
      console.log(
        `>>> [SERVER ACTION] Insertando lote ${i} a ${i + chunk.length}...`,
      );

      const { error: errorItems } = await supabase
        .from("ordenes_items")
        .insert(chunk);

      if (errorItems) {
        insertError = errorItems;
        console.error(
          `>>> [SERVER ACTION] ERROR BD ITEMS (Lote ${i}):`,
          JSON.stringify(errorItems, null, 2),
        );
        break;
      }
    }

    if (insertError) {
      console.log(
        ">>> [SERVER ACTION] 9. Haciendo Rollback de la cabecera por error en los items...",
      );
      await supabase.from("ordenes_compra").delete().eq("id", orden.id);
      return {
        success: false,
        error: "Error guardando filas del Excel: " + insertError.message,
      };
    }

    console.log(
      ">>> [SERVER ACTION] 10. Todo guardado correctamente. Revalidando caché...",
    );
    revalidatePath("/stock");

    return { success: true, error: null, ordenId: orden.id };
  } catch (error) {
    console.error(">>> [SERVER ACTION] ERROR FATAL CATCH:", error);
    return {
      success: false,
      error:
        "Ocurrió un error inesperado en el servidor: " +
        (error as Error)?.message,
    };
  }
}
