"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { invalidarCatalogoDeSesion } from "@/shared/lib/cache-catalogo";

/**
 * Un grupo del remito listo para crearse como producto. Lo arma la tabla del
 * modo carga inicial: un grupo = un producto = todas las líneas del remito
 * que comparten identidad (nombre + marca + género).
 */
export type GrupoParaCrear = {
  /** Identidad del grupo en el remito, para devolver el mapeo. */
  rawNombre: string;
  /** Ids de `ordenes_items` que forman el grupo. Es la clave de idempotencia:
   * si alguna ya tiene producto_id, el grupo ya se creó. */
  itemIds: string[];
  nombre: string;
  /** null cuando hay que crear la categoría (ver `categoriaNombreNueva`). */
  categoriaId: string | null;
  /** Nombre de una categoría que el comercio todavía no tiene. Solo se manda
   * si la persona lo vio en pantalla y pudo cambiarlo. */
  categoriaNombreNueva: string | null;
  marca: string | null;
  precio: number;
  /** null = no tocar el costo de las líneas (un grupo con costos distintos
   * por variante no tiene UN costo; pisarlos todos con el primero era perder
   * el dato). El costo del producto lo pone después la aprobación. */
  costo: number | null;
};

export type ResultadoCreacionLote = {
  error: string | null;
  creados: number;
  reusados: number;
  /** raw_nombre -> producto_id, para que la pantalla siga sin recargar. */
  productosPorRawNombre: Record<string, string>;
};

/**
 * Crea en LOTE las cabeceras de producto de un remito, en una transacción y
 * de forma idempotente (RPC `crear_productos_desde_remito`).
 *
 * Reemplaza al camino de a uno (`crearProductoAlVueloAction` por grupo), que
 * en un remito de 94 grupos son 94 round-trips y ningún guard: confirmar dos
 * veces creaba todo dos veces.
 *
 * NO impacta stock. Eso lo sigue haciendo `aprobarOrdenAction`, que ya tiene
 * su propio guard de idempotencia.
 */
export async function crearProductosDesdeRemitoAction(
  ordenId: string,
  grupos: GrupoParaCrear[],
): Promise<ResultadoCreacionLote> {
  const vacio = { creados: 0, reusados: 0, productosPorRawNombre: {} };

  if (grupos.length === 0) {
    return { error: "No hay productos nuevos para crear.", ...vacio };
  }

  const sinNombre = grupos.find((g) => !g.nombre.trim());
  if (sinNombre) {
    return {
      error: `Falta el nombre de "${sinNombre.rawNombre}". Completalo antes de confirmar.`,
      ...vacio,
    };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const payload = grupos.map((g) => ({
    raw_nombre: g.rawNombre,
    item_ids: g.itemIds,
    nombre: g.nombre.trim(),
    categoria_id: g.categoriaId,
    categoria_nombre_nueva: g.categoriaId ? null : g.categoriaNombreNueva,
    marca: g.marca,
    precio: g.precio,
    costo: g.costo,
  }));

  const { data, error } = await supabase.rpc("crear_productos_desde_remito", {
    p_orden_id: ordenId,
    p_items: payload,
  });

  if (error) {
    console.error("[CARGA INICIAL] Error creando productos:", error);
    return {
      error: `No se pudieron crear los productos: ${error.message}`,
      ...vacio,
    };
  }

  const resultado = (data ?? {}) as {
    creados?: number;
    reusados?: number;
    productos_por_raw_nombre?: Record<string, string>;
  };

  revalidatePath("/stock");
  revalidatePath("/store", "layout");
  await invalidarCatalogoDeSesion(supabase);

  return {
    error: null,
    creados: resultado.creados ?? 0,
    reusados: resultado.reusados ?? 0,
    productosPorRawNombre: resultado.productos_por_raw_nombre ?? {},
  };
}

/**
 * Guarda el progreso de una conciliación en la BASE, no en el navegador.
 *
 * El borrador ya existía en IndexedDB (`merge-draft-db.ts`), que resuelve el
 * "cerré la pestaña" pero no el "seguí desde la compu de arriba" ni el
 * "limpié el navegador". Con 62 grupos promedio por remito en Estilo Bonito
 * eso es media hora de tipeo perdida. El de IndexedDB se mantiene para el
 * modo conciliación; este es el que vale entre dispositivos.
 *
 * Nunca tira: un borrador que no se pudo guardar no puede frenar la carga.
 * El caller decide si lo dice en pantalla.
 */
export async function guardarBorradorOrdenAction(
  ordenId: string,
  payload: unknown,
): Promise<{ ok: boolean }> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { error } = await supabase.from("ordenes_borradores").upsert(
      {
        orden_id: ordenId,
        payload: payload as Record<string, unknown>,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "orden_id" },
    );

    if (error) {
      console.error("[CARGA INICIAL] No se pudo guardar el borrador:", error);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("[CARGA INICIAL] Error guardando borrador:", err);
    return { ok: false };
  }
}

export async function borrarBorradorOrdenAction(
  ordenId: string,
): Promise<void> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    await supabase.from("ordenes_borradores").delete().eq("orden_id", ordenId);
  } catch (err) {
    console.error("[CARGA INICIAL] Error borrando borrador:", err);
  }
}
