import {
  DIAS_CHART,
  resolverRangoAnterior,
  type PeriodoPanel,
} from "@/shared/lib/periodo-ranges";
import { SEMANAS_DIA_TIPICO } from "./dia-tipico";
import { VENTANA_ROTACION_DIAS } from "./detectar-quiebres";
import {
  DIAS_VENTANA_FIN_TEMPORADA,
  DIAS_VENTANA_PROXIMA_TEMPORADA,
} from "./detectar-estacionalidad";
import { DIAS_SIN_MOVIMIENTO } from "@/features/reports/actions/get-advisor-insights";

/**
 * Desde qué fecha necesita ventas el panel (`/`).
 *
 * El panel traía el historial ENTERO (`getVentasAction()` sin rango) y cada
 * cálculo recortaba en memoria lo suyo. Funcionaba, pero el payload crecía con
 * cada venta y sin techo: Evens suma ~15 ventas por día, así que en un año son
 * ~5.500 tickets con sus renglones, pagos y comprobantes bajados en cada
 * apertura del panel, que es la pantalla de entrada. Con 4 comercios no se
 * nota; con 50 y dos años de historia es el payload más grande del sistema.
 *
 * ESTE ARCHIVO ES LA LISTA de todo lo que el panel calcula sobre ventas y
 * hasta dónde mira cada cosa. Si aparece un cálculo nuevo que necesite más
 * historia, se agrega acá — no en la página — y el test lo cubre. Una regla
 * que mire más atrás que esta ventana no falla: devuelve un número más chico
 * sin ningún error, que es la peor forma de romperse.
 *
 *   KPIs y badges ....... `resolverRangoAnterior(periodo)`: hasta 2 × el
 *                         período (728 días con "Año").
 *   Día típico ("Hoy") .. los últimos SEMANAS_DIA_TIPICO mismos días de
 *                         semana: hoy − 56 días, contando desde su 00:00.
 *   Gráfico ............. DIAS_CHART días.
 *   Comerz Insights ..... DIAS_INSIGHTS días.
 *   Quiebres y riesgo ... VENTANA_ROTACION_DIAS.
 *   Temporada ........... DIAS_VENTANA_FIN_TEMPORADA / _PROXIMA_TEMPORADA.
 *   Inventario estancado  DIAS_SIN_MOVIMIENTO. Este es el que engaña: la regla
 *                         cuenta los productos con stock cuya última venta
 *                         cargada tiene ≥ 30 días, y un producto SIN ventas en
 *                         lo cargado vale 9999 días. Con una ventana de al
 *                         menos 31 días el resultado es idéntico al del
 *                         historial completo: lo vendido hace 31+ días cuenta
 *                         igual, esté la venta cargada (31+) o no (9999). Con
 *                         una ventana menor, contaría como estancado algo que
 *                         se vendió anteayer.
 *
 * El piso es el mayor de todos, más un día de margen para que la ventana
 * arranque a las 00:00 del día más viejo que alguien mira.
 */

/** Ventana de Comerz Insights. NO es la del selector: lo que necesita tu
 * atención no cambia porque alguien haya clickeado "Hoy". Ver el comentario
 * largo en `app/(dashboard)/page.tsx`. */
export const DIAS_INSIGHTS = 28;

export const DIAS_MINIMOS_HISTORIAL_PANEL = Math.max(
  SEMANAS_DIA_TIPICO * 7 + 1,
  DIAS_SIN_MOVIMIENTO + 1,
  DIAS_CHART,
  DIAS_INSIGHTS,
  VENTANA_ROTACION_DIAS,
  DIAS_VENTANA_FIN_TEMPORADA,
  DIAS_VENTANA_PROXIMA_TEMPORADA,
);

function inicioDelDia(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

/**
 * La fecha más vieja que el panel necesita para `periodo`, a las 00:00 local.
 * Es el `desde` de `getVentasAction` y de todo lo que se filtre por fecha en
 * la misma pantalla (egresos, bajas, cobros de cuenta corriente).
 */
export function resolverDesdeHistorialPanel(
  periodo: PeriodoPanel,
  ahora: Date,
): Date {
  const piso = inicioDelDia(
    new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate() - (DIAS_MINIMOS_HISTORIAL_PANEL - 1),
    ),
  );
  const anterior = resolverRangoAnterior(periodo, ahora).inicio;
  return anterior < piso ? anterior : piso;
}
