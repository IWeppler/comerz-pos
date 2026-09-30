"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { normalizarImei } from "@/entities/ventas/imei";

/**
 * Alta y baja MANUAL de unidades serializadas (IMEI / número de serie).
 *
 * Hasta el 30/9/2026 las unidades solo nacían de un remito o una planilla con
 * columna IMEI: un celular cargado a mano no tenía cómo recibir su número, y
 * el ticket salía sin IMEI. Estas dos actions las usan la ficha del producto
 * y el POS (la vendedora tipea el IMEI del aparato que se está vendiendo).
 *
 * No tocan el stock: el aparato ya está contado en `producto_variantes.stock`
 * —se cargó a mano o por remito sin IMEI—; lo que falta es su número. La unidad
 * nace 'disponible' y la venta la marca vendida por el camino de siempre
 * (`vender_unidades_serie`).
 */

export type AgregarUnidadResult =
  | { ok: true; unidad: { id: string; imei: string } }
  | { ok: false; error: string };

export async function agregarUnidadSerieAction(
  varianteId: string,
  imeiCrudo: string,
): Promise<AgregarUnidadResult> {
  const imei = normalizarImei(imeiCrudo);
  if (!varianteId) return { ok: false, error: "Falta la variante." };
  if (!imei) return { ok: false, error: "Escribí el IMEI o número de serie." };
  if (imei.length > 40) {
    return { ok: false, error: "Ese número es demasiado largo para un IMEI." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // La variante se lee con la RLS de quien llama: si no es de su negocio no
  // vuelve. Sin esto, el FK dejaría colgar una unidad de una variante ajena
  // (los FK no miran RLS).
  const { data: variante, error: errorVariante } = await supabase
    .from("producto_variantes")
    .select("id")
    .eq("id", varianteId)
    .maybeSingle();

  if (errorVariante) {
    console.error("[UNIDADES SERIE] leyendo variante:", errorVariante);
    return { ok: false, error: "No se pudo verificar el producto." };
  }
  if (!variante) return { ok: false, error: "El producto no existe en este comercio." };

  const { data, error } = await supabase
    .from("unidades_serie")
    .insert({ producto_variante_id: varianteId, imei, estado: "disponible" })
    .select("id, imei")
    .single();

  if (error) {
    // unidades_serie_negocio_imei_key: el mismo número ya está en el comercio.
    if (error.code === "23505") {
      return { ok: false, error: `El IMEI ${imei} ya está cargado en otro aparato.` };
    }
    console.error("[UNIDADES SERIE] alta manual:", error);
    return { ok: false, error: "No se pudo guardar el IMEI." };
  }

  return { ok: true, unidad: { id: data.id as string, imei: data.imei as string } };
}

/**
 * Borra una unidad cargada por error (un número mal tipeado). Solo si está
 * DISPONIBLE y nunca se vendió: una unidad vendida es el registro de garantía
 * del aparato y no se borra desde acá.
 */
export async function quitarUnidadSerieAction(
  unidadId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!unidadId) return { ok: false, error: "Falta la unidad." };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // Condición en el mismo DELETE y conteo de filas: un select previo no
  // alcanza (la venta puede marcarla entre medio) y un DELETE filtrado por
  // RLS vuelve 0 filas sin error.
  const { data, error } = await supabase
    .from("unidades_serie")
    .delete()
    .eq("id", unidadId)
    .eq("estado", "disponible")
    .is("venta_id", null)
    .select("id");

  if (error) {
    console.error("[UNIDADES SERIE] baja manual:", error);
    return { ok: false, error: "No se pudo quitar el IMEI." };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Ese IMEI ya no está disponible (se vendió o lo sacó otra persona).",
    };
  }
  return { ok: true };
}
