import type { MetodoPago, TipoMetodo } from "@/entities/payments/types";

/**
 * Los botones de método de pago del carrito público: uno por TIPO, nunca uno
 * por método.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ POR TIPO Y NO POR MÉTODO
 *
 * `metodos_pago` guarda un `tipo` cerrado (EFECTIVO, TARJETA, TRANSFERENCIA,
 * BILLETERA_VIRTUAL) y un `nombre` que escribe cada comercio para uso INTERNO.
 * Los nombres reales de hoy lo dicen todo: "TARJETA BANCO NACION", "POSTNET
 * MERCADO PAGO", "Transf. Mercado Pago", "credito". Son etiquetas para la
 * vendedora, no para la clienta, y tres de los seis negocios tienen CINCO
 * métodos activos: cinco botones con esos nombres en un celular es un
 * formulario, no una elección.
 *
 * Por tipo son cuatro como máximo, por construcción — no por una constante que
 * alguien tenga que acordarse de subir. Si mañana aparece un tipo nuevo en la
 * base, aparece un botón nuevo; si un negocio no tiene ninguno de un tipo, ese
 * botón no existe.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EL RECARGO DE UN TIPO ES EL MÁS ALTO DE SUS MÉTODOS, y es una decisión de
 * plata, no de prolijidad. ClickTostado tiene tres tarjetas: una al 0% y dos
 * al 5%. Mostrando el menor, la clienta cierra el pedido con un total que dos
 * de cada tres veces va a ser más bajo que el que le van a cobrar, y la
 * diferencia aparece en el mostrador con la mercadería ya empaquetada. Con el
 * mayor, el peor caso es una sorpresa a favor.
 *
 * NO EXISTEN "DÉBITO" Y "CRÉDITO" como tipos: los dos son TARJETA. Un negocio
 * puede llamar "Débito" a un método, pero eso es su nombre interno, no una
 * categoría que la base distinga — separarlos acá sería inventar un dato.
 */

/** Cómo se le nombra cada tipo a la clienta, que no es como lo nombra el
 * comercio. "Billetera virtual" y no "Mercado Pago": el tipo puede agrupar
 * varias, y el nombre de una sola sería mentira en el resto de los casos. */
const ETIQUETA_TIPO: Record<TipoMetodo, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  TRANSFERENCIA: "Transferencia",
  BILLETERA_VIRTUAL: "Billetera virtual",
};

/** El orden en que se ofrecen. Efectivo primero porque es el que más se usa y
 * el que suele tener descuento; el resto por cercanía a "pagar sin tarjeta". */
const ORDEN_TIPO: TipoMetodo[] = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "BILLETERA_VIRTUAL",
  "TARJETA",
];

export interface OpcionPagoPublica {
  tipo: TipoMetodo;
  etiqueta: string;
  /** El MÁS ALTO de los métodos de ese tipo. Ver el encabezado. */
  recargoPorcentaje: number;
  /**
   * Presente solo en los medios de PAGO ONLINE (orden en Comerz, no pedido por
   * WhatsApp). Ver `features/store/lib/orden-tienda.ts`.
   */
  online?: "TRANSFERENCIA" | "MP_CHECKOUT" | "MP_CREDITO";
}

/** Lo mínimo que el catálogo público puede leer de un método: `comision` NO
 * está concedida a anon y no hace falta acá. */
export type MetodoPublico = Pick<
  MetodoPago,
  "tipo" | "recargo_porcentaje" | "activo"
>;

export function opcionesDePagoPublicas(
  metodos: MetodoPublico[] | null | undefined,
): OpcionPagoPublica[] {
  const recargoPorTipo = new Map<TipoMetodo, number>();

  for (const metodo of metodos ?? []) {
    if (!metodo.activo) continue;
    // Un tipo que la base tenga y este código no conozca se descarta en vez de
    // dibujarse sin etiqueta: mismo criterio fail-closed que el resto de las
    // reglas de promociones.
    if (!ETIQUETA_TIPO[metodo.tipo]) continue;

    const recargo = Number(metodo.recargo_porcentaje) || 0;
    const previo = recargoPorTipo.get(metodo.tipo);
    if (previo === undefined || recargo > previo) {
      recargoPorTipo.set(metodo.tipo, recargo);
    }
  }

  return ORDEN_TIPO.filter((tipo) => recargoPorTipo.has(tipo)).map((tipo) => ({
    tipo,
    etiqueta: ETIQUETA_TIPO[tipo],
    recargoPorcentaje: recargoPorTipo.get(tipo) ?? 0,
  }));
}

export function etiquetaTipoPago(tipo: TipoMetodo): string {
  return ETIQUETA_TIPO[tipo] ?? tipo;
}
