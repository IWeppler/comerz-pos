/**
 * De qué caja sale la plata de un gasto: el primer paso del modal de egreso.
 *
 * Hasta el 28/9/2026 era un select opcional con "la que corresponda" elegido
 * de antemano, y con el turno abierto eso era la caja chica. Así se cargaron
 * en el cajón sueldos y pagos a proveedores que salieron de la Caja Grande, y
 * cada uno apareció en el arqueo como un sobrante falso (El Nono Cacho:
 * 235.000 en un solo turno). Ahora es una pregunta obligatoria y sin
 * respuesta preseleccionada, y la caja chica muestra cuánto hay en el cajón:
 * si el gasto es más grande, casi seguro no salió de ahí.
 */

export interface CuentaOrigen {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  requiere_arqueo: boolean;
}

export interface EstadoCajaChica {
  abierta: boolean;
  /** El turno abierto es de un día anterior (turno-de-otro-dia.ts). */
  deOtroDia: boolean;
  /** Efectivo esperado ahora en el cajón. */
  disponible: number | null;
}

export interface OpcionOrigenEgreso {
  id: string;
  nombre: string;
  detalle: string;
  esCajaChica: boolean;
  deshabilitada: boolean;
  /** Efectivo en el cajón, solo para la caja chica. */
  disponible: number | null;
}

const DETALLE_POR_TIPO: Record<string, string> = {
  CAJA_GENERAL: "Plata guardada fuera del mostrador",
  BANCO: "Transferencia o débito",
  BILLETERA: "Billetera virtual",
};

function orden(cuenta: CuentaOrigen): number {
  if (cuenta.requiere_arqueo) return 0;
  if (cuenta.tipo === "CAJA_GENERAL") return 1;
  return 2;
}

export function opcionesOrigenEgreso(
  cuentas: CuentaOrigen[],
  cajaChica: EstadoCajaChica,
): OpcionOrigenEgreso[] {
  return cuentas
    // El puente de acreditación no es una cuenta de la que salga plata.
    .filter((c) => c.codigo !== "POR_ACREDITAR" && c.tipo !== "PUENTE_ACREDITACION")
    .slice()
    .sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre, "es"))
    .map((c) => {
      if (!c.requiere_arqueo) {
        return {
          id: c.id,
          nombre: c.nombre,
          detalle: DETALLE_POR_TIPO[c.tipo] ?? "Otra cuenta",
          esCajaChica: false,
          deshabilitada: false,
          disponible: null,
        };
      }
      const deshabilitada = !cajaChica.abierta || cajaChica.deOtroDia;
      return {
        id: c.id,
        nombre: "Caja chica",
        detalle: !cajaChica.abierta
          ? "Abrí la caja para sacar plata del cajón"
          : cajaChica.deOtroDia
            ? "Quedó abierta desde otro día: cerrala primero"
            : "El cajón del mostrador",
        esCajaChica: true,
        deshabilitada,
        disponible: deshabilitada ? null : cajaChica.disponible,
      };
    });
}

/** El gasto supera lo que hay en el cajón: la base lo va a rechazar
 * (SALDO_INSUFICIENTE_CAJA) y casi seguro se pagó con otra plata. */
export function superaCajaChica(
  opcion: OpcionOrigenEgreso | undefined,
  monto: number,
): boolean {
  return Boolean(
    opcion?.esCajaChica &&
      opcion.disponible !== null &&
      Number.isFinite(monto) &&
      monto > opcion.disponible,
  );
}
