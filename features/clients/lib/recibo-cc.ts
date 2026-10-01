import {
  deudaVivaDesdeFila,
  numeroTicketDeFila,
  type DeudaViva,
  type FilaDeudaViva,
} from "./deuda-por-mes";

/** Una deuda que este cobro canceló (entera o en parte). */
export interface ImputacionRecibo {
  debitoId: string;
  numeroTicket: string | null;
  fecha: string;
  venceEl: string;
  descripcion: string | null;
  esMoraHuerfana: boolean;
  /** Lo que valía la deuda al cobrar, recargos incluidos. */
  monto: number;
  /** Lo que este cobro le descontó. */
  aplicado: number;
  /** Lo que le quedó. 0 = saldada. */
  saldoRestante: number;
}

/**
 * El recibo de un cobro de cuenta corriente: lo que se imprime cuando la
 * clienta paga (parte de) su deuda.
 *
 * Es OTRO papel que el ticket de venta, y a propósito no reusa `TicketData`:
 * un cobro no tiene renglones ni stock ni comprobante fiscal, y lo que la
 * clienta necesita ver es lo que el ticket de venta no tiene — cuánto debía,
 * cuánto pagó, cuánto le queda y para cuándo.
 *
 * Todos los números vienen del SERVER, de la misma acción que escribió el
 * cobro (`registrarPagoDeudaAction`): el papel dice exactamente lo que quedó
 * en la base, no lo que el modal estimó antes de confirmar. Mismo criterio
 * que el ticket de venta, que se arma con la respuesta de `registrarVenta`.
 */
export type ReciboCobroCC = {
  /** id de la fila de `venta_pagos`: es lo que identifica al cobro. */
  pagoId: string;
  /** ISO. */
  fecha: string;
  clienteNombre: string;
  metodoNombre: string;
  /** Lo que se imputa a la deuda. */
  montoBase: number;
  recargoMetodoPorcentaje: number;
  recargoMetodoMonto: number;
  /** Lo que entró a la caja: base + recargo por método. */
  montoBruto: number;
  /** Mora materializada en este cobro (0 si no había). */
  moraMonto: number;
  /** Saldo antes de este cobro, SIN la mora de este cobro. */
  saldoAnterior: number;
  /** Saldo que queda después del cobro. */
  saldoNuevo: number;
  /** ISO date (yyyy-mm-dd) del vencimiento del saldo que queda, o null. */
  fechaVencimiento: string | null;
  /**
   * Qué compras canceló este cobro, en orden. Guardado en `cc_imputaciones`
   * al cobrar: reimpreso dice lo mismo aunque después cambie la cuenta.
   * Vacío en un cobro anterior al 1/10/2026 (no se guardaba).
   */
  imputaciones: ImputacionRecibo[];
  /** Lo que quedó debiendo después del cobro, por ticket. Foto del momento. */
  pendientes: DeudaViva[];
  /**
   * La cabecera del papel. Viaja con el recibo porque el layout del panel solo
   * tiene una proyección chica de la configuración (a propósito: se lee en
   * cada navegación) y el server que registra el cobro ya leyó
   * `configuracion_pos` — es la misma consulta, sin viaje extra.
   */
  comercio: {
    nombre: string | null;
    direccion: string | null;
    whatsapp: string | null;
    anchoTicketMm: number | null;
  };
};

/** El recibo tal cual lo devuelve `recibo_cobro_cc` en la base. */
export interface FilaReciboCC {
  pago_id: string;
  cliente_nombre: string | null;
  fecha: string | null;
  metodo_nombre: string | null;
  monto_base: number | string | null;
  recargo_porcentaje: number | string | null;
  recargo_monto: number | string | null;
  monto_bruto: number | string | null;
  saldo_anterior: number | string;
  mora_monto: number | string;
  monto_aplicado: number | string;
  saldo_nuevo: number | string;
  fecha_vencimiento: string | null;
  pendientes: FilaDeudaViva[] | null;
  imputaciones:
    | (FilaDeudaViva & {
        aplicado: number | string;
        saldo_restante: number | string;
      })[]
    | null;
  comercio: {
    nombre: string | null;
    direccion: string | null;
    whatsapp: string | null;
    ancho_ticket_mm: number | null;
  } | null;
}

/**
 * Del jsonb de la base al recibo que se dibuja. Un solo armado para el cobro
 * recién hecho y para la reimpresión: los dos papeles salen iguales.
 */
export function reciboDesdeFila(fila: FilaReciboCC): ReciboCobroCC {
  const montoBase = Number(fila.monto_base ?? fila.monto_aplicado) || 0;
  return {
    pagoId: fila.pago_id,
    fecha: fila.fecha ?? new Date().toISOString(),
    clienteNombre: fila.cliente_nombre ?? "",
    metodoNombre: fila.metodo_nombre ?? "",
    montoBase,
    recargoMetodoPorcentaje: Number(fila.recargo_porcentaje) || 0,
    recargoMetodoMonto: Number(fila.recargo_monto) || 0,
    montoBruto: Number(fila.monto_bruto ?? montoBase) || 0,
    moraMonto: Number(fila.mora_monto) || 0,
    saldoAnterior: Number(fila.saldo_anterior) || 0,
    saldoNuevo: Number(fila.saldo_nuevo) || 0,
    fechaVencimiento: fila.fecha_vencimiento,
    imputaciones: (fila.imputaciones ?? []).map((i) => ({
      debitoId: i.debito_id,
      numeroTicket: numeroTicketDeFila(i),
      fecha: String(i.fecha).slice(0, 10),
      venceEl: String(i.vence_el).slice(0, 10),
      descripcion: i.descripcion ?? null,
      esMoraHuerfana: i.es_mora_huerfana === true,
      monto: Number(i.monto) || 0,
      aplicado: Number(i.aplicado) || 0,
      saldoRestante: Number(i.saldo_restante) || 0,
    })),
    pendientes: (fila.pendientes ?? []).map(deudaVivaDesdeFila),
    comercio: {
      nombre: fila.comercio?.nombre ?? null,
      direccion: fila.comercio?.direccion ?? null,
      whatsapp: fila.comercio?.whatsapp ?? null,
      anchoTicketMm: fila.comercio?.ancho_ticket_mm ?? null,
    },
  };
}

/**
 * El número que se le dice a la clienta: los primeros 8 del uuid del pago, en
 * mayúsculas. Es la misma convención que el ticket de venta usa cuando no hay
 * comprobante (`numeroTicketVenta`) — un cobro de CC nunca tiene comprobante
 * fiscal, así que acá es la única forma.
 */
export function numeroReciboCC(recibo: Pick<ReciboCobroCC, "pagoId">): string {
  return recibo.pagoId.split("-")[0].toUpperCase();
}

/**
 * Las líneas de la cuenta que muestra el papel, en el orden en que se leen.
 *
 * La mora va como línea propia y ANTES del pago: el recibo tiene que dejar
 * claro que el saldo subió por el recargo y después bajó por lo pagado. Sin esa
 * línea, una clienta que debía $10.000, pagó $10.000 y sigue debiendo $1.500
 * (la mora) ve un papel que no cierra y con razón discute.
 */
export function lineasCuentaRecibo(recibo: ReciboCobroCC): Array<{
  etiqueta: string;
  monto: number;
  signo: "" | "+" | "-";
}> {
  const lineas: Array<{ etiqueta: string; monto: number; signo: "" | "+" | "-" }> =
    [{ etiqueta: "Saldo anterior", monto: recibo.saldoAnterior, signo: "" }];
  if (recibo.moraMonto > 0) {
    lineas.push({
      etiqueta: "Recargo por mora",
      monto: recibo.moraMonto,
      signo: "+",
    });
  }
  lineas.push({ etiqueta: "Pago a cuenta", monto: recibo.montoBase, signo: "-" });
  return lineas;
}
