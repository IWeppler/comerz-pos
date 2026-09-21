"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/config/supabase/server";
import { PERMISOS, tienePermiso } from "@/shared/lib/permisos";
import { resolverTurnoActivo } from "@/entities/caja/lib/resolve-turno-activo";
import type { CajaActionState } from "@/entities/caja/types";
import { esTipoIngreso } from "../lib/tipo-ingreso";

/**
 * Ingresos que no vienen de una venta (`20260922100000`): aporte de la
 * dueña, préstamo recibido, otro ingreso. Toda la regla vive en la RPC
 * `registrar_ingreso_financiero`: permiso, cuenta por defecto (con turno →
 * cajón, sin turno → caja general), turno ABIERTO si la cuenta es arqueada,
 * impacto en el resultado según el tipo. Acá se traducen el form y los
 * códigos de error.
 *
 * El turno viaja resuelto desde acá (misma forma que la transferencia): la
 * RPC no puede saber cuál es "mi turno" porque el modo de caja (UNICA /
 * POR_USUARIO) vive en `configuracion_pos` y lo lee `resolverTurnoActivo`.
 */

const MENSAJES_REGISTRAR: Record<string, string> = {
  SIN_PERMISO: "No tenés permiso para registrar ingresos.",
  MONTO_INVALIDO: "Ingresá un monto válido.",
  CONCEPTO_REQUERIDO: "Contá de dónde viene la plata.",
  TIPO_INVALIDO: "Elegí qué tipo de ingreso es.",
  CAJA_DIARIA_REQUIERE_TURNO_ABIERTO:
    "Para que entre a la Caja diaria tenés que tener tu turno abierto. Sin turno, elegí otra cuenta o dejá que vaya a Caja general.",
  CUENTA_NO_DISPONIBLE: "La cuenta elegida no está disponible.",
  CUENTA_PUENTE_RESERVADA: "Esa cuenta la maneja el sistema; elegí otra.",
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
};

export async function registrarIngresoAction(
  _prevState: CajaActionState,
  formData: FormData,
): Promise<CajaActionState> {
  const concepto = String(formData.get("concepto") ?? "").trim();
  const monto = Number(formData.get("monto"));
  const tipo = String(formData.get("tipo") ?? "");
  // "" = que decida la base (con turno → cajón, sin turno → caja general).
  const cuentaId = String(formData.get("cuenta_destino_id") ?? "") || null;

  if (!concepto || !Number.isFinite(monto) || monto <= 0) {
    return { error: "Ingresá un concepto y un monto válido.", success: false };
  }
  if (!esTipoIngreso(tipo)) {
    return { error: MENSAJES_REGISTRAR.TIPO_INVALIDO, success: false };
  }

  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado.", success: false };
  // El mensaje amable; el freno es la RPC.
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_REGISTRAR_INGRESO))) {
    return { error: MENSAJES_REGISTRAR.SIN_PERMISO, success: false };
  }

  const { turnoId } = await resolverTurnoActivo(supabase, user.id);

  const { error } = await supabase.rpc("registrar_ingreso_financiero", {
    p_monto: monto,
    p_tipo: tipo,
    p_concepto: concepto,
    p_cuenta_id: cuentaId,
    p_turno_caja_id: turnoId,
  });
  if (error) {
    console.error("Error registrando ingreso:", error);
    const codigo = Object.keys(MENSAJES_REGISTRAR).find((c) =>
      error.message.includes(c),
    );
    return {
      error: codigo ? MENSAJES_REGISTRAR[codigo] : "No se pudo registrar el ingreso.",
      success: false,
    };
  }

  revalidatePath("/");
  revalidatePath("/caja");
  revalidatePath("/", "layout");
  return { error: null, success: true };
}

/**
 * Anular un ingreso (`anular_ingreso_financiero`). A diferencia del gasto,
 * la fila NO se borra: queda marcada y el ledger recibe la reversa, fechada
 * en el ingreso. Frenos en la RPC: permiso `caja.anular_movimiento`, motivo,
 * turno ABIERTO si la cuenta es arqueada.
 */
const MENSAJES_ANULAR: Record<string, string> = {
  SIN_PERMISO: "Solo una administradora puede anular un ingreso.",
  MOTIVO_REQUERIDO: "Contá por qué se anula.",
  INGRESO_NO_ENCONTRADO: "Ese ingreso no existe.",
  INGRESO_YA_ANULADO: "Ese ingreso ya estaba anulado.",
  INGRESO_DE_CAJA_SIN_TURNO:
    "Ese ingreso de caja no tiene turno; revisalo desde el historial.",
  TURNO_CERRADO:
    "El turno de ese ingreso ya se cerró y se firmó. Registralo como egreso de corrección en el turno abierto.",
  SIN_NEGOCIO_ACTIVO: "No hay un comercio activo en esta sesión.",
};

export async function anularIngresoAction(
  ingresoId: string,
  motivo: string,
): Promise<CajaActionState> {
  if (!ingresoId || !motivo.trim()) {
    return { error: MENSAJES_ANULAR.MOTIVO_REQUERIDO, success: false };
  }
  const supabase = createClient(await cookies());
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autorizado.", success: false };
  if (!(await tienePermiso(supabase, PERMISOS.CAJA_ANULAR_MOVIMIENTO))) {
    return { error: MENSAJES_ANULAR.SIN_PERMISO, success: false };
  }

  const { error } = await supabase.rpc("anular_ingreso_financiero", {
    p_ingreso_id: ingresoId,
    p_motivo: motivo.trim(),
  });
  if (error) {
    console.error("Error anulando ingreso:", error);
    const codigo = Object.keys(MENSAJES_ANULAR).find((c) =>
      error.message.includes(c),
    );
    return {
      error: codigo ? MENSAJES_ANULAR[codigo] : "No se pudo anular el ingreso.",
      success: false,
    };
  }

  revalidatePath("/");
  revalidatePath("/caja");
  return { error: null, success: true };
}
