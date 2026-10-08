import type { RecargoMoraBase, RecargoMoraTipo } from "@/entities/config/types";
import { calcularDiasVencido } from "./calcular-dias-vencido";

export interface RecargoMoraConfig {
  recargo_mora_tipo: RecargoMoraTipo;
  recargo_mora_valor: number;
  /** Sin dato = SALDO_COMPLETO, el default de la columna y lo que todos los
   * comercios tenían antes de que existiera (5/10/2026). */
  recargo_mora_base?: RecargoMoraBase;
}

/**
 * Lo que sale de `deuda_cc_vencida` por cliente para armar la base del
 * recargo (5/10/2026). Viaja junto: separarlo invita a que una pantalla pase
 * una parte y olvide la otra.
 */
export interface BasesMora {
  /**
   * El capital (sin recargos previos) de las ventas VENCIDAS. Es la base del
   * recargo cuando el comercio eligió PORCION_VENCIDA.
   */
  capital_vencido?: number | string | null;
  /**
   * Capital vivo de ventas que YA pagaron su recargo con SALDO_COMPLETO:
   * existían cuando se cobró una mora. Se resta de la base para que la mora
   * se cobre una vez por venta (Configuración lo promete: "se suma una única
   * vez"). 0 = ninguna venta viva tuvo recargo todavía.
   */
  recargado_saldo?: number | string | null;
  /** Lo mismo con PORCION_VENCIDA: ventas que ya estaban vencidas cuando se
   * cobró una mora. */
  recargado_vencido?: number | string | null;
  /**
   * Cuántas ventas vencidas con capital vivo todavía no recargaron. El MONTO
   * FIJO se cobra uno por cada una (8/10/2026: "por cada venta vencida");
   * antes era uno por cobro. Sin el dato (una base vieja que no lo devuelve)
   * queda el criterio anterior: uno si hay algo por recargar.
   */
  ventas_vencidas_nuevas?: number | string | null;
}

export interface TicketConVencimiento extends BasesMora {
  monto_pendiente?: number | string | null;
  fecha_vencimiento?: string | null;
  /**
   * La porción del saldo que YA venció, imputando los pagos FIFO. Sale de
   * `deuda_cc_vencida` en la base.
   *
   * YA NO ES LA BASE DEL RECARGO — se sigue pidiendo y devolviendo porque es
   * información útil (la antigüedad, el Advisor), pero desde el 5/9/2026 el
   * recargo se calcula sobre el SALDO COMPLETO. Ver el comentario de
   * `calcularSaldoConRecargo`.
   */
  monto_vencido?: number | string | null;
  /**
   * Cuánto del saldo son RECARGOS ANTERIORES y no mercadería. Sale de
   * `mora_viva` en `deuda_cc_vencida`.
   *
   * La base del recargo es el capital: `monto_pendiente - mora_previa`. Sin
   * esto, el segundo recargo de una clienta se calcularía sobre un saldo que
   * ya contiene el primero — interés compuesto, contra lo que promete la
   * pantalla de Configuración > Clientes ("se suma una única vez ... no se
   * acumula día a día").
   *
   * El default 0 no es "no se sabe", es un HECHO para casi toda la base: el
   * 9/9/2026 las 39 filas de mora del SaaS son primeros recargos, así que
   * ninguna clienta tiene mora previa. Omitirlo dice "esta cuenta no tiene
   * recargos sin pagar", que es la verdad en el caso normal.
   */
  mora_previa?: number | string | null;
}

export interface SaldoConRecargo {
  saldoBase: number;
  /** La porción vencida por FIFO. Se informa; NO es la base del recargo desde
   * el 5/9/2026. */
  montoVencido: number;
  /** Sobre qué se calculó el recargo: el capital adeudado (o solo el vencido,
   * según `recargo_mora_base`), sin los recargos anteriores. Se devuelve para
   * poder mostrarlo y para que un test pueda afirmar que la mora no entró en
   * su propia base. */
  baseRecargo: number;
  montoRecargo: number;
  saldoConRecargo: number;
  estaVencido: boolean;
}

/**
 * Recargo único (no compuesto): siempre parte de monto_pendiente +
 * fecha_vencimiento del ticket (datos base estables), nunca de un saldo
 * que ya tenga el recargo sumado — da el mismo resultado sin importar
 * cuántas veces se recalcule.
 *
 * La ÚNICA puerta del recargo por mora, y se le pasa siempre el saldo del
 * cliente (`saldo_pendiente` + `fecha_vencimiento_deuda`), no una venta: la
 * deuda también entra por CSV y por ajuste manual, y esas no dejan fila en
 * `ventas`. La firma quedó genérica a propósito —monto pendiente + fecha— para
 * que el server (registrarPagoDeudaAction) y la UI (tabla y detalle del
 * cliente) calculen exactamente el mismo número.
 *
 * LA BASE LA ELIGE CADA COMERCIO desde el 5/10/2026 (`recargo_mora_base`).
 * Lo que sigue es la historia de SALDO_COMPLETO, que es el default. Librería
 * Colores reclamó lo contrario: NATI CORDOBA tenía $14.800 vencidos y una
 * compra de $302.150 de seis días; sobre el saldo el 15% daba $47.542,50,
 * sobre lo vencido $2.220. Con PORCION_VENCIDA la base es `capital_vencido`.
 *
 * LA BASE ES EL SALDO COMPLETO, y esto cambió el 5/9/2026. Entre el 30/8 y esa
 * fecha la base fue la porción vencida FIFO, para no cobrarle mora a una
 * clienta por lo que había comprado ayer. La dueña pidió lo contrario y es una
 * decisión comercial, no un error de cálculo: si se atrasó, toda su cuenta
 * entra en mora. Su ejemplo, textual: una deuda de $30.000 que entra en mora
 * pasa a $36.000, y lo que pague después se descuenta de $36.000 — no del
 * recargo por un lado y el capital por el otro.
 *
 * Lo que esa decisión cuesta, medido el día que se tomó: en Evens una clienta
 * con $175 vencidos y $104.825 de saldo pasa de $26,25 de mora a $15.723,75.
 * Está aceptado a sabiendas; si algún día se quiere volver atrás, la base es
 * `montoVencido`, que se sigue calculando y devolviendo.
 *
 * SIGUE SIENDO ÚNICO, no compuesto, y desde el 9/9/2026 eso hay que sostenerlo
 * a mano. Antes lo cumplía la aritmética sola: `monto_pendiente` era capital.
 * Dejó de serlo cuando el recargo pasó a materializarse como un DEBITO propio
 * —un débito entra al saldo—, así que un segundo recargo se calcularía sobre
 * un saldo que ya contiene el primero. Por eso existe `mora_previa`: la base
 * es `monto_pendiente - mora_previa`, o sea capital. La pantalla de
 * Configuración > Clientes lo promete con todas las letras ("se suma una única
 * vez ... no se acumula día a día") y esto es lo que lo hace verdad.
 */
export function calcularSaldoConRecargo(
  ticket: TicketConVencimiento,
  config: RecargoMoraConfig,
): SaldoConRecargo {
  const saldoBase = Math.max(0, Number(ticket.monto_pendiente) || 0);
  const montoVencido = Math.min(
    saldoBase,
    Math.max(0, Number(ticket.monto_vencido) || 0),
  );
  // La base del recargo: capital, sin los recargos que ya se cobraron y siguen
  // impagos. Acotada al saldo por si el libro viniera descuadrado — misma
  // defensa que `montoVencido`.
  const moraPrevia = Math.min(
    saldoBase,
    Math.max(0, Number(ticket.mora_previa) || 0),
  );
  const capital = Math.max(0, saldoBase - moraPrevia);
  const numero = (v: number | string | null | undefined) =>
    Math.max(0, Number(v) || 0);
  // PORCION_VENCIDA: solo el capital de las ventas vencidas, acotado al
  // capital por la misma defensa contra un libro descuadrado. En las dos
  // bases se resta lo que YA pagó su recargo: una venta recarga una sola vez.
  // Hasta el 5/10/2026 cada cobro con la cuenta vencida recargaba de nuevo
  // (MARA MANSILLA en Evens: 4/9, 14/9 y 26/9).
  const baseRecargo =
    config.recargo_mora_base === "PORCION_VENCIDA"
      ? Math.max(
          0,
          Math.min(capital, numero(ticket.capital_vencido)) -
            numero(ticket.recargado_vencido),
        )
      : Math.max(0, capital - numero(ticket.recargado_saldo));
  const diasVencido = calcularDiasVencido(ticket.fecha_vencimiento);
  // Vencido = hay saldo y la fecha pasó. NO se exige `montoVencido > 0`: con
  // el vencimiento anclado al ciclo de deuda (ver `recalcular_vencimiento_cc`),
  // una clienta puede estar en mora con la imputación FIFO diciendo cero, y
  // tiene que cobrar recargo igual. Eran 5 clientas el 5/9/2026.
  const estaVencido = saldoBase > 0 && diasVencido !== null && diasVencido > 0;

  if (!estaVencido) {
    return {
      saldoBase,
      montoVencido,
      baseRecargo,
      montoRecargo: 0,
      saldoConRecargo: saldoBase,
      estaVencido: false,
    };
  }

  let montoRecargo = 0;
  if (config.recargo_mora_tipo === "MONTO_FIJO") {
    // Uno por cada venta vencida que todavía no recargó; también una vez por
    // venta: si todo lo que debe ya pagó su recargo, no hay otro.
    const fijo = Math.max(0, Number(config.recargo_mora_valor) || 0);
    const sinDato =
      ticket.ventas_vencidas_nuevas === undefined ||
      ticket.ventas_vencidas_nuevas === null;
    montoRecargo = sinDato
      ? baseRecargo > 0
        ? fijo
        : 0
      : fijo * Math.floor(numero(ticket.ventas_vencidas_nuevas));
  } else if (config.recargo_mora_tipo === "PORCENTAJE") {
    const pct = Math.max(0, Number(config.recargo_mora_valor) || 0);
    // Sobre el CAPITAL: todo (SALDO_COMPLETO, cláusula de aceleración) o solo
    // el vencido (PORCION_VENCIDA). Nunca un recargo anterior impago (ver
    // `mora_previa`).
    montoRecargo = (baseRecargo * pct) / 100;
  }

  return {
    saldoBase,
    montoVencido,
    baseRecargo,
    montoRecargo,
    saldoConRecargo: saldoBase + montoRecargo,
    estaVencido: true,
  };
}
