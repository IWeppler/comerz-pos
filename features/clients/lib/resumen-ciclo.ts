import { cicloVigente } from "./avisos-cc";
import type { ReglaVencimientoCc } from "./calcular-fecha-vencimiento";

/**
 * Hasta qué vencimiento muestra el resumen de cuenta que se manda por
 * WhatsApp, en comercios con CIERRE MENSUAL (pedido del 6/10/2026 para
 * Librería Colores).
 *
 * El resumen es "lo que tenés que pagar ahora": todo lo que vence hasta el
 * vencimiento del ciclo vigente, deuda vieja incluida (cada mes en su
 * renglón), igual que el filtro "A abonar" y los avisos (`avisoDelDia`). Lo
 * comprado después del cierre vence el mes que viene y NO aparece: mandárselo
 * a la clienta el 6/10 junto con lo que vence el 15/10 se leía como que tenía
 * que pagar todo junto.
 *
 * Si no debe nada del ciclo pero sí del que viene (compró recién después del
 * cierre), el corte es ESE vencimiento: el resumen muestra lo que debe y
 * cuándo vence, en vez de un "nada para pagar" con deuda viva.
 *
 * null = no se recorta (comercio en "días desde la compra", o sin deuda).
 *
 * Pura: `hoy` entra por parámetro (día comercial, `diaComercial`).
 */
export function corteResumenCc(
  regla: ReglaVencimientoCc,
  hoy: string,
  deudas: { venceEl: string; vivo: number }[],
): string | null {
  const ciclo = cicloVigente(regla, hoy);
  if (!ciclo) return null;

  const vivas = deudas.filter((d) => d.vivo > 0);
  if (vivas.length === 0) return null;
  if (vivas.some((d) => d.venceEl <= ciclo.venceEl)) return ciclo.venceEl;

  return vivas.reduce(
    (min, d) => (d.venceEl < min ? d.venceEl : min),
    vivas[0].venceEl,
  );
}

/** Lo que vence hasta el corte, capital (la mora va aparte). */
export function montoHastaCorte(
  deudas: { venceEl: string; vivo: number }[],
  corte: string,
): number {
  const total = deudas
    .filter((d) => d.vivo > 0 && d.venceEl <= corte)
    .reduce((t, d) => t + d.vivo, 0);
  return Math.round(total * 100) / 100;
}

export interface MovimientoResumenCc {
  fecha: string;
  concepto: string;
  tipo: "DEBITO" | "CREDITO";
  monto: number;
  saldo: number;
  /** Solo cargos: cuándo vence (el de su ticket si es mora). null = no se
   * sabe (base vieja) o es un pago. */
  vence_el?: string | null;
}

/**
 * Los movimientos del resumen sin los cargos que vencen después del corte,
 * con el saldo corriente recalculado sobre lo que queda.
 *
 * Los pagos quedan TODOS: un pago de octubre achica lo que vence el 15/10
 * (se imputa a lo más viejo), y esconderlo haría que el total no cierre con
 * lo que la clienta recuerda haber pagado. Un cargo sin vencimiento conocido
 * se muestra: esconder una deuda en silencio es peor que una fila de más.
 */
export function movimientosHastaCorte(
  movimientos: MovimientoResumenCc[],
  saldoAnterior: number,
  corte: string,
): MovimientoResumenCc[] {
  let saldo = saldoAnterior;
  const out: MovimientoResumenCc[] = [];
  for (const m of movimientos) {
    if (m.tipo === "DEBITO" && m.vence_el && m.vence_el.slice(0, 10) > corte) {
      continue;
    }
    saldo = Math.round((saldo + (m.tipo === "DEBITO" ? m.monto : -m.monto)) * 100) / 100;
    out.push({ ...m, saldo });
  }
  return out;
}
