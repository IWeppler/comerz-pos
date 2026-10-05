"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  avisoDelDia,
  type DeudaPorVencimiento,
  type TipoAvisoCc,
} from "../lib/avisos-cc";

export interface ClienteAvisoCc {
  clienteId: string;
  /** Lo que tiene que pagar hasta el vencimiento del ciclo. */
  monto: number;
  /** Ya se marcó este aviso para este cliente en este ciclo. */
  enviado: boolean;
}

export interface AvisosCcDelDia {
  tipo: TipoAvisoCc;
  cierre: string;
  venceEl: string;
  clientes: ClienteAvisoCc[];
}

/**
 * El aviso de cuenta corriente que toca hoy, con cada cliente marcado si ya
 * se le mandó. null si el comercio no está en cierre mensual o no hay a quién
 * avisar (y la pantalla no muestra nada).
 *
 * Primero la configuración: en un comercio en "días desde la compra" (casi
 * todos) no se paga el viaje de la deuda. Después, en paralelo, la deuda por
 * vencimiento y lo ya avisado. La regla de qué toca es `avisoDelDia`, pura y
 * con tests; los montos salen de `cc_deuda_por_vencimiento` (la misma regla
 * que el cobro).
 */
export async function getAvisosCcAction(): Promise<{
  aviso: AvisosCcDelDia | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: config, error: errorConfig } = await supabase
    .from("configuracion_pos")
    .select("cc_vencimiento_modo, cc_plazo_mora, cc_dia_cierre, cc_dia_vencimiento")
    .single();

  if (errorConfig || !config) {
    return { aviso: null, error: null };
  }
  if (config.cc_vencimiento_modo !== "CIERRE_MENSUAL" || !config.cc_dia_cierre) {
    return { aviso: null, error: null };
  }

  const regla = {
    modo: config.cc_vencimiento_modo,
    plazoDias: config.cc_plazo_mora,
    diaCierre: config.cc_dia_cierre,
    diaVencimiento: config.cc_dia_vencimiento,
  } as const;
  const hoy = diaComercial(new Date());

  const { data: filas, error: errorDeuda } = await supabase.rpc(
    "cc_deuda_por_vencimiento",
  );
  if (errorDeuda) {
    console.error("[AVISOS CC] No se pudo leer la deuda:", errorDeuda);
    return { aviso: null, error: "No se pudieron cargar los avisos." };
  }

  const deudas: DeudaPorVencimiento[] = (
    (filas ?? []) as { cliente_id: string; vence_el: string; vivo: number | string }[]
  ).map((f) => ({
    clienteId: f.cliente_id,
    venceEl: String(f.vence_el).slice(0, 10),
    vivo: Number(f.vivo) || 0,
  }));

  const aviso = avisoDelDia(regla, hoy, deudas);
  if (!aviso) return { aviso: null, error: null };

  const { data: enviados, error: errorEnviados } = await supabase
    .from("cc_avisos")
    .select("cliente_id")
    .eq("tipo", aviso.tipo)
    .eq("vence_el", aviso.venceEl);

  if (errorEnviados) {
    // Sin el registro no se sabe a quién ya se avisó: mejor no mostrar la
    // lista que mostrar a todos como pendientes y que se repitan mensajes.
    console.error("[AVISOS CC] No se pudo leer lo ya avisado:", errorEnviados);
    return { aviso: null, error: "No se pudieron cargar los avisos." };
  }

  const yaAvisados = new Set((enviados ?? []).map((e) => e.cliente_id as string));

  return {
    aviso: {
      ...aviso,
      clientes: aviso.clientes.map((c) => ({
        ...c,
        enviado: yaAvisados.has(c.clienteId),
      })),
    },
    error: null,
  };
}

const TIPOS: readonly TipoAvisoCc[] = ["CIERRE", "PREVIO", "MORA"];

/**
 * Registra que se le mandó el aviso a un cliente (en `cc_avisos`).
 *
 * Marcarlo dos veces no es un error: la base tiene UNIQUE por cliente, tipo y
 * vencimiento, y el duplicado (23505) se devuelve como "ya estaba". Con
 * `.select("id")` y chequeo de filas: un INSERT filtrado por RLS no avisa.
 */
export async function marcarAvisoCcEnviadoAction(input: {
  clienteId: string;
  tipo: TipoAvisoCc;
  venceEl: string;
  monto: number;
}): Promise<{ ok: boolean; error: string | null }> {
  if (
    !input.clienteId ||
    !TIPOS.includes(input.tipo) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.venceEl) ||
    !Number.isFinite(input.monto) ||
    input.monto < 0
  ) {
    return { ok: false, error: "Aviso inválido." };
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("cc_avisos")
    .insert({
      cliente_id: input.clienteId,
      tipo: input.tipo,
      vence_el: input.venceEl,
      monto: Math.round(input.monto * 100) / 100,
    })
    .select("id");

  if (error?.code === "23505") return { ok: true, error: null };
  if (error || !data || data.length === 0) {
    console.error("[AVISOS CC] No se pudo registrar el aviso:", error);
    return { ok: false, error: "No se pudo marcar el aviso como enviado." };
  }
  return { ok: true, error: null };
}
