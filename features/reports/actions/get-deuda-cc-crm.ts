"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";

export type TramoAntiguedadCc = {
  tramo: "0_30" | "31_60" | "61_90" | "MAS_90";
  saldo: number;
  clientes: number;
};

export type DeudaCcCrm = {
  /** Saldo vivo total de la cuenta corriente (FIFO). */
  totalVivo: number;
  /** Cuánto de la deuda viva tiene cada antigüedad, medida desde la fecha de
   * cada deuda pendiente. */
  tramos: TramoAntiguedadCc[];
  /** Vencido por cliente: lo que pasó su plazo (FIFO), con mora. Clave: cliente_id. */
  vencidoPorCliente: Record<string, number>;
  vencidoTotal: number;
};

/**
 * Fuente ÚNICA de antigüedad y vencido del CRM: las mismas funciones que usa el
 * panel (`antiguedad_saldo_cc` y `deuda_cc_vencida`). Antes el CRM calculaba
 * esto sobre `ventas.monto_pendiente`, un campo congelado que no baja con los
 * cobros ni con los reintegros parciales: daba 2,7 veces la deuda real.
 *
 * Si el rol no puede verlo, devuelve `error` y NO un número: el CRM muestra
 * "no disponible" en vez de inventar una cifra.
 */
export async function getDeudaCcCrmAction(): Promise<{
  data: DeudaCcCrm | null;
  error: "SIN_PERMISO" | "ERROR" | null;
}> {
  const supabase = createClient(await cookies());

  const [antiguedadRes, vencidaRes] = await Promise.all([
    supabase.rpc("antiguedad_saldo_cc", { p_limite: 1 }),
    supabase.rpc("deuda_cc_vencida"),
  ]);

  if (antiguedadRes.error || vencidaRes.error) {
    const codigo = antiguedadRes.error?.code ?? vencidaRes.error?.code;
    if (codigo === "42501") return { data: null, error: "SIN_PERMISO" };
    console.error("[getDeudaCcCrmAction]", antiguedadRes.error?.message, vencidaRes.error?.message);
    return { data: null, error: "ERROR" };
  }

  const antiguedad = (antiguedadRes.data ?? {}) as {
    total_vivo?: number | string;
    tramos?: { tramo: TramoAntiguedadCc["tramo"]; saldo: number | string; clientes: number }[];
  };

  const vencidoPorCliente: Record<string, number> = {};
  let vencidoTotal = 0;
  for (const fila of (vencidaRes.data ?? []) as { cliente_id: string; vencido: number | string | null }[]) {
    const vencido = Number(fila.vencido ?? 0);
    if (vencido <= 0) continue;
    vencidoPorCliente[fila.cliente_id] = vencido;
    vencidoTotal += vencido;
  }

  return {
    data: {
      totalVivo: Number(antiguedad.total_vivo ?? 0),
      tramos: (antiguedad.tramos ?? []).map((t) => ({
        tramo: t.tramo,
        saldo: Number(t.saldo),
        clientes: t.clientes,
      })),
      vencidoPorCliente,
      vencidoTotal,
    },
    error: null,
  };
}
