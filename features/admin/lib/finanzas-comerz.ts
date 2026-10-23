/**
 * Las finanzas de Comerz: lo ganado, el gráfico de fijos y variables, y la
 * previsión. Es el negocio PROPIO, no el de un comercio.
 *
 * Todo en pesos, base de la contabilidad, con la conversión de lo que se paga
 * en dólares encapsulada en `montoEnPesos`.
 *
 * Qué es cada cosa (acordado con Ignacio, 23/10/2026):
 *   - Ingreso FIJO: una renovación, el cobro de un comercio que ya había pagado
 *     antes. Es la base recurrente.
 *   - Ingreso VARIABLE: el PRIMER pago de cada comercio (cliente nuevo). Puede o
 *     no repetirse el mes que viene, y es lo que dispara la comisión.
 *   - Egreso FIJO: un gasto `FIJO` (Vercel, Supabase).
 *   - Egreso VARIABLE: un gasto `UNICO`, incluidas las comisiones (el sueldo de
 *     Romina es lo que paga el primer cobro de cada cliente que consigue).
 *   - Ganado = ingresos − egresos del mes, sobre lo que ENTRÓ y SALIÓ en el
 *     mes (base caja), igual que el gráfico de cobrado de siempre.
 *
 * La PREVISIÓN solo cuenta lo recurrente: las renovaciones de comercios al día
 * y los gastos fijos. No inventa clientes nuevos ni gastos variables: con la
 * muestra de hoy (un puñado de comercios) un supuesto de conversión es una
 * intuición con forma de número. El comercio con el plan VENCIDO no se cuenta
 * como ingreso seguro: va aparte, como "en riesgo".
 *
 * Puro y sin reloj ni red: se testea sin base.
 */

import { diaComercial } from "@/entities/caja/lib/turno-de-otro-dia";
import { gastoAplicaEnMes } from "@/features/admin/lib/gastos-por-mes";
import { usdAPesos } from "@/features/admin/lib/cotizacion-mep";
import { precioPorCiclo, type Modalidad } from "@/shared/lib/planes";

export type Moneda = "ARS" | "USD";

export interface GastoFinanciero {
  tipo: "FIJO" | "UNICO";
  /** "YYYY-MM-DD": su mes (ÚNICO) o el primero en que aplica (FIJO). */
  mes: string;
  hasta: string | null;
  /** Pesos. Para un gasto en USD es el equivalente al momento de cargarlo. */
  monto: number;
  moneda: Moneda;
  /** Monto original en dólares, si `moneda` es USD. */
  montoUsd: number | null;
  /** MEP con el que se cargó. */
  cotizacion: number | null;
}

export interface PagoFinanciero {
  id: string;
  negocioId: string;
  monto: number;
  /** "YYYY-MM-DD" (o ISO): el mes en que ENTRÓ la plata. */
  fechaPago: string;
}

export interface ContextoCotizacion {
  /** MEP de hoy. Null = no se pudo leer: se cae a lo guardado en pesos. */
  mepActual: number | null;
  /** "YYYY-MM" del mes en curso. */
  mesActual: string;
}

const claveMes = (fecha: string) => String(fecha).slice(0, 7);

/**
 * Cuánto pesa un gasto en un mes, en pesos.
 *
 * - En pesos: el monto.
 * - ÚNICO en dólares: el monto en pesos CONGELADO al cargarlo. Un gasto que ya
 *   pasó no se recalcula cada día con la cotización de hoy.
 * - FIJO en dólares: es una factura que sigue llegando en dólares, así que el
 *   mes en curso y los que vienen van al MEP de hoy. Los meses pasados, al
 *   MEP con que se cargó (no se guarda la cotización de cada mes).
 * Sin cotización disponible, lo guardado en pesos: mejor un número viejo y
 * visible que un cero.
 */
export function montoEnPesos(
  gasto: GastoFinanciero,
  mes: string,
  ctx: ContextoCotizacion,
): number {
  if (gasto.moneda === "ARS" || gasto.montoUsd === null) return gasto.monto;
  if (gasto.tipo === "UNICO") return gasto.monto;

  if (mes < ctx.mesActual) {
    if (gasto.cotizacion !== null) return usdAPesos(gasto.montoUsd, gasto.cotizacion);
    return ctx.mepActual !== null ? usdAPesos(gasto.montoUsd, ctx.mepActual) : gasto.monto;
  }
  return ctx.mepActual !== null ? usdAPesos(gasto.montoUsd, ctx.mepActual) : gasto.monto;
}

/**
 * Cuáles pagos son el PRIMERO de su comercio. Empate de fecha: gana el id
 * menor, para que dos corridas den lo mismo.
 */
export function clasificarPagos(
  pagos: PagoFinanciero[],
): Map<string, "FIJO" | "VARIABLE"> {
  const primeroPorNegocio = new Map<string, PagoFinanciero>();
  for (const p of pagos) {
    const actual = primeroPorNegocio.get(p.negocioId);
    if (
      !actual ||
      p.fechaPago < actual.fechaPago ||
      (p.fechaPago === actual.fechaPago && p.id < actual.id)
    ) {
      primeroPorNegocio.set(p.negocioId, p);
    }
  }
  const resultado = new Map<string, "FIJO" | "VARIABLE">();
  for (const p of pagos) {
    resultado.set(p.id, primeroPorNegocio.get(p.negocioId)?.id === p.id ? "VARIABLE" : "FIJO");
  }
  return resultado;
}

export interface ResultadoMes {
  mes: string;
  ingresosFijos: number;
  ingresosVariables: number;
  egresosFijos: number;
  egresosVariables: number;
  ingresos: number;
  egresos: number;
  /** ingresos − egresos. */
  ganado: number;
}

const suma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function resultadoDelMes(
  pagos: PagoFinanciero[],
  gastos: GastoFinanciero[],
  mes: string,
  ctx: ContextoCotizacion,
  /** Se pasa precalculado cuando se llama muchas veces (la serie). */
  clases: Map<string, "FIJO" | "VARIABLE"> = clasificarPagos(pagos),
): ResultadoMes {
  const delMes = pagos.filter((p) => claveMes(p.fechaPago) === mes);
  const ingresosFijos = suma(delMes.filter((p) => clases.get(p.id) === "FIJO").map((p) => p.monto));
  const ingresosVariables = suma(delMes.filter((p) => clases.get(p.id) === "VARIABLE").map((p) => p.monto));

  const aplican = gastos.filter((g) => gastoAplicaEnMes(g, mes));
  const egresosFijos = suma(aplican.filter((g) => g.tipo === "FIJO").map((g) => montoEnPesos(g, mes, ctx)));
  const egresosVariables = suma(aplican.filter((g) => g.tipo === "UNICO").map((g) => montoEnPesos(g, mes, ctx)));

  const ingresos = ingresosFijos + ingresosVariables;
  const egresos = egresosFijos + egresosVariables;
  return {
    mes,
    ingresosFijos,
    ingresosVariables,
    egresosFijos,
    egresosVariables,
    ingresos,
    egresos,
    ganado: ingresos - egresos,
  };
}

/** "2026-10" + n meses. */
export function sumarMesesAClave(clave: string, n: number): string {
  const [anio, mes] = clave.split("-").map(Number);
  const total = anio * 12 + (mes - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Los meses de `desde` a `hasta`, ambos incluidos. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const lista: string[] = [];
  for (let m = desde; m <= hasta; m = sumarMesesAClave(m, 1)) lista.push(m);
  return lista;
}

/** "2026-01-31" + 1 mes = "2026-02-28": el día se ajusta al largo del mes. */
export function sumarMesesAFecha(fecha: string, n: number): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number);
  const destino = sumarMesesAClave(`${anio}-${String(mes).padStart(2, "0")}`, n);
  const [a, m] = destino.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${destino}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

export interface PuntoFinanciero extends ResultadoMes {
  /** Ganado acumulado desde el primer cobro hasta este mes, incluido. */
  acumulado: number;
}

/**
 * El resultado de cada mes pedido, con el ganado ACUMULADO desde el primer
 * cobro (aunque ese cobro sea anterior al primer mes pedido). Sin cobros, el
 * acumulado arranca en el primer mes pedido.
 */
export function serieFinanciera(
  pagos: PagoFinanciero[],
  gastos: GastoFinanciero[],
  meses: string[],
  ctx: ContextoCotizacion,
): PuntoFinanciero[] {
  if (meses.length === 0) return [];
  const clases = clasificarPagos(pagos);
  const primerCobro = pagos.length > 0 ? pagos.map((p) => claveMes(p.fechaPago)).sort()[0] : null;
  const inicio = primerCobro !== null && primerCobro < meses[0] ? primerCobro : meses[0];
  const ultimo = meses[meses.length - 1];

  let acumulado = 0;
  const puntos: PuntoFinanciero[] = [];
  for (const mes of mesesEntre(inicio, ultimo)) {
    const r = resultadoDelMes(pagos, gastos, mes, ctx, clases);
    acumulado += r.ganado;
    if (meses.includes(mes)) puntos.push({ ...r, acumulado });
  }
  return puntos;
}

export interface NegocioParaPrevision {
  id: string;
  estado: string;
  /** ISO del vencimiento del plan. Null = no se sabe cuándo paga. */
  planVencimiento: string | null;
  /** Lo que paga por mes: acordado o de lista. */
  precioMensual: number;
  modalidad: Modalidad;
  /** `cuenta_en_mrr`: una cortesía no suma. */
  cuentaEnMrr: boolean;
}

export interface MesPrevisto {
  mes: string;
  /** Renovaciones esperadas de comercios al día. */
  ingresosFijos: number;
  /** Comercios con el plan vencido: lo que pagarían si pagan, sin contarlo. */
  enRiesgo: number;
  /** Gastos fijos que faltan. En el MES EN CURSO es 0: la serie ya cuenta el
   * gasto fijo entero en el mes en que aplica, y sumarlo de nuevo lo
   * descontaría dos veces. */
  egresosFijos: number;
  /** ingresosFijos − egresosFijos. No incluye `enRiesgo`. */
  neto: number;
}

export interface Prevision {
  meses: MesPrevisto[];
  /** Comercios activos que cobran pero no tienen fecha de vencimiento: no se
   * pudieron ubicar en el tiempo y NO están en la previsión. */
  sinFecha: number;
}

/**
 * Lo que se espera cobrar y gastar en los próximos meses, partiendo de HOY.
 *
 * Cada comercio activo que paga renueva en su fecha de vencimiento, cada mes
 * (o cada seis, con el descuento semestral). El mes en curso solo cuenta lo
 * que todavía falta cobrar: lo ya cobrado está en la serie.
 */
export function pronosticar(
  negocios: NegocioParaPrevision[],
  gastos: GastoFinanciero[],
  hoy: Date,
  cantidadMeses: number,
  ctx: ContextoCotizacion,
): Prevision {
  const hoyDia = diaComercial(hoy);
  const mesInicial = hoyDia.slice(0, 7);
  const meses = mesesEntre(mesInicial, sumarMesesAClave(mesInicial, Math.max(cantidadMeses, 1) - 1));
  const ultimo = meses[meses.length - 1];

  const ingresos = new Map<string, number>(meses.map((m) => [m, 0]));
  const riesgo = new Map<string, number>(meses.map((m) => [m, 0]));
  let sinFecha = 0;

  for (const n of negocios) {
    if (n.estado !== "activo" || !n.cuentaEnMrr || n.precioMensual <= 0) continue;
    if (!n.planVencimiento) {
      sinFecha += 1;
      continue;
    }
    const vence = diaComercial(n.planVencimiento);
    const monto = precioPorCiclo(n.precioMensual, n.modalidad);
    const paso = n.modalidad === "semestral" ? 6 : 1;

    if (vence < hoyDia) {
      // Vencido: no se cuenta como ingreso seguro.
      riesgo.set(mesInicial, (riesgo.get(mesInicial) ?? 0) + monto);
      continue;
    }
    for (let k = 0; ; k += 1) {
      const fecha = sumarMesesAFecha(vence, k * paso);
      const mes = fecha.slice(0, 7);
      if (mes > ultimo) break;
      ingresos.set(mes, (ingresos.get(mes) ?? 0) + monto);
    }
  }

  const resultado: MesPrevisto[] = meses.map((mes) => {
    const egresosFijos =
      mes === mesInicial
        ? 0
        : suma(
            gastos
              .filter((g) => g.tipo === "FIJO" && gastoAplicaEnMes(g, mes))
              .map((g) => montoEnPesos(g, mes, ctx)),
          );
    const ingresosFijos = ingresos.get(mes) ?? 0;
    return {
      mes,
      ingresosFijos,
      enRiesgo: riesgo.get(mes) ?? 0,
      egresosFijos,
      neto: ingresosFijos - egresosFijos,
    };
  });

  return { meses: resultado, sinFecha };
}

/**
 * La línea de ganado acumulado hacia adelante: parte de lo acumulado hasta hoy
 * y suma el neto previsto de cada mes. No incluye `enRiesgo` ni clientes
 * nuevos.
 */
export function saldoProyectado(
  acumuladoHoy: number,
  prevision: Prevision,
): { mes: string; saldo: number }[] {
  let saldo = acumuladoHoy;
  return prevision.meses.map((m) => {
    saldo += m.neto;
    return { mes: m.mes, saldo };
  });
}
