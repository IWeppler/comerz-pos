/**
 * Cómo emite comprobantes un comercio. Dos ejes que NO son el mismo:
 *
 *  - `modo_facturacion` es la CAPACIDAD: de dónde sale el comprobante.
 *      INTERNO  el POS imprime un ticket sin validez fiscal. Es el estado
 *               inicial de los 4 negocios y el único que no depende de nadie.
 *      MANUAL   la venta se registra en Comerz y la factura se hace a mano en
 *               la web de ARCA. Para Comerz es idéntico a INTERNO en lo que
 *               imprime; cambia qué le promete al usuario, no qué emite.
 *      ARCA     Comerz pide el CAE y emite factura electrónica.
 *
 *  - `comprobante_defecto` es la ELECCIÓN: qué sale por defecto en la caja.
 *
 * Que sean independientes es justo lo que hay que frenar: un comercio en
 * INTERNO con "Factura B" por defecto emitiría un papel que dice factura y no
 * tiene CAE. De ahí las dos reglas de abajo, y de ahí que esto viva en
 * shared/lib y no en el panel — mismo criterio que recargo-metodo.ts: lo
 * comparten el form (cliente), la action (server) y, cuando se conecte ARCA,
 * la emisión en el POS. Para la regla de modo hay además un CHECK en la base.
 *
 * Fail-closed en las dos normalizaciones: lo que no se reconoce cae al lado
 * que NO emite nada fiscal. Equivocarse para ese lado imprime un ticket de
 * más; para el otro, emite un comprobante inválido a nombre del comercio.
 */

export const MODOS_FACTURACION = ["INTERNO", "MANUAL", "ARCA"] as const;
export type ModoFacturacion = (typeof MODOS_FACTURACION)[number];

export const TIPOS_COMPROBANTE = [
  "TICKET",
  "FACTURA_A",
  "FACTURA_B",
  "FACTURA_C",
] as const;
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number];

export const MODO_FACTURACION_DEFAULT: ModoFacturacion = "INTERNO";
export const TIPO_COMPROBANTE_DEFAULT: TipoComprobante = "TICKET";

interface DefinicionModo {
  label: string;
  descripcion: string;
  /** Si Comerz emite comprobantes con validez fiscal (CAE) por sí mismo. */
  emiteFiscal: boolean;
}

export const DEFINICION_MODO: Record<ModoFacturacion, DefinicionModo> = {
  INTERNO: {
    label: "Control interno",
    descripcion:
      "Solo tickets de uso interno para control de caja. No tienen validez fiscal.",
    emiteFiscal: false,
  },
  MANUAL: {
    label: "Facturación manual",
    descripcion:
      "Las ventas se registran en Comerz, pero las facturas las hacés vos en la web de ARCA.",
    emiteFiscal: false,
  },
  ARCA: {
    label: "Automática (ARCA)",
    descripcion:
      "Comerz se conecta con ARCA y emite facturas electrónicas con CAE.",
    emiteFiscal: true,
  },
};

export const ETIQUETA_COMPROBANTE: Record<TipoComprobante, string> = {
  TICKET: "Ticket interno (no fiscal)",
  FACTURA_A: "Factura A",
  FACTURA_B: "Factura B",
  FACTURA_C: "Factura C",
};

export function normalizarModoFacturacion(valor: unknown): ModoFacturacion {
  return MODOS_FACTURACION.includes(valor as ModoFacturacion)
    ? (valor as ModoFacturacion)
    : MODO_FACTURACION_DEFAULT;
}

export function normalizarTipoComprobante(valor: unknown): TipoComprobante {
  return TIPOS_COMPROBANTE.includes(valor as TipoComprobante)
    ? (valor as TipoComprobante)
    : TIPO_COMPROBANTE_DEFAULT;
}

export function emiteComprobanteFiscal(modo: unknown): boolean {
  return DEFINICION_MODO[normalizarModoFacturacion(modo)].emiteFiscal;
}

/**
 * Qué comprobantes puede elegir ESTE comercio, cruzando las dos condiciones.
 *
 * La condición de IVA no es un detalle de presentación: un monotributista no
 * puede emitir A ni B, y un responsable inscripto no emite C. Ofrecerle al
 * usuario una opción que ARCA le va a rechazar en el mostrador, con la clienta
 * esperando, es peor que no ofrecerla.
 *
 * `condicionIva` desconocida o sin cargar deja solo TICKET: sin saber qué es
 * el emisor no hay comprobante fiscal correcto que ofrecer.
 */
export function comprobantesPermitidos(
  modo: unknown,
  condicionIva: string | null | undefined,
): TipoComprobante[] {
  if (!emiteComprobanteFiscal(modo)) return ["TICKET"];

  switch (condicionIva) {
    case "Responsable Inscripto":
      return ["TICKET", "FACTURA_A", "FACTURA_B"];
    case "Monotributo":
    case "Exento":
      return ["TICKET", "FACTURA_C"];
    default:
      return ["TICKET"];
  }
}

/** Espejo en código del CHECK `configuracion_pos_comprobante_defecto_check`.
 * La base frena la regla de modo (dura y estable); esta función además aplica
 * la de condición de IVA, que a propósito NO es CHECK: un comercio que pasa de
 * Monotributo a RI tiene que poder guardar el cambio de condición sin que le
 * reviente por un default que quedó viejo. */
export function comprobanteDefectoEsValido(
  modo: unknown,
  tipo: unknown,
  condicionIva: string | null | undefined,
): boolean {
  return comprobantesPermitidos(modo, condicionIva).includes(
    normalizarTipoComprobante(tipo),
  );
}

/**
 * Si un comercio puede pedir un CAE NO es una constante del código: lo decide
 * su certificado (`features/arca/lib/credenciales.ts`,
 * `tieneCredencialesListas`) y viaja como `arcaConectado` a
 * `determinarComprobante`. Hubo una `ARCA_EMISION_DISPONIBLE = false` acá
 * hasta que existió la conexión; se sacó porque un flag global prendería a
 * los cuatro negocios a la vez, y la conexión es de cada uno.
 */

/**
 * Qué comprobante emitir al cerrar una venta NO se decide acá: lo decide
 * `shared/lib/determinar-comprobante.ts`, que cruza emisor + receptor +
 * operación + configuración. Este módulo aporta el vocabulario (tipos,
 * normalizadores) y las reglas que dependen SOLO de la configuración del
 * comercio, que son las que usa el panel.
 *
 * Hubo una `tipoComprobanteAEmitir` acá que miraba únicamente la config y
 * nunca al cliente. Se sacó al centralizar la determinación: dos funciones que
 * responden la misma pregunta con distinta información terminan, siempre, en
 * dos respuestas distintas.
 */

/**
 * Si un comprobante ya emitido tiene efectos fiscales. El ticket interno no
 * los tiene: anularlo es simplemente marcar la venta ANULADA. Una factura sí,
 * y no se "desanula" — se compensa con una nota de crédito.
 *
 * Se decide por prefijo y no por lista para que un tipo nuevo (una FACTURA_M,
 * un tipo que agregue ARCA) cuente como fiscal sin que haya que acordarse de
 * sumarlo acá. Fail-closed: lo único no fiscal es TICKET.
 */
export function esComprobanteFiscal(tipo: unknown): boolean {
  return typeof tipo === "string" && tipo !== "TICKET" && tipo.trim() !== "";
}

/**
 * Si anular esta venta exige emitir una nota de crédito.
 *
 * True cuando hay una factura emitida y todavía ninguna nota de crédito que la
 * compense. Con solo tickets internos devuelve false, que es el caso de los 4
 * negocios hoy: anular sigue siendo marcar la venta y devolver la plata.
 */
export function requiereNotaCredito(
  comprobantes: readonly { tipo?: unknown }[] | null | undefined,
): boolean {
  if (!comprobantes?.length) return false;

  const tipos = comprobantes.map((c) => String(c?.tipo ?? ""));
  const hayFactura = tipos.some(
    (t) => esComprobanteFiscal(t) && !t.startsWith("NOTA_CREDITO"),
  );
  const hayNotaCredito = tipos.some((t) => t.startsWith("NOTA_CREDITO"));

  return hayFactura && !hayNotaCredito;
}

/**
 * Punto de venta con el que se numera un ticket interno cuando el comercio no
 * tiene ninguno dado de alta en ARCA — que es el caso de los 4 negocios.
 *
 * La columna es NOT NULL porque un comprobante sin punto de venta no se puede
 * identificar. El 1 acá no pretende ser un punto de venta fiscal: es la serie
 * interna del comercio, y como la numeración es por (punto_venta, tipo), el
 * día que se dé de alta un punto de venta real los TICKET siguen su propia
 * cuenta sin chocar con las facturas.
 */
export const PUNTO_VENTA_INTERNO_DEFAULT = 1;

/**
 * Punto de venta de ARCA: entero de 1 a 99999. Devuelve null para "sin
 * configurar", que es un estado legítimo (nadie tiene punto de venta hasta que
 * lo da de alta en ARCA) y distinto de un valor inválido.
 */
export function parsePuntoVenta(valor: unknown): number | null {
  const texto = String(valor ?? "").trim();
  if (texto === "") return null;
  if (!/^\d{1,5}$/.test(texto)) return null;

  const numero = Number(texto);
  return numero >= 1 && numero <= 99999 ? numero : null;
}

/** Formato con el que ARCA imprime el punto de venta: 5 dígitos, "00001". */
export function formatearPuntoVenta(valor: number | null | undefined): string {
  return valor == null ? "—" : String(valor).padStart(5, "0");
}

/**
 * Número de comprobante como se imprime: punto de venta y número separados
 * por guión, "0001-00000123". Es el formato que la gente reconoce de
 * cualquier factura, y el mismo que se usa para buscar un comprobante en
 * ARCA — vale la pena respetarlo incluso en el ticket interno.
 *
 * El punto de venta se rellena a 4 dígitos, que es el ancho clásico, pero no
 * se recorta: ARCA admite hasta 99999 y un punto de venta de 5 dígitos tiene
 * que imprimirse entero, no truncado.
 */
export function formatearNumeroComprobante(
  puntoVenta: number | null | undefined,
  numero: number | null | undefined,
): string | null {
  if (puntoVenta == null || numero == null) return null;
  return `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}
