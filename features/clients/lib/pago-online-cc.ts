import type { RecargoMoraConfig } from "./calcular-saldo-con-recargo";

/**
 * Pagar la cuenta corriente con Mercado Pago desde el resumen
 * (docs/cuenta-corriente.md, decidido el 22/10/2026). PURO.
 *
 * Dos botones, sin monto libre: "Pagar lo vencido" (o "lo del mes" con cierre
 * mensual) y "Pagar todo". La mora es la de HOY (`calcularSaldoConRecargo`,
 * la misma que el cobro en el mostrador) y va en los dos: solo existe sobre lo
 * vencido, que está en los dos montos.
 */

export type AlcancePagoCc = "VENCIDO" | "CICLO" | "TOTAL";

export interface OpcionPagoCc {
  alcance: AlcancePagoCc;
  etiqueta: string;
  /** Lo que amortiza de la deuda, sin la mora. */
  capital: number;
  mora: number;
  /** Lo que paga la clienta. */
  total: number;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

export function opcionesPagoCc({
  saldo,
  vencido,
  mora,
  montoCiclo,
}: {
  /** `clientes.saldo_pendiente`: capital vivo (con la mora anterior impaga). */
  saldo: number;
  /** Porción vencida por FIFO (`deuda_cc_vencida.vencido`). */
  vencido: number;
  /** Recargo por mora de hoy; 0 si no hay. */
  mora: number;
  /** Con cierre mensual, lo que vence hasta el ciclo vigente
   * (`montoHastaCorte`); null en modo días. */
  montoCiclo: number | null;
}): OpcionPagoCc[] {
  const s = centavos(Math.max(0, saldo));
  if (s <= 0) return [];
  const m = centavos(Math.max(0, mora));

  const parcial =
    montoCiclo !== null
      ? { alcance: "CICLO" as const, etiqueta: "Pagar lo del mes", monto: montoCiclo }
      : { alcance: "VENCIDO" as const, etiqueta: "Pagar lo vencido", monto: vencido };
  const p = centavos(Math.min(Math.max(0, parcial.monto), s));

  const total: OpcionPagoCc = {
    alcance: "TOTAL",
    etiqueta: "Pagar todo",
    capital: s,
    mora: m,
    total: centavos(s + m),
  };
  if (p <= 0 || p >= s - 0.005) return [total];
  return [
    { alcance: parcial.alcance, etiqueta: parcial.etiqueta, capital: p, mora: m, total: centavos(p + m) },
    total,
  ];
}

/**
 * La leyenda del recargo por mora en la cuenta ("Recargo por mora (15% sobre la
 * deuda vencida)"). Dice sobre qué se calculó: con SALDO_COMPLETO decía "sobre
 * la deuda vencida" y el número era sobre toda la cuenta. La usan el cobro en
 * el mostrador y el pago con Mercado Pago.
 */
export function descripcionMora(config: RecargoMoraConfig): string {
  const detalle =
    config.recargo_mora_tipo === "PORCENTAJE"
      ? config.recargo_mora_base === "PORCION_VENCIDA"
        ? `${config.recargo_mora_valor}% sobre la deuda vencida`
        : `${config.recargo_mora_valor}% sobre el saldo adeudado`
      : "monto fijo por venta vencida";
  return `Recargo por mora (${detalle})`;
}
