"use server";

import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { EstadoActivacion } from "@/features/onboarding/lib/pasos-activacion";

/**
 * Estado de activación del negocio activo, para la guía de inicio.
 *
 * Todo el trabajo lo hace la RPC `estado_activacion` (una sola ida a la base,
 * todo con EXISTS). Devuelve null si el usuario no es ADMIN — el gate está en
 * la función, no acá: esconder la card sin frenar el dato sería control de
 * acceso por CSS.
 *
 * Fail-closed hacia el lado silencioso: ante cualquier error devolvemos null y
 * la guía no se monta. Romper el panel de inicio —que es lo que ve el comercio
 * que YA trabaja— por un checklist es peor que no mostrar el checklist.
 */
const leerEstadoActivacion = cache(
  async (): Promise<EstadoActivacion | null> => {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const { data, error } = await supabase.rpc("estado_activacion");

    if (error) {
      console.error("[ACTIVACION] No se pudo leer el estado:", error);
      return null;
    }

    return data
      ? {
          ...(data as EstadoActivacion),
          venta_libre_elegida: data.venta_libre_elegida === true,
        }
      : null;
  },
);

export async function getEstadoActivacionAction(): Promise<EstadoActivacion | null> {
  return leerEstadoActivacion();
}
