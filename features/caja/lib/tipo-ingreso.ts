/**
 * Los tres tipos de plata que ENTRA sin venir de una venta, y qué hace cada
 * uno. Espejo de `tipo-egreso.ts` para el otro sentido; el espejo SQL es
 * `ingreso_impacto_resultado` (`20260922100000`).
 *
 * El eje que importa es el mismo que en los egresos: si toca la ganancia o
 * solo mueve plata. Un aporte de la dueña es la contracara del retiro —plata
 * de ella, no del negocio— y un préstamo hay que devolverlo. Solo el
 * extraordinario (un alquiler cobrado, una seña que devuelve un proveedor,
 * la venta de un mueble) es plata que el negocio ganó.
 *
 * Los tres entran al arqueo si van al cajón: la cajera cuenta billetes, no
 * conceptos.
 */

export const TIPOS_INGRESO = [
  "APORTE_SOCIO",
  "PRESTAMO",
  "INGRESO_EXTRAORDINARIO",
] as const;

export type TipoIngreso = (typeof TIPOS_INGRESO)[number];

interface DefinicionTipoIngreso {
  label: string;
  descripcion: string;
  /** Es resultado del negocio: suma a la ganancia. */
  afectaResultado: boolean;
}

export const DEFINICION_TIPO_INGRESO: Record<TipoIngreso, DefinicionTipoIngreso> =
  {
    APORTE_SOCIO: {
      label: "Aporte de dueño",
      descripcion:
        "Plata que pone la dueña de su bolsillo. Entra a la cuenta pero NO es ganancia.",
      afectaResultado: false,
    },
    PRESTAMO: {
      label: "Préstamo recibido",
      descripcion:
        "Plata prestada que hay que devolver. Entra a la cuenta pero NO es ganancia.",
      afectaResultado: false,
    },
    INGRESO_EXTRAORDINARIO: {
      label: "Otro ingreso",
      descripcion:
        "Un alquiler cobrado, una seña que devolvió un proveedor, algo que se vendió y no es mercadería. Es plata del negocio.",
      afectaResultado: true,
    },
  };

export function esTipoIngreso(valor: unknown): valor is TipoIngreso {
  return TIPOS_INGRESO.includes(valor as TipoIngreso);
}

/** Fail-closed hacia el lado que NO infla la ganancia: un tipo desconocido
 * se trata como aporte (mueve plata, no resultado). */
export function normalizarTipoIngreso(valor: unknown): TipoIngreso {
  return esTipoIngreso(valor) ? valor : "APORTE_SOCIO";
}

export function esResultadoDelNegocio(tipo: unknown): boolean {
  return DEFINICION_TIPO_INGRESO[normalizarTipoIngreso(tipo)].afectaResultado;
}

export function etiquetaTipoIngreso(tipo: unknown): string {
  return DEFINICION_TIPO_INGRESO[normalizarTipoIngreso(tipo)].label;
}
