"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";

/**
 * La marca "lleva IMEI" y las unidades de cada variante, para la sección de
 * números de serie de la edición del producto.
 *
 * Se consulta aparte y no viene en el catálogo del panel: el catálogo es una
 * copia que vive en el celular, y las unidades cambian con cada venta.
 */
export async function getSerieDeProductoAction(productoId: string): Promise<{
  error: string | null;
  llevaSerie: boolean;
  unidadesPorVariante: Record<string, { id: string; imei: string; estado: string }[]>;
}> {
  const vacio = { llevaSerie: false, unidadesPorVariante: {} };
  if (!productoId) return { error: "Falta el producto.", ...vacio };

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [producto, unidades] = await Promise.all([
    supabase.from("productos").select("lleva_serie").eq("id", productoId).maybeSingle(),
    supabase
      .from("unidades_serie")
      .select("id, imei, estado, producto_variante_id, variante:producto_variantes!inner(producto_id)")
      .eq("variante.producto_id", productoId)
      // Disponibles arriba ('disponible' < 'vendido'), FIFO adentro.
      .order("estado", { ascending: true })
      .order("fecha_ingreso", { ascending: true }),
  ]);

  if (producto.error || unidades.error) {
    console.error("[SERIE PRODUCTO]", producto.error ?? unidades.error);
    return { error: "No se pudieron cargar los números de serie.", ...vacio };
  }

  const unidadesPorVariante: Record<string, { id: string; imei: string; estado: string }[]> = {};
  for (const u of unidades.data ?? []) {
    const varianteId = u.producto_variante_id as string;
    (unidadesPorVariante[varianteId] ??= []).push({
      id: u.id as string,
      imei: u.imei as string,
      estado: u.estado as string,
    });
  }

  return {
    error: null,
    llevaSerie: Boolean(producto.data?.lleva_serie),
    unidadesPorVariante,
  };
}
