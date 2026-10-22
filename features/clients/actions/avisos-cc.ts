"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  avisoDelDia,
  avisosModoDias,
  type DeudaPorVencimiento,
  type TipoAvisoCc,
} from "../lib/avisos-cc";

export interface ClienteAvisoCc {
  clienteId: string;
  /** Lo que tiene que pagar hasta el vencimiento del ciclo (cierre mensual) o
   * lo vencido más lo que vence en los próximos días (modo días). */
  monto: number;
  /** El aviso de ESTE cliente (`cc_avisos`). Con cierre es el del ciclo
   * para todos; en modo días cada cliente tiene el suyo. */
  tipo: TipoAvisoCc;
  venceEl: string;
  /** Ya se marcó este aviso para este cliente. */
  enviado: boolean;
}

export type AvisosCcDelDia =
  | {
      modo: "CIERRE_MENSUAL";
      tipo: TipoAvisoCc;
      cierre: string;
      venceEl: string;
      clientes: ClienteAvisoCc[];
    }
  | {
      /** "Días desde la compra": vencidos y por vencer (22/10/2026). */
      modo: "DIAS";
      clientes: ClienteAvisoCc[];
    };

/**
 * A quién hay que cobrarle hoy, con cada cliente marcado si ya se le mandó.
 * null si no hay a quién avisar (y la pantalla no muestra nada).
 *
 * Con cierre mensual es el aviso del ciclo (`avisoDelDia`); en "días desde la
 * compra", desde el 22/10/2026, los vencidos y los que vencen en los próximos
 * días (`avisosModoDias`): Evens, Estilo Bonito y ClickTostado tenían millones
 * fiados y ninguna lista. Las dos reglas son puras y con tests; los montos
 * salen de `cc_deuda_por_vencimiento` (la misma regla que el cobro).
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
  const conCierre =
    config.cc_vencimiento_modo === "CIERRE_MENSUAL" && !!config.cc_dia_cierre;

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

  // Cada cliente con SU aviso (tipo + vencimiento): con cierre es el del
  // ciclo para todos; en modo días, el de su deuda.
  let base:
    | { modo: "CIERRE_MENSUAL"; tipo: TipoAvisoCc; cierre: string; venceEl: string }
    | { modo: "DIAS" };
  let lista: { clienteId: string; monto: number; tipo: TipoAvisoCc; venceEl: string }[];
  if (conCierre) {
    const aviso = avisoDelDia(regla, hoy, deudas);
    if (!aviso) return { aviso: null, error: null };
    base = { modo: "CIERRE_MENSUAL", tipo: aviso.tipo, cierre: aviso.cierre, venceEl: aviso.venceEl };
    lista = aviso.clientes.map((c) => ({ ...c, tipo: aviso.tipo, venceEl: aviso.venceEl }));
  } else {
    lista = avisosModoDias(hoy, deudas);
    if (lista.length === 0) return { aviso: null, error: null };
    base = { modo: "DIAS" };
  }

  const vencimientos = [...new Set(lista.map((c) => c.venceEl))];
  const { data: enviados, error: errorEnviados } = await supabase
    .from("cc_avisos")
    .select("cliente_id, tipo, vence_el")
    .in("vence_el", vencimientos);

  if (errorEnviados) {
    // Sin el registro no se sabe a quién ya se avisó: mejor no mostrar la
    // lista que mostrar a todos como pendientes y que se repitan mensajes.
    console.error("[AVISOS CC] No se pudo leer lo ya avisado:", errorEnviados);
    return { aviso: null, error: "No se pudieron cargar los avisos." };
  }

  const clave = (clienteId: string, tipo: string, venceEl: string) =>
    `${clienteId}|${tipo}|${venceEl.slice(0, 10)}`;
  const yaAvisados = new Set(
    (enviados ?? []).map((e) =>
      clave(e.cliente_id as string, e.tipo as string, String(e.vence_el)),
    ),
  );
  const clientes = lista.map((c) => ({
    ...c,
    enviado: yaAvisados.has(clave(c.clienteId, c.tipo, c.venceEl)),
  }));

  return { aviso: { ...base, clientes }, error: null };
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
