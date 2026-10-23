/**
 * Lo que dibuja el panel de finanzas de /admincomerz: los meses ya vividos con
 * sus ingresos y egresos reales, y los meses que vienen con la previsión.
 *
 * Arma las dos cosas en una sola lista de puntos para el gráfico, y los KPIs
 * del mes en curso. La cuenta de fondo está en `finanzas-comerz.ts`; esto solo
 * la ordena para mostrarla.
 *
 * Puro: sin reloj, sin red, sin base.
 */

import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import {
  mesesEntre,
  pronosticar,
  resultadoDelMes,
  clasificarPagos,
  serieFinanciera,
  sumarMesesAClave,
  type ContextoCotizacion,
  type GastoFinanciero,
  type NegocioParaPrevision,
  type PagoFinanciero,
  type ResultadoMes,
} from "@/features/admin/lib/finanzas-comerz";

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** "2026-10" → "oct 26". */
export function etiquetaMes(clave: string): string {
  const [anio, mes] = clave.split("-").map(Number);
  return `${MESES[mes - 1]} ${String(anio).slice(2)}`;
}

export interface PuntoGrafico {
  mes: string;
  etiqueta: string;
  /** Lo que ya pasó. En los meses futuros, todo cero. */
  ingresosFijos: number;
  ingresosVariables: number;
  egresosFijos: number;
  egresosVariables: number;
  /** Lo que se espera cobrar y gastar y todavía no pasó. */
  ingresosPrevistos: number;
  egresosPrevistos: number;
  /** Comercios con el plan vencido: lo que cobrarías si pagan. No suma. */
  enRiesgo: number;
  /** Ganado acumulado REAL (hasta el mes en curso, incluido). Null después. */
  acumulado: number | null;
  /** Ganado acumulado hacia adelante (del mes en curso en adelante). */
  proyectado: number | null;
  /** true desde el mes en curso (tiene algo previsto) en adelante. */
  conPrevision: boolean;
  esMesActual: boolean;
}

export interface VistaFinanzas {
  puntos: PuntoGrafico[];
  mesActual: ResultadoMes;
  /** Mes anterior, para la variación. Null si no había nada. */
  mesAnterior: ResultadoMes | null;
  /** Ganado acumulado hasta hoy. */
  acumuladoHoy: number;
  /** Lo previsto para el mes que viene, en neto. */
  netoProximoMes: number | null;
  /** Lo que está en riesgo ahora (planes vencidos). */
  enRiesgo: number;
  /** Activos que cobran y no tienen fecha de vencimiento. */
  sinFecha: number;
}

export function armarVistaFinanzas(params: {
  pagos: PagoFinanciero[];
  gastos: GastoFinanciero[];
  negocios: NegocioParaPrevision[];
  hoy: Date;
  ctx: ContextoCotizacion;
  mesesAtras?: number;
  mesesAdelante?: number;
}): VistaFinanzas {
  const { pagos, gastos, negocios, hoy, ctx } = params;
  const atras = params.mesesAtras ?? 5;
  const adelante = params.mesesAdelante ?? 6;

  const mesActual = diaComercial(hoy).slice(0, 7);
  const pasados = mesesEntre(sumarMesesAClave(mesActual, -atras), mesActual);

  const serie = serieFinanciera(pagos, gastos, pasados, ctx);
  const prevision = pronosticar(negocios, gastos, hoy, adelante + 1, ctx);
  const previsto = new Map(prevision.meses.map((m) => [m.mes, m]));

  const acumuladoHoy = serie[serie.length - 1]?.acumulado ?? 0;

  const puntos: PuntoGrafico[] = serie.map((p) => {
    const esMesActual = p.mes === mesActual;
    const futuro = esMesActual ? previsto.get(p.mes) : undefined;
    return {
      mes: p.mes,
      etiqueta: etiquetaMes(p.mes),
      ingresosFijos: p.ingresosFijos,
      ingresosVariables: p.ingresosVariables,
      egresosFijos: p.egresosFijos,
      egresosVariables: p.egresosVariables,
      ingresosPrevistos: futuro?.ingresosFijos ?? 0,
      egresosPrevistos: 0, // el fijo del mes en curso ya está contado entero
      enRiesgo: futuro?.enRiesgo ?? 0,
      acumulado: p.acumulado,
      proyectado: esMesActual
        ? p.acumulado + (futuro?.neto ?? 0)
        : null,
      conPrevision: esMesActual,
      esMesActual,
    };
  });

  let saldo = puntos[puntos.length - 1]?.proyectado ?? acumuladoHoy;
  for (const m of prevision.meses) {
    if (m.mes === mesActual) continue;
    saldo += m.neto;
    puntos.push({
      mes: m.mes,
      etiqueta: etiquetaMes(m.mes),
      ingresosFijos: 0,
      ingresosVariables: 0,
      egresosFijos: 0,
      egresosVariables: 0,
      ingresosPrevistos: m.ingresosFijos,
      egresosPrevistos: m.egresosFijos,
      enRiesgo: 0,
      acumulado: null,
      proyectado: saldo,
      conPrevision: true,
      esMesActual: false,
    });
  }

  const clases = clasificarPagos(pagos);
  const mesAnteriorClave = sumarMesesAClave(mesActual, -1);
  const anterior = resultadoDelMes(pagos, gastos, mesAnteriorClave, ctx, clases);
  const hayAnterior =
    anterior.ingresos !== 0 || anterior.egresos !== 0;

  const proximo = prevision.meses.find((m) => m.mes === sumarMesesAClave(mesActual, 1));

  return {
    puntos,
    mesActual: resultadoDelMes(pagos, gastos, mesActual, ctx, clases),
    mesAnterior: hayAnterior ? anterior : null,
    acumuladoHoy,
    netoProximoMes: proximo ? proximo.neto : null,
    enRiesgo: prevision.meses[0]?.enRiesgo ?? 0,
    sinFecha: prevision.sinFecha,
  };
}
