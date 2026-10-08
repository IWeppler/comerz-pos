export interface EstadoWizardInicio {
  cajaAbierta: boolean | null;
  ventaLibreAbierta: boolean;
  ticketConLineas: boolean;
  primeraVenta: boolean;
  ruta: string;
}
export type PasoWizardInicio = "caja" | "venta-libre" | "cobrar";
export function pasoWizardInicio(
  estado: EstadoWizardInicio,
): PasoWizardInicio | null {
  if (
    estado.primeraVenta ||
    estado.ruta !== "/pos" ||
    estado.cajaAbierta === null
  )
    return null;
  if (!estado.cajaAbierta) return "caja";
  if (estado.ticketConLineas) return "cobrar";
  return estado.ventaLibreAbierta ? null : "venta-libre";
}
