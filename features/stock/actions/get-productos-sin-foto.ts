"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";

export type ProductoSinFoto = {
  id: string;
  nombre: string;
  tipo: string | null;
  marca: string | null;
  precio: number | null;
  creado_en: string;
};

/**
 * Productos publicados que todavía no tienen ninguna foto.
 *
 * Existe porque la foto salió del camino crítico del alta: cargar mercadería
 * no puede depender de tener las fotos sacadas. Sacarla del camino sin dejar
 * rastro sería peor —el producto queda sin foto y nadie se entera nunca—, así
 * que el pendiente se cuenta y se muestra.
 *
 * `imagen_url` guarda un JSON array serializado, y los productos viejos
 * guardaron un string suelto; el filtro cubre null, cadena vacía y el array
 * vacío, que son las tres formas reales de "no tiene foto" en esta base.
 *
 * Trae hasta 1000 (el tope de PostgREST) y no 200: la pantalla busca en
 * memoria, y con 200 no encontraba la mayoría (Colores tenía 852 sin foto el
 * 6/10/2026). Son seis columnas de texto, ~85 KB.
 */
export async function getProductosSinFotoAction(limite = 1000): Promise<{
  productos: ProductoSinFoto[];
  total: number;
  error: string | null;
}> {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data, error, count } = await supabase
      .from("productos")
      .select("id, nombre, tipo, marca, precio, creado_en", { count: "exact" })
      .eq("publicado", true)
      .or("imagen_url.is.null,imagen_url.eq.,imagen_url.eq.[]")
      .order("creado_en", { ascending: false })
      .limit(limite);

    if (error) {
      console.error("[FOTOS PENDIENTES] Error:", error);
      return {
        productos: [],
        total: 0,
        error: "No se pudieron leer los productos sin foto.",
      };
    }

    return {
      productos: (data ?? []) as ProductoSinFoto[],
      total: count ?? data?.length ?? 0,
      error: null,
    };
  } catch (err) {
    console.error("[FOTOS PENDIENTES] Error inesperado:", err);
    return { productos: [], total: 0, error: "Error del servidor." };
  }
}
