"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { normalizarImei } from "@/entities/ventas/imei";

/**
 * Renglones de una venta que salieron SIN IMEI y lo llevan: un aparato
 * (cantidad 1), sin unidad atada, sin devolver, de un producto que lleva IMEI
 * por él o por su categoría. Son los que el historial ofrece completar.
 *
 * Se pide al abrir el ticket y no en el listado: el listado baja cientos de
 * ventas y esto importa en un puñado (ver "Plataforma y egress" en AGENTS.md).
 */
export async function getRenglonesImeiPendienteAction(
  ventaId: string,
): Promise<{ error: string | null; itemIds: string[] }> {
  if (!ventaId) return { error: null, itemIds: [] };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: renglones, error } = await supabase
    .from("ventas_items")
    .select("id, variante_id, venta:ventas!inner(estado_operacion)")
    .eq("venta_id", ventaId)
    .is("unidad_serie_id", null)
    .not("variante_id", "is", null)
    .eq("cantidad", 1)
    .eq("cantidad_devuelta", 0)
    .neq("venta.estado_operacion", "ANULADA");

  if (error) {
    console.error("[IMEI PENDIENTE] Error leyendo renglones:", error);
    return { error: "No se pudo ver qué aparatos faltan.", itemIds: [] };
  }
  if (!renglones?.length) return { error: null, itemIds: [] };

  const varianteIds = [...new Set(renglones.map((r) => r.variante_id as string))];
  const { data: llevan, error: llevanError } = await supabase.rpc(
    "variantes_llevan_serie",
    { p_variante_ids: varianteIds },
  );
  if (llevanError) {
    console.error("[IMEI PENDIENTE] Error consultando lleva serie:", llevanError);
    return { error: "No se pudo ver qué aparatos faltan.", itemIds: [] };
  }

  const conSerie = new Set(
    ((llevan ?? []) as { variante_id: string }[]).map((r) => r.variante_id),
  );
  return {
    error: null,
    itemIds: renglones
      .filter((r) => conSerie.has(r.variante_id as string))
      .map((r) => r.id as string),
  };
}

/** Los errores de `completar_imei_venta_item`, para la vendedora. */
function mensajeCompletarImei(mensaje: string | undefined): string {
  if (!mensaje) return "No se pudo guardar el IMEI.";
  if (mensaje.includes("IMEI_YA_CARGADO")) {
    return "Ese IMEI ya está cargado en otro aparato del comercio.";
  }
  if (mensaje.includes("ITEM_YA_TIENE_IMEI")) {
    return "Este aparato ya tiene otro IMEI. Recargá el historial.";
  }
  if (mensaje.includes("VENTA_ANULADA")) return "La venta está anulada.";
  if (mensaje.includes("ITEM_DEVUELTO")) return "El aparato ya fue devuelto.";
  if (mensaje.includes("ITEM_CANTIDAD_NO_UNITARIA")) {
    return "Este renglón tiene más de un aparato: no se puede completar desde acá.";
  }
  if (mensaje.includes("SIN_PERMISO")) {
    return "Tu usuario no puede completar el IMEI de esta venta.";
  }
  if (mensaje.includes("IMEI_VACIO")) return "Escribí el IMEI.";
  return "No se pudo guardar el IMEI.";
}

/**
 * Ata el IMEI a un renglón vendido sin número. La RPC crea la unidad ya
 * VENDIDA (no mueve stock), exige permiso y es idempotente con el mismo número.
 */
export async function completarImeiAction(
  itemId: string,
  imei: string,
): Promise<{ ok: true; imei: string } | { ok: false; error: string }> {
  const numero = normalizarImei(imei);
  if (!itemId || !numero) return { ok: false, error: "Escribí el IMEI." };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.rpc("completar_imei_venta_item", {
    p_item_id: itemId,
    p_imei: numero,
  });

  if (error) {
    console.error("[IMEI PENDIENTE] Error completando:", error);
    return { ok: false, error: mensajeCompletarImei(error.message) };
  }

  return { ok: true, imei: (data as { imei: string }).imei };
}
