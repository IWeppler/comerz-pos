"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { VentasFacturadas } from "@/entities/caja/types";
import type { PeriodoCalendario } from "@/shared/lib/periodo-ranges";

export async function getVentasFacturadasAction(
  periodo: PeriodoCalendario = "mes",
): Promise<{ data: VentasFacturadas | null; error: string | null }> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.rpc("ventas_facturadas", {
    p_periodo: periodo,
  });

  if (error) {
    if (error.code === "42501") {
      return { data: null, error: "No tenés permiso para ver esta vista." };
    }
    console.error("Error obteniendo ventas facturadas:", error);
    return { data: null, error: "No se pudo cargar lo facturado." };
  }

  return { data: data as VentasFacturadas, error: null };
}
