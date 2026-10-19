/**
 * Venta en cuotas de la cuenta corriente (ver docs/cuenta-corriente.md,
 * "Venta en cuotas"). Una venta en N cuotas son N tickets de deuda, cada uno
 * con su vencimiento.
 *
 * ESPEJO de lo que hace `registrar_venta` al recibir `cuotas` en `p_cc`: la
 * base relee la tasa, reparte y fecha con la misma regla. Los casos del test
 * son los del guard de la migración, así los dos dicen lo mismo.
 */

import {
  calcularOpcion,
  leerTasas,
  type TasaFinanciacion,
} from "@/shared/lib/cuotas";

export type CuotaCc = {
  /** 1..N */
  numero: number;
  monto: number;
  /** "YYYY-MM-DD" */
  venceEl: string;
};

export type PlanCuotasCc = {
  cuotas: number;
  pct: number;
  /** Lo que se financia: subtotal − entrega − saldo a favor. */
  financiado: number;
  /** El interés del plan; va a `ventas.recargo_cc_monto`. */
  interes: number;
  /** financiado + interés = Σ cuotas = `ventas.monto_pendiente`. */
  totalFinanciado: number;
  detalle: CuotaCc[];
};

/**
 * La tasa configurada para esa cantidad de cuotas, o null. Fail-closed: una
 * cantidad que el comercio no configuró no se vende (la base rechaza con
 * `PLAN_CUOTAS_INVALIDO`), no cae a un porcentaje por default.
 */
export function tasaParaCuotas(
  tasasRaw: unknown,
  cuotas: number,
): TasaFinanciacion | null {
  return leerTasas(tasasRaw).find((t) => t.cuotas === cuotas) ?? null;
}

function diasDelMes(anio: number, mes0: number): number {
  return new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate();
}

/**
 * Vencimientos mensuales: la cuota k vence `fecha + k meses`, contado SIEMPRE
 * desde la fecha de venta. Si el mes no tiene ese día, el último del mes:
 * 31/1 → 28/2, 31/3, 30/4 (encadenado daría 28/2, 28/3, 28/4). Es lo que hace
 * Postgres con `fecha + k * interval '1 month'`.
 */
export function vencimientosMensuales(fecha: string, cuotas: number): string[] {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number);
  return Array.from({ length: cuotas }, (_, i) => {
    const mesTotal = mes - 1 + i + 1;
    const a = anio + Math.floor(mesTotal / 12);
    const m0 = mesTotal % 12;
    const d = Math.min(dia, diasDelMes(a, m0));
    return new Date(Date.UTC(a, m0, d)).toISOString().slice(0, 10);
  });
}

/**
 * Traduce los rechazos de `cc_registrar_cuotas_venta` a un mensaje para la
 * vendedora. null = no es un rechazo del plan.
 */
export function mensajeRechazoPlanCuotas(
  error: { message?: string } | null | undefined,
): string | null {
  const m = error?.message ?? "";
  if (m.includes("PLAN_CUOTAS_OFFLINE")) {
    return "La venta en cuotas necesita conexión. Volvé a cobrarla con señal.";
  }
  if (m.includes("PLAN_CUOTAS_TASA_DISTINTA") || m.includes("PLAN_CUOTAS_INTERES_DISTINTO")) {
    return "Las cuotas cambiaron en la configuración mientras armabas la venta. Recargá el POS y volvé a elegir el plan.";
  }
  if (m.includes("PLAN_CUOTAS_INVALIDO")) {
    return "El comercio no ofrece esa cantidad de cuotas, o el monto es muy chico para partirlo. Revisá las opciones en Configuración > Clientes.";
  }
  return null;
}

/**
 * Arma el plan sobre lo FINANCIADO (la entrega no paga interés). `fechaVenta`
 * es el día comercial argentino ("YYYY-MM-DD"), no UTC.
 */
export function armarPlanCuotasCc(
  financiado: number,
  tasa: TasaFinanciacion,
  fechaVenta: string,
): PlanCuotasCc {
  const o = calcularOpcion(financiado, tasa);
  const fechas = vencimientosMensuales(fechaVenta, tasa.cuotas);
  return {
    cuotas: tasa.cuotas,
    pct: tasa.pct,
    financiado: o.financiado,
    interes: o.recargo,
    totalFinanciado: o.totalFinanciado,
    detalle: fechas.map((venceEl, i) => ({
      numero: i + 1,
      monto: i === tasa.cuotas - 1 ? o.ultimaCuota : o.montoCuota,
      venceEl,
    })),
  };
}
