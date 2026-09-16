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
