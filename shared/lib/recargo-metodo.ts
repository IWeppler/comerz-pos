/**
 * Recargo por método de pago: lo que el comercio le COBRA al cliente por
 * pagar con ese método (ej. +15% con tarjeta).
 *
 * No confundir con `metodos_pago.comision`, que es lo contrario — lo que el
 * comercio le PAGA al procesador, se resta del neto y nunca se le muestra al
 * cliente.
 *
 * Este módulo es la ÚNICA fuente del cálculo: lo usa el POS para pintar el
 * ticket antes de cobrar y lo vuelve a usar el server (create-sale.ts,
 * manage-clients.ts) con los porcentajes leídos de la base. Que las dos
 * puntas compartan la función es lo que hace que el número que ve la
 * vendedora sea el mismo que se persiste; que el server igual lo recalcule
 * desde la base es lo que hace que un request modificado no pueda inventar
 * un recargo — mismo criterio que los precios en create-sale.ts.
 */

/** Un pago tal como lo arma el POS: `montoAsignado` es SIEMPRE la base. */
export type PagoBase = {
  metodoPagoId: string;
  montoAsignado: number | string;
};

/** Lo mínimo que se necesita saber de un método para cobrar el recargo. */
export type MetodoConRecargo = {
  id: string;
  nombre?: string;
  recargo_porcentaje?: number | null;
};

export type PagoConRecargo = {
  metodoPagoId: string;
  /** Lo que este cobro imputa al ticket o a la deuda. */
  montoBase: number;
  recargoPorcentaje: number;
  recargoMonto: number;
  /** La plata que entra: base + recargo. Es lo que ve la caja. */
  montoBruto: number;
};

export type TotalesConRecargo = {
  pagos: PagoConRecargo[];
  /** Suma de las bases: lo que cubre del ticket. */
  totalBase: number;
  /** Suma de los recargos. */
  totalRecargo: number;
  /** Lo que el cliente entrega en total. */
  totalACobrar: number;
};

/**
 * Los importes llegan desde cálculos del carrito (precio por cantidad), así
 * que pueden contener residuos de punto flotante como 30.000000000000004.
 * PostgreSQL `numeric` conserva literalmente el JSON recibido: si base y
 * bruto se serializan con distinta escala, la igualdad exacta del CHECK deja
 * de cumplirse aunque representen el mismo importe para la persona.
 */
export function normalizarMonto(monto: number | string): number {
  const valor = Number(monto);
  if (!Number.isFinite(valor)) return 0;
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Redondeo al peso entero, decidido con el dueño: los tickets del mostrador
 * no manejan centavos. Se redondea el RECARGO, no el total, así la base
 * (que es lo que imputa a la deuda y a la venta) queda intacta y el bruto
 * sigue cerrando exacto contra lo que se cobró.
 */
export function calcularRecargoMonto(
  montoBase: number,
  recargoPorcentaje: number,
): number {
  const base = Number(montoBase) || 0;
  const porcentaje = Number(recargoPorcentaje) || 0;
  if (base <= 0 || porcentaje <= 0) return 0;
  return Math.round((base * porcentaje) / 100);
}

/**
 * Aplica el recargo de cada método a su propia porción del ticket.
 *
 * Elegido sobre "recargar el ticket entero si algún método tiene recargo":
 * en un pago mixto de $10.000 con $5.000 en efectivo y $5.000 en tarjeta al
 * 15%, el recargo son $750 (sobre los $5.000 de tarjeta), no $1.500. Es lo
 * que hace un comercio real y lo único que no castiga al cliente que paga
 * una parte en efectivo.
 *
 * Un método que no está en `metodos` (borrado o desactivado entre que se
 * armó el carrito y se confirmó) se trata como recargo 0 en vez de tirar:
 * el cobro es válido igual, y fallar acá dejaría una venta sin registrar por
 * un dato de configuración. El server valida aparte que el método exista.
 */
export function calcularPagosConRecargo(
  pagos: PagoBase[],
  metodos: MetodoConRecargo[],
): TotalesConRecargo {
  const porId = new Map(metodos.map((metodo) => [metodo.id, metodo]));

  const pagosConRecargo = pagos.map((pago) => {
    const montoBase = normalizarMonto(pago.montoAsignado);
    const recargoPorcentaje = Number(
      porId.get(pago.metodoPagoId)?.recargo_porcentaje ?? 0,
    );
    const recargoMonto = calcularRecargoMonto(montoBase, recargoPorcentaje);

    return {
      metodoPagoId: pago.metodoPagoId,
      montoBase,
      recargoPorcentaje,
      recargoMonto,
      montoBruto: normalizarMonto(montoBase + recargoMonto),
    };
  });

  const totalBase = normalizarMonto(
    pagosConRecargo.reduce((acc, p) => acc + p.montoBase, 0),
  );
  const totalRecargo = normalizarMonto(
    pagosConRecargo.reduce((acc, p) => acc + p.recargoMonto, 0),
  );

  return {
    pagos: pagosConRecargo,
    totalBase,
    totalRecargo,
    totalACobrar: normalizarMonto(totalBase + totalRecargo),
  };
}

/**
 * Texto para el ticket y para el POS: "Recargo Tarjeta (15%)".
 * Con más de un método recargado se agrupa en una sola línea, porque el
 * detalle por método ya está arriba en el desglose de pagos.
 */
export function etiquetaRecargo(
  pagosConRecargo: PagoConRecargo[],
  metodos: MetodoConRecargo[],
): string {
  const conRecargo = pagosConRecargo.filter((p) => p.recargoMonto > 0);
  if (conRecargo.length === 0) return "";
  if (conRecargo.length > 1) return "Recargo por método de pago";

  const porId = new Map(metodos.map((metodo) => [metodo.id, metodo]));
  const nombre = porId.get(conRecargo[0].metodoPagoId)?.nombre ?? "método";
  return `Recargo ${nombre} (${conRecargo[0].recargoPorcentaje}%)`;
}
