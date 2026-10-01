import { numeroTicketVenta } from "@/features/sales/lib/numero-ticket";

/**
 * La deuda de una clienta contada como la cuenta ella: por TICKET y por el MES
 * en que vence. Es lo que contesta "¿cuánto tengo que pagar este mes?" y lo
 * que le dice a la cajera qué cobrar.
 *
 * Los números NO se calculan acá: vienen de `cc_deudas_vivas_detalle` en la
 * base, la misma función de la que sale el vencimiento (`recalcular_
 * vencimiento_cc`) y la foto del recibo. Este módulo solo los nombra y los
 * agrupa, así la pantalla, el modal de cobro y el papel no pueden decir tres
 * cosas distintas.
 */

/** Una deuda (ticket con su recargo adentro, o un recargo suelto). */
export interface DeudaViva {
  debitoId: string;
  ventaId: string | null;
  /** "00001-00000422" o el prefijo del id de la venta; null sin venta. */
  numeroTicket: string | null;
  /** ISO `YYYY-MM-DD`, día comercial argentino. */
  fecha: string;
  /** ISO `YYYY-MM-DD`. */
  venceEl: string;
  descripcion: string | null;
  /** Lo que valía, recargos incluidos. */
  monto: number;
  /** Lo que sigue debiendo de esta deuda. */
  vivo: number;
  esMoraHuerfana: boolean;
}

/** Fila tal cual la devuelve la base (RPC o jsonb del recibo). */
export interface FilaDeudaViva {
  debito_id: string;
  venta_id?: string | null;
  comprobante_punto_venta?: number | null;
  comprobante_numero?: number | null;
  fecha: string;
  vence_el: string;
  descripcion?: string | null;
  monto: number | string;
  vivo?: number | string | null;
  es_mora_huerfana?: boolean | null;
}

export function numeroTicketDeFila(
  fila: Pick<
    FilaDeudaViva,
    "venta_id" | "comprobante_punto_venta" | "comprobante_numero"
  >,
): string | null {
  if (!fila.venta_id) return null;
  return numeroTicketVenta({
    id: fila.venta_id,
    comprobantes: {
      punto_venta: fila.comprobante_punto_venta ?? null,
      numero: fila.comprobante_numero ?? null,
    },
  });
}

export function deudaVivaDesdeFila(fila: FilaDeudaViva): DeudaViva {
  return {
    debitoId: fila.debito_id,
    ventaId: fila.venta_id ?? null,
    numeroTicket: numeroTicketDeFila(fila),
    fecha: String(fila.fecha).slice(0, 10),
    venceEl: String(fila.vence_el).slice(0, 10),
    descripcion: fila.descripcion ?? null,
    monto: Number(fila.monto) || 0,
    vivo: Number(fila.vivo) || 0,
    esMoraHuerfana: fila.es_mora_huerfana === true,
  };
}

/**
 * Cómo se nombra una deuda en la pantalla y en el papel: por el número que la
 * clienta tiene impreso. Sin venta (saldo importado, cargo manual) va la
 * descripción que escribió la dueña.
 */
export function etiquetaDeuda(
  deuda: Pick<DeudaViva, "numeroTicket" | "esMoraHuerfana" | "descripcion">,
): string {
  if (deuda.numeroTicket) return `Ticket #${deuda.numeroTicket}`;
  if (deuda.esMoraHuerfana) return "Recargo por mora";
  return deuda.descripcion?.trim() || "Saldo anterior";
}

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** "Octubre", o "Enero 2027" si no es del año de `hoy`. */
export function nombreMes(anioMes: string, hoy: string): string {
  const [anio, mes] = anioMes.split("-");
  const nombre = MESES[Number(mes) - 1] ?? anioMes;
  return anio === hoy.slice(0, 4) ? nombre : `${nombre} ${anio}`;
}

export interface GrupoDeuda {
  /** "VENCIDO" o "YYYY-MM" del vencimiento. */
  clave: string;
  etiqueta: string;
  vencido: boolean;
  monto: number;
  deudas: DeudaViva[];
}

function redondear(monto: number): number {
  return Math.round(monto * 100) / 100;
}

/**
 * Lo que debe, en el orden en que se cobra: primero todo lo VENCIDO junto
 * (vence antes de hoy, mismo criterio que `deuda_cc_vencida`), después un
 * grupo por mes de vencimiento. Solo deudas vivas.
 *
 * `hoy` es el día comercial (`diaComercial`), y entra por parámetro: el
 * recibo reimpreso agrupa con el día en que se cobró, no con el de hoy.
 */
export function agruparDeudaPorMes(
  deudas: DeudaViva[],
  hoy: string,
): GrupoDeuda[] {
  const grupos = new Map<string, GrupoDeuda>();

  const ordenadas = [...deudas]
    .filter((d) => d.vivo > 0)
    .sort((a, b) =>
      a.venceEl === b.venceEl
        ? a.fecha.localeCompare(b.fecha)
        : a.venceEl.localeCompare(b.venceEl),
    );

  for (const deuda of ordenadas) {
    const vencido = deuda.venceEl < hoy;
    const clave = vencido ? "VENCIDO" : deuda.venceEl.slice(0, 7);
    let grupo = grupos.get(clave);
    if (!grupo) {
      grupo = {
        clave,
        etiqueta: vencido ? "Vencido" : nombreMes(clave, hoy),
        vencido,
        monto: 0,
        deudas: [],
      };
      grupos.set(clave, grupo);
    }
    grupo.monto = redondear(grupo.monto + deuda.vivo);
    grupo.deudas.push(deuda);
  }

  // El orden de inserción ya es el de cobro: lo vencido tiene el vencimiento
  // más viejo, así que siempre entra primero.
  return [...grupos.values()];
}

/**
 * Qué cubre un monto, en palabras de la cajera: qué meses quedan saldados y
 * cuál queda a medias. Imputa igual que la base (primero el recargo por mora
 * que se materializa al cobrar, después lo más viejo). Es un AVISO antes de
 * confirmar; lo que de verdad canceló lo dice el recibo, que sale de la base.
 */
export function coberturaDelPago(
  grupos: GrupoDeuda[],
  mora: number,
  monto: number,
): {
  completos: string[];
  parcial: { etiqueta: string; cubre: number; falta: number } | null;
  sobra: number;
} {
  let restante = redondear(monto - Math.max(0, mora));
  const completos: string[] = [];
  let parcial: { etiqueta: string; cubre: number; falta: number } | null = null;

  for (const grupo of grupos) {
    if (restante <= 0) break;
    if (restante >= grupo.monto) {
      completos.push(grupo.etiqueta);
      restante = redondear(restante - grupo.monto);
    } else {
      parcial = {
        etiqueta: grupo.etiqueta,
        cubre: restante,
        falta: redondear(grupo.monto - restante),
      };
      restante = 0;
    }
  }

  return { completos, parcial, sobra: Math.max(0, restante) };
}

/**
 * Los montos que la cajera puede cobrar con un toque, ACUMULADOS: pagar
 * "hasta octubre" es pagar lo vencido más octubre, porque el pago cancela lo
 * más viejo primero. El recargo por mora que se va a materializar al cobrar
 * va en todos: se suma antes de aplicar el pago.
 */
export function montosSugeridos(
  grupos: GrupoDeuda[],
  mora: number,
): { etiqueta: string; monto: number }[] {
  let acumulado = redondear(mora > 0 ? mora : 0);
  return grupos.map((grupo, i) => {
    acumulado = redondear(acumulado + grupo.monto);
    const esUltimo = i === grupos.length - 1;
    const etiqueta =
      esUltimo && grupos.length > 1
        ? "Todo"
        : grupo.vencido
          ? "Lo vencido"
          : `Hasta ${grupo.etiqueta.toLowerCase()}`;
    return { etiqueta, monto: acumulado };
  });
}
