"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import {
  URL_MEP,
  leerCotizacionMep,
  type CotizacionMep,
} from "@/features/admin/lib/cotizacion-mep";

/**
 * El MEP de hoy, o null si no se pudo leer.
 *
 * Cache de una hora (`revalidate`): el panel lo pide en cada visita y la fuente
 * se actualiza varias veces al día, no por segundo. Es una lectura, así que el
 * timeout corta sin dejar nada a medias; devuelve null y quien llama decide
 * (la pantalla muestra solo pesos; cargar un gasto en USD avisa y no inventa
 * una cotización).
 *
 * Solo para el super admin: es un dato público, pero esto es un endpoint, y no
 * hace falta que cualquiera lo use de proxy.
 */
export async function getCotizacionMepAction(): Promise<CotizacionMep | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: esSuper } = await supabase.rpc("is_super_admin");
  if (!esSuper) return null;

  try {
    const respuesta = await fetch(URL_MEP, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    });
    if (!respuesta.ok) return null;
    return leerCotizacionMep(await respuesta.json(), new Date());
  } catch (error) {
    console.error("[MEP] no se pudo leer la cotización:", error);
    return null;
  }
}
