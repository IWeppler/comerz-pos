"use server";

import { cookies } from "next/headers";
import { createClient } from "@/shared/config/supabase/server";
import type { PeriodoCalendario } from "@/shared/lib/periodo-ranges";

/**
 * El resumen del período de la pestaña Dinero (`resumen_financiero_periodo`,
 * `20260921235000`): qué PASÓ con la plata entre dos fechas. Es la pregunta
 * complementaria de `posicion_dinero`, que dice DÓNDE está ahora.
 *
 * **`neto_caja` NO es la ganancia** y la pantalla tiene que decirlo al lado
 * del número: es cobrado − reintegros − egresos, sin el costo de la
 * mercadería. La ganancia vive en el panel. Dos números con el mismo nombre
 * y distinta cuenta es la forma más rápida de perder la confianza.
 *
 * El período lo resuelve la BASE (`p_periodo`), mismo motivo que en
 * `posicion_dinero`: la zona horaria y el "hoy" se deciden en un solo lugar.
 */

type Tramo = { metodo_tipo: string; monto: number | string; cantidad: number };

export type ResumenFinancieroPeriodo = {
  desde: string;
  hasta: string;
  periodo: string | null;
  generado_en: string;
  ingresos: {
    /** Todos los cobros NO anulados del período, en bruto. */
    cobrado: number | string;
    /** La parte que es cobro de venta (tipo_movimiento PAGO_VENTA). */
    cobrado_ventas: number | string;
    /** La parte que es cobro de deuda de cuenta corriente. */
    cobros_de_deuda: number | string;
    cantidad: number;
    por_medio: Tramo[];
  };
  reintegros: {
    /** Lo devuelto al cliente por cualquier medio (`reintegros_al_cliente`). */
    total: number | string;
    cantidad: number;
    por_medio: Tramo[];
  };
  egresos: {
    total: number | string;
    /** Sin los DEVOLUCION: esos ya están en `reintegros` (el reintegro en
     * efectivo existe dos veces en la base) y restarlos otra vez sería doble. */
    sin_devolucion: number | string;
    /** Solo OPERATIVO: lo único que resta de la ganancia. */
    gasto_operativo: number | string;
    por_tipo: { tipo: string; monto: number | string; cantidad: number }[];
    gastos_por_categoria: {
      categoria_id: string | null;
      /** "Sin categoría" cuando es null: es un valor, no un hueco. */
      categoria_nombre: string;
      monto: number | string;
      cantidad: number;
    }[];
    sin_categoria: { monto: number | string; cantidad: number };
  };
  /** Pases entre cuentas propias: se informan, no suman. */
  transferencias: { cantidad: number; monto: number | string };
  arqueo: {
    faltantes: number | string;
    sobrantes: number | string;
    turnos_con_diferencia: number;
  };
  /** cobrado − reintegros − egresos sin DEVOLUCION. Flujo, NO ganancia. */
  neto_caja: number | string;
};

export async function getResumenFinancieroAction(
  periodo: PeriodoCalendario = "mes",
): Promise<{ data: ResumenFinancieroPeriodo | null; error: string | null }> {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.rpc("resumen_financiero_periodo", {
    p_periodo: periodo,
  });

  if (error) {
    console.error("Error cargando el resumen financiero:", error);
    const mensaje = error.message.includes("SIN_PERMISO")
      ? "No tenés permiso para ver el resumen financiero."
      : "No se pudo cargar el resumen del período.";
    return { data: null, error: mensaje };
  }
  return { data: data as ResumenFinancieroPeriodo, error: null };
}
