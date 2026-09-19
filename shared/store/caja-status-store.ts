import { create } from "zustand";
import { createClient } from "@/shared/config/supabase/client";
import { getSupabaseRelation } from "@/entities/ventas/types";

export interface TurnoCajaResumen {
  id: string;
  monto_inicial: number;
  fecha_apertura: string;
  vendedor_id: string | null;
  vendedor_nombre: string | null;
  /** Efectivo esperado AHORA (monto_inicial + ventas en efectivo - egresos
   * desde la apertura) — se recalcula en cada fetchCajaStatus, igual
   * criterio que cerrarTurnoAction (misma RPC de egresos, evita
   * subestimar en modo_caja=UNICA por RLS de egresos_select_propio). */
  montoActual: number;
}

interface CajaStatusState {
  version: number;
  isCajaAbierta: boolean | null;
  turno: TurnoCajaResumen | null;
  notifyCajaChanged: () => void;
  fetchCajaStatus: (modo: string, userId: string) => Promise<void>;
}

/**
 * Fuente única del estado de caja (abierta/cerrada + resumen del turno
 * propio) para todo lo que viva en navbar/sidebar. El polling de 60s +
 * pausa por visibilitychange sigue viviendo en Sidebar (ver sidebar.tsx) —
 * este store solo guarda el resultado de esa única llamada, así el botón
 * de caja del navbar (u otro componente) lo lee reactivamente sin
 * disparar su propio fetch.
 */
export const useCajaStatusStore = create<CajaStatusState>((set) => ({
  version: 0,
  isCajaAbierta: null,
  turno: null,

  // Señal liviana para refetchear el estado de caja apenas el usuario
  // abre/cierra su propio turno, sin esperar al polling de 60s (que queda
  // solo como red de seguridad para cambios hechos por OTRO usuario).
  notifyCajaChanged: () => set((state) => ({ version: state.version + 1 })),

  fetchCajaStatus: async (modo, userId) => {
    const supabase = createClient();

    let query = supabase
      .from("turnos_caja")
      .select(
        "id, monto_inicial, fecha_apertura, vendedor_id, perfiles(nombre)",
      )
      .eq("estado", "ABIERTO");

    query =
      modo === "UNICA"
        ? query.eq("modo", "UNICA")
        : query.eq("modo", "POR_USUARIO").eq("vendedor_id", userId);

    const { data } = await query.limit(1).maybeSingle();

    if (!data) {
      set({ isCajaAbierta: false, turno: null });
      return;
    }

    // Mismo cálculo que cerrarTurnoAction (caja-action.ts): RPC
    // SECURITY DEFINER para egresos (en modo UNICA la policy
    // egresos_select_propio_o_admin solo deja ver los propios — un SUM
    // directo con esta sesión subestimaría el total).
    const { data: flujoCaja } = await supabase.rpc("flujo_caja_turno", {
      p_turno_id: data.id,
    });
    const montoInicial = Number(data.monto_inicial);

    set({
      isCajaAbierta: true,
      turno: {
        id: data.id,
        monto_inicial: montoInicial,
        fecha_apertura: data.fecha_apertura,
        vendedor_id: data.vendedor_id,
        vendedor_nombre: getSupabaseRelation(data.perfiles)?.nombre ?? null,
        montoActual: montoInicial + Number(flujoCaja ?? 0),
      },
    });
  },
}));
