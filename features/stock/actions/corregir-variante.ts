"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { invalidarCatalogoDeSesion } from "@/shared/lib/cache-catalogo";
import {
  canonicalizarValores,
  construirCacheAtributos,
} from "../lib/normalize-atributo";
import { nombreDeVarianteCorregida } from "../lib/nombre-variante-corregida";

/**
 * Corrige las propiedades de UNA variante sin borrarla (RPC
 * `corregir_variante`, 20261001150000).
 *
 * Existe porque la grilla de edición no puede: cambiar "12/257" por "12/256"
 * es para ella borrar una variante y crear otra, y una variante con IMEI no se
 * borra. Acá la variante conserva su id, sus IMEI y sus ventas. Si la
 * corrección la deja igual a otra variante del producto, la RPC no adivina:
 * devuelve `requiereFusion` y la pantalla pregunta antes de juntarlas.
 */
export type CorregirVarianteResult =
  | { ok: true; accion: "RENOMBRADA" | "FUSIONADA" | "SIN_CAMBIOS" }
  | {
      ok: false;
      requiereFusion: true;
      destino: string;
      stockOrigen: number;
      stockDestino: number;
    }
  | { ok: false; requiereFusion?: false; error: string };

export async function corregirVarianteAction(params: {
  varianteId: string;
  /** Propiedades nuevas, tal como las tipeó el usuario (se canonicalizan acá). */
  valores: Record<string, string>;
  /** Nombre que tenía: decide si el nuevo va como "Color: X / Memoria: Y". */
  nombreAnterior: string;
  fusionar?: boolean;
}): Promise<CorregirVarianteResult> {
  const valores: Record<string, string> = Object.fromEntries(
    Object.entries(params.valores)
      .map(([k, v]): [string, string] => [k.trim(), (v ?? "").trim()])
      .filter(([k, v]) => k && v),
  );
  if (!params.varianteId) return { ok: false, error: "Falta la variante." };
  if (Object.keys(valores).length === 0) {
    return { ok: false, error: "La variante tiene que tener al menos una propiedad con valor." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // La misma canonicalización que la grilla (`edit-product.ts`): "rosado" y
  // "Rosado" terminan siendo el mismo valor del catálogo de atributos.
  const opciones = Object.entries(valores).map(([nombre, valor]) => ({
    nombre,
    valores: [valor],
  }));
  let atributos: Record<string, string>;
  let relaciones: { atributo_id: string; atributo_valor_id: string }[];
  try {
    const cache = await construirCacheAtributos(supabase, opciones);
    atributos = canonicalizarValores(valores, cache);
    relaciones = Object.entries(valores).flatMap(([nombre, valor]) => {
      const entry = cache[nombre];
      const valorEntry = entry?.valores[valor];
      return entry && valorEntry
        ? [{ atributo_id: entry.atributoId, atributo_valor_id: valorEntry.valorId }]
        : [];
    });
  } catch (error) {
    console.error("[CORREGIR VARIANTE] canonicalizando:", error);
    return { ok: false, error: "No se pudieron guardar las propiedades." };
  }

  // Si una propiedad no se pudo canonicalizar, se frena: guardar menos
  // propiedades de las que el usuario escribió sería cambiar la variante.
  if (Object.keys(atributos).length !== Object.keys(valores).length) {
    return { ok: false, error: "No se pudieron guardar todas las propiedades." };
  }

  const { data, error } = await supabase.rpc("corregir_variante", {
    p_variante_id: params.varianteId,
    p_atributos: atributos,
    p_nombre_display: nombreDeVarianteCorregida(atributos, params.nombreAnterior),
    p_relaciones: relaciones,
    p_fusionar: params.fusionar ?? false,
  });

  if (error) {
    console.error("[CORREGIR VARIANTE]", error);
    const mensaje = error.message ?? "";
    if (mensaje.includes("FUSION_PRECIOS_DISTINTOS")) {
      return {
        ok: false,
        error:
          "Las dos variantes tienen precio o costo distinto. Igualalos desde la grilla y volvé a corregir.",
      };
    }
    if (mensaje.includes("FUSION_CON_PRESENTACIONES")) {
      return {
        ok: false,
        error: "Esta variante tiene presentaciones propias: no se puede juntar con otra.",
      };
    }
    if (mensaje.includes("SIN_PERMISO") || error.code === "42501") {
      return { ok: false, error: "No tenés permiso para editar productos." };
    }
    return { ok: false, error: "No se pudo corregir la variante." };
  }

  const res = data as {
    ok: boolean;
    accion?: "RENOMBRADA" | "FUSIONADA" | "SIN_CAMBIOS";
    requiere_fusion?: boolean;
    destino?: string;
    stock_origen?: number;
    stock_destino?: number;
  };

  if (res.requiere_fusion) {
    return {
      ok: false,
      requiereFusion: true,
      destino: res.destino ?? "",
      stockOrigen: Number(res.stock_origen) || 0,
      stockDestino: Number(res.stock_destino) || 0,
    };
  }
  if (!res.ok || !res.accion) {
    return { ok: false, error: "No se pudo corregir la variante." };
  }

  revalidatePath("/stock");
  revalidatePath("/store", "layout");
  await invalidarCatalogoDeSesion(supabase);

  return { ok: true, accion: res.accion };
}
