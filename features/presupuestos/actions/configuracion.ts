"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { validarTasas } from "../lib/cuotas";

const FRECUENCIAS = ["SEMANAL", "QUINCENAL", "MENSUAL"] as const;
export type Frecuencia = (typeof FRECUENCIAS)[number];

/**
 * Tasas de financiación, frecuencia y vigencia de las cotizaciones.
 *
 * Cambiar esto NO cambia lo que ya se cotizó: cada cotización lleva su copia
 * (`presupuestos.tasas_financiacion`, `frecuencia`). Los CHECK de
 * `configuracion_pos` son el freno de verdad; esto da el mensaje entendible.
 */
export async function guardarConfigPresupuestosAction(input: {
  configId: string;
  tasas: unknown;
  frecuencia: string;
  vigenciaDias: number;
}): Promise<{ ok: boolean; error: string | null }> {
  if (!input?.configId) {
    return { ok: false, error: "No se pudo identificar la configuración. Recargá la página." };
  }
  const tasas = validarTasas(input.tasas);
  if (!tasas.ok) return { ok: false, error: tasas.error };
  if (!FRECUENCIAS.includes(input.frecuencia as Frecuencia)) {
    return { ok: false, error: "Elegí la frecuencia de las cuotas." };
  }
  const vigencia = Number(input.vigenciaDias);
  if (!Number.isInteger(vigencia) || vigencia < 1 || vigencia > 365) {
    return { ok: false, error: "La vigencia tiene que ser de 1 a 365 días." };
  }

  const supabase = createClient(await cookies());
  // Con `.select("id")`: escribir `configuracion_pos` pide ADMIN, y un UPDATE
  // filtrado por RLS devuelve 0 filas con `error: null`.
  const { data, error } = await supabase
    .from("configuracion_pos")
    .update({
      plan_tasas_financiacion: tasas.tasas,
      plan_frecuencia_default: input.frecuencia,
      presupuesto_vigencia_dias: vigencia,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.configId)
    .select("id");

  if (error) {
    console.error("[PRESUPUESTOS] guardar configuración:", error);
    return { ok: false, error: "No se pudo guardar la configuración." };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: "Solo un administrador puede cambiar esta configuración." };
  }
  revalidatePath("/configuracion");
  return { ok: true, error: null };
}
