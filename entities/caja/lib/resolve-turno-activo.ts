import { SupabaseClient } from "@supabase/supabase-js";
import { esTurnoDeOtroDia } from "./turno-de-otro-dia";

export interface TurnoActivoResuelto {
  turnoId: string | null;
  modoCaja: string;
  requiereCajaAbierta: boolean;
  /** El turno abierto es de un día anterior (quedó abierto de noche). Quien
   * vende o mueve plata del cajón tiene que frenar y pedir que se cierre:
   * ver `turno-de-otro-dia.ts`. */
  turnoDeOtroDia: boolean;
  /** Para comparar contra la hora de una venta offline (ver create-sale). */
  fechaApertura: string | null;
}

/** Las dos columnas de `configuracion_pos` que esta función necesita. */
export interface ConfigTurno {
  modo_caja?: string | null;
  requiere_caja_abierta?: boolean | null;
}

/**
 * `configPrecargada` existe para quien YA trajo esa fila en el mismo request.
 *
 * El caso es `create-sale`: leía `configuracion_pos` acá y otra vez más abajo
 * para el resto de sus columnas. Es la misma fila, y en el camino de la venta
 * un round-trip de más se paga en cada ticket. Los demás llamadores no pasan
 * nada y siguen funcionando igual.
 */
export async function resolverTurnoActivo(
  supabase: SupabaseClient,
  userId: string,
  configPrecargada?: ConfigTurno | null,
): Promise<TurnoActivoResuelto> {
  const config =
    configPrecargada ??
    (
      await supabase
        .from("configuracion_pos")
        .select("modo_caja, requiere_caja_abierta")
        .single()
    ).data;

  const modoCaja = config?.modo_caja || "UNICA";
  const requiereCajaAbierta = config?.requiere_caja_abierta ?? true;

  let query = supabase
    .from("turnos_caja")
    .select("id, fecha_apertura")
    .eq("estado", "ABIERTO");

  if (modoCaja === "UNICA") {
    query = query.eq("modo", "UNICA");
  } else if (modoCaja === "POR_USUARIO") {
    query = query.eq("modo", "POR_USUARIO").eq("usuario_id", userId);
  }

  const { data: turno } = await query.maybeSingle();

  return {
    turnoId: turno?.id ?? null,
    modoCaja,
    requiereCajaAbierta,
    turnoDeOtroDia: esTurnoDeOtroDia(turno?.fecha_apertura),
    fechaApertura: turno?.fecha_apertura ?? null,
  };
}
