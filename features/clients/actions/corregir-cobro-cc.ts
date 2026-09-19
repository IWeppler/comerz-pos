"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";

const MENSAJES: Record<string, string> = {
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
  SIN_PERMISO: "No tenés permiso para corregir cobros de cuenta corriente.",
  COBRO_INEXISTENTE: "No se encontró el cobro.",
  COBRO_NO_CORREGIBLE: "Este movimiento no es un cobro de cuenta corriente confirmado.",
  COBRO_SIN_MOVIMIENTO: "El cobro no tiene un movimiento de cuenta corriente válido.",
  COBRO_AJENO:
    "Este cobro lo registró otra persona. Solo ella o una administradora puede corregirlo.",
  TURNO_CERRADO_REQUIERE_ADMIN:
    "La caja de este cobro ya cerró. Solo una administradora puede corregirlo porque el arqueo original debe conservarse.",
  METODO_INEXISTENTE: "Ese método de pago no existe o está desactivado.",
  MISMO_METODO: "El cobro ya está registrado con ese método.",
};

export interface CorreccionCobroCC {
  metodoAnterior: string;
  metodoNuevo: string;
  totalAnterior: number;
  totalNuevo: number;
  diferenciaTotal: number;
  turnoCerrado: boolean;
}

export async function corregirCobroCCAction(
  pagoId: string,
  metodoPagoId: string,
  motivo?: string,
): Promise<{ data: CorreccionCobroCC | null; error: string | null }> {
  try {
    const supabase = createClient(await cookies());
    const { data, error } = await supabase.rpc("corregir_metodo_pago_cobro_cc", {
      p_pago_id: pagoId,
      p_metodo_pago_id: metodoPagoId,
      p_motivo: motivo?.trim() || null,
    });

    if (error || !data) {
      const codigo = Object.keys(MENSAJES).find((clave) =>
        error?.message?.includes(clave),
      );
      console.error("[CORRECCION COBRO CC] No se pudo corregir:", {
        pagoId,
        metodoPagoId,
        error,
      });
      return {
        data: null,
        error: codigo
          ? MENSAJES[codigo]
          : "No se pudo corregir el medio de pago del cobro.",
      };
    }

    const resultado = data as {
      metodo_anterior: string;
      metodo_nuevo: string;
      total_anterior: number;
      total_nuevo: number;
      diferencia_total: number;
      turno_cerrado: boolean;
    };

    revalidatePath("/");
    revalidatePath("/clientes");
    revalidatePath("/caja");
    revalidatePath("/reportes");

    return {
      data: {
        metodoAnterior: resultado.metodo_anterior,
        metodoNuevo: resultado.metodo_nuevo,
        totalAnterior: Number(resultado.total_anterior),
        totalNuevo: Number(resultado.total_nuevo),
        diferenciaTotal: Number(resultado.diferencia_total),
        turnoCerrado: Boolean(resultado.turno_cerrado),
      },
      error: null,
    };
  } catch (error) {
    console.error("[CORRECCION COBRO CC] Error inesperado:", error);
    return {
      data: null,
      error: "Ocurrió un error inesperado al corregir el cobro.",
    };
  }
}
