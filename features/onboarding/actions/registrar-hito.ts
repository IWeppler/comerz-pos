"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { HITOS_ACTIVACION, type HitoActivacion } from "../lib/hitos-activacion";

/** Telemetría: nunca bloquea la operación ni recibe un negocio del navegador. */
export async function registrarHitoActivacionAction(
  hito: HitoActivacion,
): Promise<void> {
  try {
    if (!HITOS_ACTIVACION.includes(hito)) return;
    const supabase = createClient(await cookies());
    const { error } = await supabase.rpc("registrar_hito_activacion", {
      p_hito: hito,
    });
    if (error) console.error("[HITO ACTIVACION]", error.message);
  } catch (error) {
    console.error("[HITO ACTIVACION]", error);
  }
}
