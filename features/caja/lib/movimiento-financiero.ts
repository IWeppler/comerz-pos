/**
 * Cómo se lee un movimiento financiero DESDE LA CUENTA que se está mirando.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL NOMBRE DEL EVENTO NO ES EL NOMBRE DE LO QUE PASÓ
 *
 * `movimientos_financieros.evento` cuenta cómo llegó la fila a la bitácora:
 * `REGISTRO`, `CORRECCION_APLICADA`, `MIGRACION_ESTADO_INICIAL`. Eso es
 * historia del sistema, no del negocio. Mostrarlo tal cual sería enseñarle a
 * la dueña el nombre interno de una migración.
 *
 * El caso que lo vuelve evidente: de los 4.900 movimientos del SaaS, **2.018
 * son `CORRECCION_REVERSA` / `CORRECCION_APLICADA`** de la migración del 20/9
 * que sacó los cobros del puente. En la cuenta "TRANSFERENCIA MERCADO PAGO"
 * de Evens son 544 filas seguidas. Pero no son ruido: **cada una es un cobro
 * que entró a esa cuenta**, y desde el punto de vista de la cuenta eso es
 * exactamente lo que hay que decir. La corrección es el cómo, no el qué.
 *
 * Por eso la etiqueta sale de `origen_tipo` + el SIGNO, no del evento. El
 * evento se sigue mostrando como dato secundario: la tabla es append-only y
 * auditable, y esconder el nombre técnico la volvería menos auditable.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface MovimientoCuenta {
  id: number;
  fecha: string;
  evento: string;
  origen_tipo: string;
  importe: number | string;
  descripcion: string | null;
  autor: string | null;
  en_turno: boolean;
}

/**
 * Qué pasó, en el idioma del mostrador.
 *
 * Fail-closed: un `origen_tipo` que este código no conoce NO se inventa. Se
 * devuelve "Movimiento" y el evento queda visible abajo, que es la verdad
 * ("pasó algo y acá está el nombre técnico") en vez de una etiqueta linda que
 * podría estar mintiendo.
 */
export function etiquetaMovimiento(
  origenTipo: string,
  evento: string,
  importe: number,
): string {
  switch (origenTipo) {
    case "VENTA_PAGO":
      if (importe > 0) return "Cobro de una venta";
      if (importe < 0) return "Cobro revertido";
      return "Cobro sin efecto en la cuenta";

    case "EGRESO":
      // El signo no cambia nada acá: un egreso siempre saca.
      return "Gasto";

    case "TRANSFERENCIA":
      return importe >= 0 ? "Entró desde otra cuenta" : "Salió hacia otra cuenta";

    case "ACREDITACION":
      return importe >= 0 ? "Se acreditó" : "Pasó a su cuenta";

    case "TURNO_CAJA":
      if (evento === "APERTURA_TURNO") return "Apertura de caja";
      if (evento === "CIERRE_TURNO") return "Cierre de caja";
      if (evento === "AJUSTE_ARQUEO") {
        return importe >= 0 ? "Sobrante de arqueo" : "Faltante de arqueo";
      }
      return "Movimiento de caja";

    case "AJUSTE":
      if (evento === "AJUSTE_SALDO_INICIAL") return "Saldo inicial declarado";
      return "Ajuste";

    default:
      return "Movimiento";
  }
}

/**
 * Si el movimiento cambió el RESULTADO del negocio o solo dónde está la plata.
 *
 * Es la distinción que sostiene todo el módulo y la que más cuesta explicar:
 * mover $300.000 de la caja diaria a la caja general no es un gasto. Acá se
 * deduce del `origen_tipo` y no de `impacto_resultado` porque esa columna no
 * viaja en el detalle — y tenerla en dos lugares sería tener dos verdades.
 * Si algún día el detalle la trae, esta función se borra y se usa la columna.
 */
export function mueveElResultado(origenTipo: string, evento: string): boolean {
  if (origenTipo === "EGRESO") return true;
  if (origenTipo === "TURNO_CAJA") return evento === "AJUSTE_ARQUEO";
  return false;
}
