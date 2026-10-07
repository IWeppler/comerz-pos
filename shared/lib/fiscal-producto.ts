import type { Rubro } from "@/entities/config/types";

/**
 * Tratamiento frente al IVA de un producto.
 *
 * UN solo campo y no dos ("alícuota" + "exento/gravado") a propósito: con dos
 * campos existen combinaciones imposibles —exento con 21%, gravado sin
 * alícuota— y alguien las va a guardar. Acá cada valor dice las dos cosas a la
 * vez y no hay estado inválido que representar.
 *
 * EXENTO y NO_GRAVADO no son sinónimos aunque los dos den impuesto cero: el
 * exento está alcanzado por el impuesto pero liberado (un libro), el no
 * gravado directamente queda afuera del objeto del impuesto. En la factura y
 * en el libro de IVA van en columnas distintas, así que se guardan distinto.
 */
export const TRATAMIENTOS_IVA = [
  "GRAVADO_21",
  "GRAVADO_105",
  "GRAVADO_27",
  "EXENTO",
  "NO_GRAVADO",
] as const;

export type TratamientoIva = (typeof TRATAMIENTOS_IVA)[number];

export const TRATAMIENTO_IVA_DEFAULT: TratamientoIva = "GRAVADO_21";

interface DefinicionTratamiento {
  label: string;
  /** Alícuota en porcentaje. 0 para exento y no gravado. */
  alicuota: number;
  /** Si el importe entra en la base imponible del IVA. */
  gravado: boolean;
}

export const DEFINICION_TRATAMIENTO_IVA: Record<
  TratamientoIva,
  DefinicionTratamiento
> = {
  GRAVADO_21: { label: "21% (general)", alicuota: 21, gravado: true },
  GRAVADO_105: { label: "10,5% (reducida)", alicuota: 10.5, gravado: true },
  GRAVADO_27: { label: "27% (servicios)", alicuota: 27, gravado: true },
  EXENTO: { label: "Exento", alicuota: 0, gravado: false },
  NO_GRAVADO: { label: "No gravado", alicuota: 0, gravado: false },
};

/**
 * Fail-closed hacia el 21%: es la alícuota general y la que corresponde a casi
 * todo lo que venden estos comercios. Equivocarse para este lado cobra IVA de
 * más y se corrige; para el otro se factura sin el impuesto que había que
 * liquidar, que es el error que después se paga con intereses.
 */
export function normalizarTratamientoIva(valor: unknown): TratamientoIva {
  return TRATAMIENTOS_IVA.includes(valor as TratamientoIva)
    ? (valor as TratamientoIva)
    : TRATAMIENTO_IVA_DEFAULT;
}

export function alicuotaDe(tratamiento: unknown): number {
  return DEFINICION_TRATAMIENTO_IVA[normalizarTratamientoIva(tratamiento)]
    .alicuota;
}

export function etiquetaTratamientoIva(tratamiento: unknown): string {
  return DEFINICION_TRATAMIENTO_IVA[normalizarTratamientoIva(tratamiento)].label;
}

/**
 * Separa un precio FINAL (con IVA adentro, que es como se cargan los precios
 * en el POS y como se muestran en el catálogo) en neto e impuesto.
 *
 * Ojo con la dirección de la cuenta: el neto es `precio / (1 + alícuota/100)`,
 * NO `precio - precio * alícuota/100`. Con 21% la segunda da 79 en vez de
 * 82,64 sobre 100 — un 4,4% de diferencia que en el libro de IVA no cierra.
 *
 * Redondeo al centavo en el neto y el IVA por diferencia, para que neto + iva
 * dé EXACTAMENTE el precio y la factura no cierre por un centavo.
 */
export function desglosarIva(
  precioFinal: number,
  tratamiento: unknown,
): { neto: number; iva: number } {
  const alicuota = alicuotaDe(tratamiento);
  if (alicuota === 0) return { neto: redondear(precioFinal), iva: 0 };

  const neto = redondear(precioFinal / (1 + alicuota / 100));
  return { neto, iva: redondear(precioFinal - neto) };
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Unidad en la que se vende el producto.
 *
 * Se guarda el valor semántico, no el código numérico de ARCA. El código
 * fiscal es una TRADUCCIÓN de esto y entra junto con la integración de ARCA,
 * donde se puede verificar contra la tabla oficial: meter acá números que no
 * se pueden comprobar hoy es sembrar un error que recién aparecería con la
 * primera factura rechazada.
 */
export const UNIDADES_MEDIDA = [
  "UNIDAD",
  "KG",
  "GRAMO",
  "LITRO",
  "METRO",
  "PAR",
] as const;

export type UnidadMedida = (typeof UNIDADES_MEDIDA)[number];

export const UNIDAD_MEDIDA_DEFAULT: UnidadMedida = "UNIDAD";

export const ETIQUETA_UNIDAD: Record<UnidadMedida, string> = {
  UNIDAD: "Unidad",
  KG: "Kilogramo",
  GRAMO: "Gramo",
  LITRO: "Litro",
  METRO: "Metro",
  PAR: "Par",
};

/** Abreviatura para la fila de inventario y el ticket. */
export const ABREVIATURA_UNIDAD: Record<UnidadMedida, string> = {
  UNIDAD: "u.",
  KG: "kg",
  GRAMO: "g",
  LITRO: "L",
  METRO: "m",
  PAR: "par",
};

export function normalizarUnidadMedida(valor: unknown): UnidadMedida {
  return UNIDADES_MEDIDA.includes(valor as UnidadMedida)
    ? (valor as UnidadMedida)
    : UNIDAD_MEDIDA_DEFAULT;
}

/**
 * Valores fiscales con los que nace un producto según el rubro del comercio.
 *
 * La idea es que el 99% de las altas no tenga que ver nada de esto: una
 * vendedora de indumentaria carga nombre y precio, y el producto ya queda
 * bien cargado fiscalmente. Los campos existen y se pueden cambiar, pero no
 * están adelante.
 *
 * Son DEFAULTS, no reglas: se copian al producto en el alta y desde ahí el
 * producto manda. Si mañana el comercio cambia de rubro, lo ya cargado NO se
 * recalcula — y es a propósito: el tratamiento fiscal de lo que ya se vendió
 * no puede cambiar retroactivamente porque alguien tocó una configuración.
 */
export interface DefaultsFiscales {
  unidad_medida: UnidadMedida;
  tratamiento_iva: TratamientoIva;
}

/**
 * EXHAUSTIVO (`Record`, no `Partial`) a propósito: sumar un rubro al tipo
 * `Rubro` sin decidir con qué nace su mercadería tiene que ser un error de
 * compilación. Con `Partial` el rubro nuevo caía al fallback sin que nadie
 * tomara la decisión, que es como farmacia y alimentos llegaron hasta hoy
 * heredando los defaults de una tienda de ropa.
 *
 * Los 7 arrancan igual —unidad + 21%— y eso es una decisión, no un pendiente:
 *
 * - **La unidad arranca en UNIDAD también en `alimentos`, aunque ya se pueda
 *   vender por peso.** Desde `20260819120000` toda la cadena de cantidad es
 *   `numeric(12,3)` y el POS tiene teclado de peso, así que KG funciona. Lo
 *   que no funciona es un default de KG: vender por peso es del PRODUCTO, no
 *   del rubro, y un almacén vende la yerba, la gaseosa y el paquete de fideos
 *   por unidad. Nacer en KG haría que cada producto envasado se cobre con el
 *   teclado de peso hasta que alguien lo corrija; nacer en UNIDAD deja el
 *   fiambre y lo suelto como la excepción que se elige en el alta
 *   (ver docs/stock-y-catalogo.md, "Venta por peso").
 *
 * - **La alícuota se queda en 21% por el mismo criterio fail-closed de
 *   `normalizarTratamientoIva`**: cobrar IVA de más se corrige, facturar sin el
 *   impuesto que había que liquidar se paga con intereses.
 *
 *   La celda que MÁS discute con eso es `farmacia`: en una farmacia el grueso
 *   de la facturación son medicamentos de uso humano, que van EXENTOS, y solo
 *   la perfumería y la higiene van al 21%. Queda igual en 21% hasta
 *   confirmarlo con el contador — mismo tratamiento que `RI_A_MONOTRIBUTO` en
 *   `determinar-comprobante.ts`. Hoy no cambia nada en producción (los 4
 *   negocios emiten TICKET interno y esta columna no se imprime), pero el día
 *   que se prenda ARCA sale en el papel: **confirmar antes de facturar.**
 *
 *   Misma discusión, más chica, en `alimentos`: carne, pan común, harina,
 *   leche, frutas y verduras van al 10,5%, y casi todo lo envasado al 21%. Es
 *   mezcla dentro del mismo comercio, así que ningún default acierta siempre y
 *   el 21% es el lado barato de equivocarse.
 */
const DEFAULTS_POR_RUBRO: Record<Rubro, DefaultsFiscales> = {
  pintureria: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  indumentaria: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  electro: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  ferreteria: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  quioscos: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  cotillon: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  // Las dos que hay que revisar antes de facturar con ARCA. Ver arriba.
  farmacia: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  alimentos: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
  otros: { unidad_medida: "UNIDAD", tratamiento_iva: "GRAVADO_21" },
};

/**
 * Fail-closed a unidad + 21% para lo que no es un rubro conocido: fila sin
 * config, valor viejo o typo. Los 7 rubros válidos tienen su fila propia
 * arriba.
 */
export function defaultsFiscalesPorRubro(rubro: unknown): DefaultsFiscales {
  return (
    DEFAULTS_POR_RUBRO[rubro as Rubro] ?? {
      unidad_medida: UNIDAD_MEDIDA_DEFAULT,
      tratamiento_iva: TRATAMIENTO_IVA_DEFAULT,
    }
  );
}
