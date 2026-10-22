"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  mensajeErrorRemito,
  type OpcionPagoRemito,
  type RemitoResumenPago,
} from "../lib/pago-remito";

/**
 * Todos los remitos del negocio con su situación de pago
 * (`resumen_pagos_remitos`, el criterio único de "a pagar").
 */
export async function getResumenPagosRemitosAction(): Promise<RemitoResumenPago[]> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("resumen_pagos_remitos");
  if (error) {
    console.error("[getResumenPagosRemitosAction]", error);
    return [];
  }
  return (data ?? []).map((r: RemitoResumenPago) => ({
    ...r,
    valor: Number(r.valor),
    total_pagado: Number(r.total_pagado),
    saldo_pendiente: Number(r.saldo_pendiente),
  }));
}

/** Un remito puntual, para el diálogo "¿Lo pagaste?" después de aprobar. */
export async function getPagoRemitoAction(
  ordenId: string,
): Promise<RemitoResumenPago | null> {
  const todos = await getResumenPagosRemitosAction();
  return todos.find((r) => r.id === ordenId) ?? null;
}

/**
 * La respuesta a "¿Lo pagaste?". Toda la regla vive en `definir_pago_remito`
 * (permiso, remito aprobado, proveedor obligatorio para dejarlo a pagar, no
 * cambiar de modo con pagos cargados). El gasto de "Sí, ahora" va DESPUÉS y
 * aparte, por el modal de gasto: si la caja está cerrada o no alcanza, el
 * remito queda a pagar, que es verdad.
 */
export async function definirPagoRemitoAction(
  ordenId: string,
  opcion: OpcionPagoRemito,
  proveedorId: string | null,
): Promise<{ error: string | null }> {
  const supabase = createClient(await cookies());
  const { error } = await supabase.rpc("definir_pago_remito", {
    p_orden_id: ordenId,
    p_opcion: opcion,
    p_proveedor_id: proveedorId,
  });
  if (error) {
    console.error("[definirPagoRemitoAction]", error);
    return {
      error: mensajeErrorRemito(error.message) ?? "No se pudo guardar el pago del remito.",
    };
  }
  revalidatePath("/compras");
  revalidatePath("/");
  return { error: null };
}

/**
 * Descarta un remito cuya mercadería no ingresó: no mueve stock ni crea
 * gastos. El trigger `validar_estado_remito` solo lo permite desde PENDIENTE
 * y libera la huella del archivo. UPDATE condicional + filas afectadas: un
 * update filtrado por RLS devuelve éxito con 0 filas.
 */
export async function descartarRemitoAction(
  ordenId: string,
): Promise<{ error: string | null }> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("ordenes_compra")
    .update({ estado: "DESCARTADA" })
    .eq("id", ordenId)
    .eq("estado", "PENDIENTE")
    .select("id");

  if (error) {
    console.error("[descartarRemitoAction]", error);
    return {
      error: mensajeErrorRemito(error.message) ?? "No se pudo descartar el remito.",
    };
  }
  if (!data || data.length === 0) {
    return {
      error: "No se descartó: el remito ya ingresó, ya estaba descartado o no tenés permiso.",
    };
  }
  revalidatePath("/compras");
  revalidatePath("/");
  return { error: null };
}
