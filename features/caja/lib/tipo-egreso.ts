/**
 * Los cuatro tipos de plata que sale de la caja, y qué hace cada uno.
 *
 * La distinción no es contable-por-prolijidad: hasta que existió esta
 * columna, la ganancia del panel restaba los tres por igual, así que un
 * retiro de la dueña se leía como que el negocio ganó menos, y una compra de
 * mercadería se contaba dos veces (el costo ya viaja en `precio_costo`
 * cuando el producto se vende).
 *
 * Dos ejes independientes:
 *
 *  - `afectaEfectivo`: si se lleva plata del cajón. Los CUATRO lo hacen, y por
 *    eso el arqueo de cierre no cambia — el efectivo esperado sigue restando
 *    todo. Está declarado igual y no dado por sentado: es la clase de cosa
 *    que alguien "optimiza" a futuro y descuadra una caja.
 *  - `afectaResultado`: si es gasto del negocio. Solo OPERATIVO.
 *
 * DEVOLUCION entró el 21/9/2026 (`20260921180000`) porque `anular_venta` y
 * `registrar_devolucion` insertaban el reintegro en efectivo sin tipo, caía
 * en OPERATIVO, y la misma plata se descontaba dos veces: la venta anulada ya
 * había salido de los ingresos y el egreso volvía a restar como gasto. 41
 * egresos, $1.977.999. La marca la escriben esas dos RPCs; acá solo se define
 * qué significa. El espejo SQL es `egreso_impacto_resultado`.
 *
 * Vive en lib y no en la action porque lo consumen el modal (cliente), la
 * action (server) y el cálculo de métricas del panel: una sola definición.
 */

export const TIPOS_EGRESO = [
  "OPERATIVO",
  "RETIRO_SOCIO",
  "COMPRA_MERCADERIA",
  "DEVOLUCION",
] as const;

/**
 * Lo que se puede elegir a MANO al registrar un gasto. DEVOLUCION queda
 * afuera: esa marca la escriben `anular_venta` y `registrar_devolucion`
 * (columna, no heurística — ver más arriba); si el modal la ofreciera, una
 * vendedora podría marcar "Devolución a cliente" en un gasto que no es
 * ningún reintegro de venta, y la distinción quedaría en manos de quien
 * tipea, que es justo lo que la columna vino a evitar.
 */
export const TIPOS_EGRESO_MANUALES = TIPOS_EGRESO.filter(
  (t) => t !== "DEVOLUCION",
);

export type TipoEgreso = (typeof TIPOS_EGRESO)[number];

interface DefinicionTipoEgreso {
  label: string;
  descripcion: string;
  /** Se lleva plata del cajón: cuenta para el arqueo de cierre. */
  afectaEfectivo: boolean;
  /** Es gasto del negocio: resta del resultado operativo. */
  afectaResultado: boolean;
}

export const DEFINICION_TIPO_EGRESO: Record<TipoEgreso, DefinicionTipoEgreso> = {
  OPERATIVO: {
    label: "Gasto operativo",
    descripcion: "Luz, flete, limpieza, café. Es gasto del negocio.",
    afectaEfectivo: true,
    afectaResultado: true,
  },
  RETIRO_SOCIO: {
    label: "Retiro de dueño",
    descripcion:
      "Plata que se lleva la dueña. Sale de la caja pero NO es un gasto: es la ganancia ya hecha.",
    afectaEfectivo: true,
    afectaResultado: false,
  },
  COMPRA_MERCADERIA: {
    label: "Compra de mercadería",
    descripcion:
      "Pago a proveedor. No resta de la ganancia: el costo ya se cuenta cuando se vende el producto.",
    afectaEfectivo: true,
    afectaResultado: false,
  },
  DEVOLUCION: {
    label: "Devolución a cliente",
    descripcion:
      "Reintegro en efectivo de una venta anulada o devuelta. Sale de la caja pero NO es un gasto: la venta ya salió de los ingresos.",
    afectaEfectivo: true,
    afectaResultado: false,
  },
};

/** Fail-closed: lo que no se reconoce se trata como gasto operativo, que es
 * como se comportaba TODO antes de que existiera la columna. Equivocarse para
 * este lado subestima la ganancia; para el otro, la infla. */
export function normalizarTipoEgreso(valor: unknown): TipoEgreso {
  return TIPOS_EGRESO.includes(valor as TipoEgreso)
    ? (valor as TipoEgreso)
    : "OPERATIVO";
}

export function esGastoDelNegocio(tipo: unknown): boolean {
  return DEFINICION_TIPO_EGRESO[normalizarTipoEgreso(tipo)].afectaResultado;
}

export function salePlataDeLaCaja(tipo: unknown): boolean {
  return DEFINICION_TIPO_EGRESO[normalizarTipoEgreso(tipo)].afectaEfectivo;
}

export function etiquetaTipoEgreso(tipo: unknown): string {
  return DEFINICION_TIPO_EGRESO[normalizarTipoEgreso(tipo)].label;
}

/** Suma solo lo que resta del resultado. Lo usan el panel y los reportes. */
export function sumarGastosOperativos(
  egresos: readonly { monto: number | string; tipo?: string | null }[],
): number {
  return egresos.reduce(
    (acc, e) => (esGastoDelNegocio(e.tipo) ? acc + Number(e.monto || 0) : acc),
    0,
  );
}

/** Suma todo lo que salió del cajón, sea gasto o no. Lo usa el arqueo. */
export function sumarSalidasDeCaja(
  egresos: readonly { monto: number | string; tipo?: string | null }[],
): number {
  return egresos.reduce(
    (acc, e) => (salePlataDeLaCaja(e.tipo) ? acc + Number(e.monto || 0) : acc),
    0,
  );
}
