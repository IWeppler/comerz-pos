"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { PosicionDinero } from "@/entities/caja/types";
import type { PeriodoCalendario } from "@/shared/lib/periodo-ranges";

export async function getPosicionDineroAction(
  periodo: PeriodoCalendario = "mes",
): Promise<{ data: PosicionDinero | null; error: string | null }> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  let { data, error } = await supabase.rpc("posicion_dinero_ledger", {
    p_desde: null,
    p_hasta: null,
    p_periodo: periodo,
  });

  // Compatibilidad de despliegue: la app puede salir antes que la migración
  // de Etapa 7. Mientras la RPC nueva no exista, la pestaña Dinero conserva
  // el reporte anterior en vez de quedar inutilizable.
  if (error?.code === "PGRST202") {
    console.warn(
      "posicion_dinero_ledger todavía no está disponible; usando posicion_dinero.",
    );
    ({ data, error } = await supabase.rpc("posicion_dinero", {
      p_desde: null,
      p_hasta: null,
      p_periodo: periodo,
    }));
  }

  if (error) {
    if (error.code === "42501") {
      return { data: null, error: "No tenés permiso para ver esta vista." };
    }
    console.error("Error obteniendo la posición de dinero:", error);
    return { data: null, error: "No se pudo cargar la posición de dinero." };
  }

  return { data: data as PosicionDinero, error: null };
}
