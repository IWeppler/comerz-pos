"use server";

import { createClient } from "@/shared/config/supabase/server";
import { cookies } from "next/headers";

export interface OrdenParaEgreso {
  id: string;
  proveedor: string;
  fecha_remito: string | null;
  valor_historico: number;
  total_pagado: number;
  saldo_pendiente: number;
  estado: string | null;
  creado_en: string;
}

/**
 * Remitos recientes, para asociar un egreso de tipo COMPRA_MERCADERIA al
 * remito que lo originó.
 *
 * Trae también los ya aprobados: el pago al proveedor suele ser posterior a
 * la conciliación de la mercadería, así que filtrar por PENDIENTE dejaría
 * afuera justo los que se están por pagar.
 *
 * El límite es a propósito. Es un selector de "el remito de esta semana", no
 * un buscador histórico; RLS ya acota al negocio activo.
 */
export async function getOrdenesParaEgresoAction(): Promise<OrdenParaEgreso[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .rpc("resumen_remitos_financiero");

  if (error) {
    console.error("[getOrdenesParaEgresoAction] Error:", error);
    return [];
  }

  return (data ?? []).slice(0, 30) as OrdenParaEgreso[];
}
