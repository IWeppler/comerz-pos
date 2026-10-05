import {
  calcularVencimientoCc,
  type ReglaVencimientoCc,
} from "./calcular-fecha-vencimiento";

/**
 * Qué aviso de cuenta corriente le toca mandar HOY al comercio, y a quién.
 *
 * Solo para comercios con CIERRE MENSUAL (decidido el 5/10/2026): en "días
 * desde la compra" cada ticket vence otro día y la lista sería diaria y
 * ruidosa. Con cierre hay un ciclo por mes y tres momentos:
 *
 *   CIERRE  desde el día del cierre hasta antes del recordatorio: "cerró la
 *           cuenta, esto vence el 15".
 *   PREVIO  los últimos DIAS_AVISO_PREVIO días antes del vencimiento, y el
 *           día del vencimiento: "vence el 15, todavía debés esto".
 *   MORA    desde el día siguiente al vencimiento hasta el próximo cierre:
 *           "venció".
 *
 * Cada aviso dura una VENTANA de días y no un solo día: si el 5 no se mandó,
 * el 6 sigue en la lista. Lo que ya se mandó lo descuenta la pantalla con el
 * registro de la base (`cc_avisos`), no esta función.
 *
 * Los montos NO se calculan acá: entran por cliente y por vencimiento desde
 * la base (`cc_deudas_vivas`), la misma regla que el vencimiento, la mora y el
 * resumen. Esta función solo decide el momento y filtra.
 *
 * Pura: `hoy` entra por parámetro (día comercial, `diaComercial`).
 */

export type TipoAvisoCc = "CIERRE" | "PREVIO" | "MORA";

/** Días antes del vencimiento en que arranca el recordatorio. */
export const DIAS_AVISO_PREVIO = 2;

/** La deuda viva de un cliente que vence en una fecha. */
export interface DeudaPorVencimiento {
  clienteId: string;
  /** "YYYY-MM-DD". */
  venceEl: string;
  vivo: number;
}

export interface ClienteAviso {
  clienteId: string;
  /** Lo que tiene que pagar hasta el vencimiento del ciclo, deuda vieja
   * incluida. El mensaje lleva el total real (con mora si hay). */
  monto: number;
}

export interface AvisoCc {
  tipo: TipoAvisoCc;
  /** "YYYY-MM-DD". El cierre del ciclo. */
  cierre: string;
  /** "YYYY-MM-DD". El vencimiento del ciclo: junto con `tipo` identifica el
   * aviso (un cliente recibe un CIERRE por ciclo, no uno por día). */
  venceEl: string;
  /** Mayor monto primero: es a quien más importa avisar. */
  clientes: ClienteAviso[];
}

function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function fechaIso(anio: number, mes0: number, dia: number): string {
  return new Date(Date.UTC(anio, mes0, dia)).toISOString().slice(0, 10);
}

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

/**
 * El ciclo vigente: el último cierre igual o anterior a `hoy` y su
 * vencimiento. null si el comercio no está en cierre mensual.
 */
export function cicloVigente(
  regla: ReglaVencimientoCc,
  hoy: string,
): { cierre: string; venceEl: string } | null {
  if (regla.modo !== "CIERRE_MENSUAL" || !regla.diaCierre) return null;

  const [anio, mes, dia] = hoy.split("-").map(Number);
  const dc = regla.diaCierre;
  const cierre =
    dia >= dc ? fechaIso(anio, mes - 1, dc) : fechaIso(anio, mes - 2, dc);
  // Lo comprado el día anterior al cierre es lo último que cierra ahí: su
  // vencimiento es el del ciclo. Misma regla que todo lo demás.
  const venceEl = calcularVencimientoCc(sumarDias(cierre, -1), regla);
  return { cierre, venceEl };
}

/** Qué tipo de aviso corresponde hoy dentro del ciclo. */
export function tipoAvisoDelDia(
  ciclo: { cierre: string; venceEl: string },
  hoy: string,
): TipoAvisoCc {
  if (hoy > ciclo.venceEl) return "MORA";
  // Sin día de vencimiento propio, vence el día del cierre: ese día es el
  // aviso de cierre (no hay "antes" para recordar).
  if (hoy === ciclo.cierre) return "CIERRE";
  if (hoy >= sumarDias(ciclo.venceEl, -DIAS_AVISO_PREVIO)) return "PREVIO";
  return "CIERRE";
}

/**
 * El aviso de hoy con sus clientes, o null si el comercio no está en cierre
 * mensual o no hay a quién avisar.
 */
export function avisoDelDia(
  regla: ReglaVencimientoCc,
  hoy: string,
  deudas: DeudaPorVencimiento[],
): AvisoCc | null {
  const ciclo = cicloVigente(regla, hoy);
  if (!ciclo) return null;

  const tipo = tipoAvisoDelDia(ciclo, hoy);
  const porCliente = new Map<string, number>();

  for (const d of deudas) {
    if (!(d.vivo > 0)) continue;
    // Todo lo que hay que pagar hasta el vencimiento del ciclo, también lo que
    // ya venía de antes: el día del cierre la dueña quiere saber quién le
    // debe, no solo quién compró este mes (Colores el 5/10/2026: 56 clientes
    // arrastraban deuda del 15/9). Lo que vence después es del ciclo que
    // viene y no entra.
    if (d.venceEl > ciclo.venceEl) continue;
    porCliente.set(
      d.clienteId,
      redondear((porCliente.get(d.clienteId) ?? 0) + d.vivo),
    );
  }

  if (porCliente.size === 0) return null;

  const clientes = [...porCliente]
    .map(([clienteId, monto]) => ({ clienteId, monto }))
    .sort((a, b) => b.monto - a.monto || a.clienteId.localeCompare(b.clienteId));

  return { tipo, cierre: ciclo.cierre, venceEl: ciclo.venceEl, clientes };
}
