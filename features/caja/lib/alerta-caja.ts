/**
 * Las alertas de /caja → Auditoría. Las arma la base (`alertas_caja`,
 * `20260928200000`); acá viven el tipo y lo que la pantalla necesita para
 * filtrarlas y agruparlas, sin IO.
 */

export type SeveridadAlerta = "ALTA" | "MEDIA" | "BAJA";

export interface AlertaCaja {
  clave: string;
  tipo: string;
  severidad: SeveridadAlerta;
  fecha: string;
  titulo: string;
  detalle: string;
  monto: number | null;
  turno_id: string | null;
  revisada: boolean;
  revisada_por: string | null;
  revisada_en: string | null;
  nota: string | null;
}

export type FiltroEstadoAlerta = "pendientes" | "revisadas" | "todas";

export const ETIQUETA_SEVERIDAD: Record<SeveridadAlerta, string> = {
  ALTA: "Urgente",
  MEDIA: "Revisar",
  BAJA: "Para saber",
};

/** Qué mirar para resolver cada tipo. Fail-closed: un tipo nuevo que la
 * pantalla no conoce no inventa un consejo. */
export const QUE_HACER: Record<string, string> = {
  TURNO_DE_OTRO_DIA: "Cerrá la caja contando el efectivo desde el botón de caja.",
  CIERRE_AL_DIA_SIGUIENTE: "Revisá en Cierres que las ventas del turno sean todas de su día.",
  DIFERENCIA_ARQUEO: "Revisá los gastos del turno: ¿alguno se pagó con otra plata? ¿Falta cargar alguno?",
  FONDO_COPIADO: "Preguntá con cuánto se abrió realmente la caja.",
  MOVIDO_ENTRE_TURNOS: "Confirmá que esa plata esté en la Caja Grande.",
  CAMBIO_COMO_GASTO: "Anulá el gasto y registralo como transferencia a la cuenta donde entró.",
  GASTO_GRANDE_CAJA_CHICA: "Confirmá que haya salido del cajón y no de la Caja Grande.",
  SALIDA_CAJA_GRANDE: "Nada, salvo que no la reconozcas.",
  DEVOLUCION_EFECTIVO: "Nada, salvo que no la reconozcas.",
  COBRO_CORREGIDO: "Confirmá con quién lo cambió y por qué.",
  AJUSTE_CUENTA: "Si identificás alguna de esas salidas, cargala y achicá el ajuste.",
  CAJA_GRANDE_NEGATIVA: "Buscá la entrada que falta o la salida cargada en la cuenta equivocada.",
};

export function filtrarAlertas(
  alertas: AlertaCaja[],
  estado: FiltroEstadoAlerta,
  severidades: SeveridadAlerta[],
): AlertaCaja[] {
  return alertas.filter(
    (a) =>
      (estado === "todas" || (estado === "pendientes" ? !a.revisada : a.revisada)) &&
      (severidades.length === 0 || severidades.includes(a.severidad)),
  );
}

/** Lo que cuenta el aviso: urgentes y para revisar, sin revisar. Mismo
 * criterio que `alertas_caja_pendientes` en la base. */
export function contarPendientes(alertas: AlertaCaja[]): number {
  return alertas.filter((a) => !a.revisada && a.severidad !== "BAJA").length;
}
