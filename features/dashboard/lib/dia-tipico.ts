import type { Venta } from "@/entities/ventas/types";
import type { MuestraMedia } from "@/shared/lib/periodo-ranges";
import { piezasDeVenta } from "./unidades-vendidas";

/** Cuántas semanas hacia atrás se buscan días de referencia. Se usan las que
 * haya: con 5 semanas de historia salen 5 martes, y alcanza. */
export const SEMANAS_DIA_TIPICO = 8;

export type TotalesDia = {
  ingresos: number;
  unidades: number;
  ganancia: number;
  /** Un valor por ticket. El ticket promedio es una media y necesita su
   * dispersión para saber si una diferencia se distingue del ruido. */
  tickets: number[];
};

export type ComparacionDiaTipico = {
  /** Lo que va de hoy. */
  hoy: TotalesDia;
  /** Promedio del MISMO día de la semana, cortado a la misma hora. */
  tipico: { ingresos: number; unidades: number; ganancia: number };
  /** Los tickets de todos los días de referencia juntos. */
  ticketsReferencia: number[];
  /** Cuántos días de referencia hubo. 0 = no hay con qué comparar. */
  dias: number;
};

/**
 * Compara el día en curso contra un día TÍPICO de la misma semana: el
 * promedio de los últimos N mismos-días-de-la-semana, cortado a la misma hora.
 *
 * Las dos mitades del nombre son las dos correcciones, y las dos salen de
 * medir Evens sobre 8 semanas:
 *
 * 1. MISMO DÍA DE LA SEMANA, no "el promedio de los días". El sábado factura
 *    $971.100 y el lunes $179.900 — 5,4 veces. Contra un promedio de todos los
 *    días, el badge diría −64% todos los lunes y +94% todos los sábados para
 *    siempre: informaría qué día es, no cómo va el negocio. Y contra UN solo
 *    día (lo que hacía antes, el mismo día de la semana pasada) el badge se
 *    movía ±60% por la suerte del día de referencia: los martes van de
 *    $277.200 a $1.025.775.
 *
 * 2. CORTADO A LA MISMA HORA. Es lo que arregla un error que estaba vivo: se
 *    comparaba el día EN CURSO contra un día completo. A las 13:00 solo entró
 *    el 33% del día (el 55% entra entre las 17 y las 20), así que el badge
 *    mostraba ≈ −67% durante casi todo el horario de atención, fuera un buen
 *    día o uno malo. Misma trampa que la barra de hoy en el gráfico.
 *
 * Un día de referencia es un día que ABRIÓ (tuvo ventas en algún momento),
 * aunque hasta la hora de corte no haya vendido nada: si se filtrara por
 * "vendió antes de las 13", los días de arranque lento quedarían afuera y el
 * promedio saldría inflado. Un día cerrado, en cambio, no es un día típico y
 * no entra.
 *
 * El resultado es DESCRIPTIVO y así hay que leerlo: un martes puede valer el
 * doble que otro sin que haya pasado nada. Dice cómo viene el día contra lo
 * habitual, no que haya una tendencia.
 */
export function compararConDiaTipico(
  ventasOperativas: Venta[],
  ahora: Date,
  semanas: number = SEMANAS_DIA_TIPICO,
): ComparacionDiaTipico {
  const claveDia = (f: Date) =>
    `${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`;
  const segundosDelDia = (f: Date) =>
    f.getHours() * 3600 + f.getMinutes() * 60 + f.getSeconds();

  const corte = segundosDelDia(ahora);
  const claveHoy = claveDia(ahora);

  // Los mismos días de la semana hacia atrás: exactamente múltiplos de 7.
  const clavesReferencia = new Set<string>();
  for (let i = 1; i <= semanas; i++) {
    clavesReferencia.add(
      claveDia(
        new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - 7 * i),
      ),
    );
  }

  const vacio = (): TotalesDia => ({
    ingresos: 0,
    unidades: 0,
    ganancia: 0,
    tickets: [],
  });

  const hoy = vacio();
  const porDia = new Map<string, TotalesDia>();
  // Un día que abrió, aunque no haya vendido antes de la hora de corte.
  const diasQueAbrieron = new Set<string>();

  for (const v of ventasOperativas) {
    const f = new Date(v.fecha_venta);
    const clave = claveDia(f);
    const esHoy = clave === claveHoy;
    if (!esHoy && !clavesReferencia.has(clave)) continue;

    if (!esHoy) diasQueAbrieron.add(clave);
    if (segundosDelDia(f) > corte) continue;

    // Mismas fórmulas que getDashboardMetrics: los ingresos van sin el recargo
    // por método (no es mercadería) y la ganancia les resta el costo del ticket.
    const totalTicket =
      Number(v.total || 0) - Number(v.recargo_metodo_total || 0);
    const ganancia = totalTicket - Number(v.precio_costo || 0);
    // Piezas, no `v.cantidad`: esa suma mezcla kilos con unidades (ver piezasDeVenta).

    const destino = esHoy ? hoy : (porDia.get(clave) ?? vacio());
    destino.ingresos += totalTicket;
    destino.ganancia += ganancia;
    destino.unidades += piezasDeVenta(v.ventas_items);
    destino.tickets.push(totalTicket);
    if (!esHoy) porDia.set(clave, destino);
  }

  const referencia = [...diasQueAbrieron].map(
    (clave) => porDia.get(clave) ?? vacio(),
  );
  const dias = referencia.length;
  const promedio = (valor: (d: TotalesDia) => number) =>
    dias > 0 ? referencia.reduce((acc, d) => acc + valor(d), 0) / dias : 0;

  return {
    hoy,
    tipico: {
      ingresos: promedio((d) => d.ingresos),
      unidades: promedio((d) => d.unidades),
      ganancia: promedio((d) => d.ganancia),
    },
    ticketsReferencia: referencia.flatMap((d) => d.tickets),
    dias,
  };
}

/** Media, desvío muestral y n de un conjunto de tickets, en la forma que espera
 * `crecimientoDeMedia`. */
export function muestraDeTickets(valores: number[]): MuestraMedia {
  const n = valores.length;
  if (n === 0) return { media: 0, desvio: 0, n: 0 };

  const media = valores.reduce((acc, v) => acc + v, 0) / n;
  if (n < 2) return { media, desvio: 0, n };

  const varianza =
    valores.reduce((acc, v) => acc + (v - media) * (v - media), 0) / (n - 1);
  return { media, desvio: Math.sqrt(varianza), n };
}
