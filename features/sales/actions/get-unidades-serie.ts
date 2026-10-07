"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type {
  DisponibilidadPorVariante,
  UnidadSerieDisponible,
} from "@/entities/ventas/unidades-serie-types";

/**
 * Cuántas unidades DISPONIBLES tiene cada variante del carrito.
 *
 * Es lo que decide si una línea "requiere selección de unidad": una
 * variante con al menos una unidad libre es serializada y no se puede
 * vender sin elegir el aparato. Una variante sin unidades se vende como
 * siempre — es el caso de toda la indumentaria y de los accesorios de
 * electro, y por eso la respuesta para ellas es simplemente ausencia de
 * clave, no un error.
 *
 * `llevaSerie` son las variantes cuyo producto lleva IMEI, por él o por su
 * categoría (`variantes_llevan_serie`). Con eso el POS pide el número (o un
 * motivo) cuando una de ellas no tiene ninguna unidad cargada: sin la marca, un
 * celular cargado a mano se vendía sin pedir nada y el ticket salía sin IMEI.
 * Viaja acá y no en el catálogo del celular para no depender de que la copia
 * local esté al día.
 */
export async function getDisponibilidadUnidadesAction(
  varianteIds: string[],
): Promise<{
  error: string | null;
  disponibilidad: DisponibilidadPorVariante;
  llevaSerie: string[];
}> {
  const ids = [...new Set(varianteIds.filter(Boolean))];
  if (ids.length === 0) return { error: null, disponibilidad: {}, llevaSerie: [] };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const disponibilidad: DisponibilidadPorVariante = {};
  const llevaSerie: string[] = [];

  // En lotes: un `.in()` con demasiados ids arma una URL que el servidor
  // rechaza por longitud. Un carrito nunca llega a eso, pero el costo de
  // lotear es cero y evita un modo de falla silencioso.
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const [unidades, marcadas] = await Promise.all([
      supabase
        .from("unidades_serie")
        .select("producto_variante_id")
        .in("producto_variante_id", lote)
        .eq("estado", "disponible"),
      // Por el producto O por su categoría (20261007120000). Mismo criterio
      // que usa create-sale para exigir el motivo.
      supabase.rpc("variantes_llevan_serie", { p_variante_ids: lote }),
    ]);

    if (unidades.error) {
      console.error(
        "[UNIDADES SERIE] Error consultando disponibilidad:",
        unidades.error,
      );
      return {
        error: "No se pudo verificar las unidades con número de serie.",
        disponibilidad: {},
        llevaSerie: [],
      };
    }

    for (const row of unidades.data ?? []) {
      const varianteId = row.producto_variante_id as string;
      disponibilidad[varianteId] = (disponibilidad[varianteId] ?? 0) + 1;
    }

    // Si falla se sigue sin la marca: el server (create-sale) igual exige el
    // IMEI o el motivo, así que acá solo se pierde el modal anticipado.
    if (marcadas.error) {
      console.error("[UNIDADES SERIE] Error consultando lleva_serie:", marcadas.error);
    } else {
      for (const row of (marcadas.data ?? []) as { variante_id: string }[]) {
        llevaSerie.push(row.variante_id);
      }
    }
  }

  return { error: null, disponibilidad, llevaSerie };
}

/**
 * Unidades libres de una variante, en orden FIFO (la que entró primero,
 * primero se vende). Solo `estado = 'disponible'`: una unidad vendida no
 * se muestra ni se puede elegir.
 */
export async function getUnidadesDisponiblesAction(
  varianteId: string,
): Promise<{ error: string | null; unidades: UnidadSerieDisponible[] }> {
  if (!varianteId) {
    return { error: "Falta la variante.", unidades: [] };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("unidades_serie")
    .select("id, imei, fecha_ingreso")
    .eq("producto_variante_id", varianteId)
    .eq("estado", "disponible")
    .order("fecha_ingreso", { ascending: true });

  if (error) {
    console.error("[UNIDADES SERIE] Error listando unidades:", error);
    return { error: "No se pudieron cargar las unidades.", unidades: [] };
  }

  return {
    error: null,
    unidades: (data ?? []).map((u) => ({
      id: u.id as string,
      imei: u.imei as string,
      fechaIngreso: u.fecha_ingreso as string,
    })),
  };
}

/**
 * Todas las unidades de una variante (disponibles y vendidas) para la
 * ficha del producto. Incluye la venta a la que salió cada una, que es la
 * punta del hilo de trazabilidad cuando alguien vuelve con un aparato.
 */
export async function getUnidadesDeVarianteAction(varianteId: string): Promise<{
  error: string | null;
  unidades: {
    id: string;
    imei: string;
    estado: string;
    fechaIngreso: string;
    fechaVenta: string | null;
    ventaId: string | null;
  }[];
}> {
  if (!varianteId) return { error: "Falta la variante.", unidades: [] };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("unidades_serie")
    .select("id, imei, estado, fecha_ingreso, fecha_venta, venta_id")
    .eq("producto_variante_id", varianteId)
    // Disponibles arriba (es lo que se busca al atender), y dentro de cada
    // grupo FIFO.
    .order("estado", { ascending: true })
    .order("fecha_ingreso", { ascending: true });

  if (error) {
    console.error("[UNIDADES SERIE] Error listando unidades de variante:", error);
    return { error: "No se pudieron cargar las unidades.", unidades: [] };
  }

  return {
    error: null,
    unidades: (data ?? []).map((u) => ({
      id: u.id as string,
      imei: u.imei as string,
      estado: u.estado as string,
      fechaIngreso: u.fecha_ingreso as string,
      fechaVenta: (u.fecha_venta as string | null) ?? null,
      ventaId: (u.venta_id as string | null) ?? null,
    })),
  };
}
