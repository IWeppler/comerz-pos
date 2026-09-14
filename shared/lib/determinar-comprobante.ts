import {
  comprobanteDefectoEsValido,
  normalizarModoFacturacion,
  normalizarTipoComprobante,
  type TipoComprobante,
} from "./facturacion";

/**
 * QUÉ COMPROBANTE CORRESPONDE. Una sola función, en el server.
 *
 * La regla no depende de un solo dato sino del cruce de cuatro, y esa es la
 * razón de que esto exista como módulo propio en vez de repartido en ifs:
 *
 *   1. Condición de IVA del EMISOR   → qué letras puede emitir el comercio.
 *   2. Condición de IVA del RECEPTOR → cuál de esas letras le corresponde.
 *   3. Tipo de operación             → venta o devolución (nota de crédito).
 *   4. Configuración del comercio    → si factura, y con qué por defecto.
 *
 * Es pura y sin IO a propósito: recibe los cuatro datos ya resueltos y no
 * consulta nada. Así se puede testear la matriz entera sin base, y el único
 * lugar que lee la configuración es la capa que la llama.
 *
 * NUNCA la llama el cliente. El POS no decide qué comprobante emitir: manda la
 * venta y el server determina. Un comprobante elegido en el navegador es un
 * comprobante que se puede elegir con las DevTools abiertas.
 */

export type CondicionIva =
  | "Responsable Inscripto"
  | "Monotributo"
  | "Exento"
  | "Consumidor Final";

export type TipoOperacion = "VENTA" | "DEVOLUCION";

export interface EntradaDeterminacion {
  /** `configuracion_pos.modo_facturacion`. */
  modoFacturacion: unknown;
  /** `configuracion_pos.condicion_iva`. Sin esto no se puede facturar. */
  condicionIvaEmisor: string | null | undefined;
  /** Del cliente de la venta. null = consumidor final no identificado, que es
   * la enorme mayoría de las ventas de mostrador. */
  condicionIvaReceptor: string | null | undefined;
  /** `configuracion_pos.comprobante_defecto`. Solo se respeta si la matriz lo
   * permite: es una preferencia, no una orden. */
  comprobanteDefecto?: unknown;
  operacion?: TipoOperacion;
  /**
   * Si ESTE comercio puede pedir un CAE ahora: certificado cargado y vigente
   * para el ambiente activo (`tieneCredencialesListas`). Lo resuelve quien
   * llama, con la base; acá solo se respeta. Ausente = false: sin saberlo,
   * sale ticket.
   */
  arcaConectado?: boolean;
}

export interface ResultadoDeterminacion {
  tipo: TipoComprobante | NotaCredito;
  /** Por qué salió eso. Va a los logs y al detalle de la venta: cuando el
   * contador pregunte "por qué esto salió B y no A", la respuesta está. */
  motivo: string;
  /** Si ARCA exige identificar al comprador para este comprobante. */
  requiereReceptorIdentificado: boolean;
}

export type NotaCredito =
  | "NOTA_CREDITO_A"
  | "NOTA_CREDITO_B"
  | "NOTA_CREDITO_C";

/**
 * LA MATRIZ. Emisor → receptor → letra.
 *
 * Un monotributista o un exento emiten SIEMPRE C, sin importar a quién: no
 * discriminan IVA porque no lo liquidan. Por eso su fila es una sola celda.
 *
 * Un responsable inscripto emite A o B según pueda o no el receptor tomarse el
 * crédito fiscal. Solo otro responsable inscripto puede: de ahí que A sea la
 * excepción y B el caso general.
 *
 * OJO — LA CELDA A CONFIRMAR CON EL CONTADOR: emisor RI a receptor
 * Monotributo. Acá está puesta en B, que es lo que se desprende del criterio
 * de fondo (un monotributista no computa crédito fiscal, así que no necesita
 * la A). Es la única celda de la matriz donde el criterio y la costumbre
 * pueden no coincidir, y está aislada en una constante justamente para que
 * cambiarla sea una línea y no una cacería.
 */
export const RI_A_MONOTRIBUTO: "FACTURA_A" | "FACTURA_B" = "FACTURA_B";

const MATRIZ: Record<
  "Responsable Inscripto" | "Monotributo" | "Exento",
  Record<CondicionIva | "SIN_DATOS", TipoComprobante>
> = {
  "Responsable Inscripto": {
    "Responsable Inscripto": "FACTURA_A",
    Monotributo: RI_A_MONOTRIBUTO,
    Exento: "FACTURA_B",
    "Consumidor Final": "FACTURA_B",
    SIN_DATOS: "FACTURA_B",
  },
  Monotributo: {
    "Responsable Inscripto": "FACTURA_C",
    Monotributo: "FACTURA_C",
    Exento: "FACTURA_C",
    "Consumidor Final": "FACTURA_C",
    SIN_DATOS: "FACTURA_C",
  },
  Exento: {
    "Responsable Inscripto": "FACTURA_C",
    Monotributo: "FACTURA_C",
    Exento: "FACTURA_C",
    "Consumidor Final": "FACTURA_C",
    SIN_DATOS: "FACTURA_C",
  },
};

const NOTA_CREDITO_DE: Record<string, NotaCredito> = {
  FACTURA_A: "NOTA_CREDITO_A",
  FACTURA_B: "NOTA_CREDITO_B",
  FACTURA_C: "NOTA_CREDITO_C",
};

function esCondicionConocida(
  valor: unknown,
): valor is "Responsable Inscripto" | "Monotributo" | "Exento" {
  return (
    valor === "Responsable Inscripto" ||
    valor === "Monotributo" ||
    valor === "Exento"
  );
}

/**
 * Fail-closed en cada corte: ante cualquier duda sale TICKET interno.
 *
 * Emitir un ticket de más es un papel que no valía nada y no molesta a nadie.
 * Emitir una factura de menos —o con la letra equivocada— es un comprobante
 * inválido a nombre del comercio, y eso se arregla con el contador.
 */
export function determinarComprobante(
  entrada: EntradaDeterminacion,
): ResultadoDeterminacion {
  if (!entrada.arcaConectado) {
    return {
      tipo: "TICKET",
      motivo:
        "El comercio no tiene conectado ARCA (falta el certificado, o venció).",
      requiereReceptorIdentificado: false,
    };
  }

  return determinarComprobanteFiscal(entrada);
}

/**
 * La matriz, SIN el corte por conexión con ARCA.
 *
 * Está separada de `determinarComprobante` para que la regla fiscal se pueda
 * testear entera sin credenciales. La conexión es un hecho del comercio
 * (certificado cargado o no); esto es la regla del negocio. En producción se
 * entra siempre por `determinarComprobante`.
 */
export function determinarComprobanteFiscal(
  entrada: EntradaDeterminacion,
): ResultadoDeterminacion {
  const ticket = (motivo: string): ResultadoDeterminacion => ({
    tipo: "TICKET",
    motivo,
    requiereReceptorIdentificado: false,
  });

  const modo = normalizarModoFacturacion(entrada.modoFacturacion);
  if (modo !== "ARCA") {
    return ticket(
      modo === "MANUAL"
        ? "El comercio factura por fuera de Comerz (modo manual)."
        : "El comercio opera con ticket interno.",
    );
  }

  // Sin saber qué es el emisor no hay letra correcta posible. Un comercio que
  // eligió ARCA pero no cargó su condición de IVA es un error de configuración,
  // no una venta que haya que frenar: sale ticket y queda el motivo.
  if (!esCondicionConocida(entrada.condicionIvaEmisor)) {
    return ticket(
      "El comercio no tiene cargada su condición frente al IVA (Configuración → Comercio).",
    );
  }

  const receptor: CondicionIva | "SIN_DATOS" = esCondicionValidaReceptor(
    entrada.condicionIvaReceptor,
  )
    ? (entrada.condicionIvaReceptor as CondicionIva)
    : "SIN_DATOS";

  const letra = MATRIZ[entrada.condicionIvaEmisor][receptor];

  // El comprobante por defecto es una PREFERENCIA del comercio, no una orden:
  // solo se respeta si la matriz lo habilita para este receptor. Un comercio
  // con "Factura A" por defecto que le vende a un consumidor final emite B.
  const preferido = normalizarTipoComprobante(entrada.comprobanteDefecto);
  const tipoVenta =
    preferido !== "TICKET" &&
    preferido === letra &&
    comprobanteDefectoEsValido(modo, preferido, entrada.condicionIvaEmisor)
      ? preferido
      : letra;

  const motivoBase =
    receptor === "SIN_DATOS"
      ? `Emisor ${entrada.condicionIvaEmisor} y receptor sin datos fiscales: corresponde ${tipoVenta}.`
      : `Emisor ${entrada.condicionIvaEmisor} y receptor ${receptor}: corresponde ${tipoVenta}.`;

  if ((entrada.operacion ?? "VENTA") === "DEVOLUCION") {
    return {
      tipo: NOTA_CREDITO_DE[tipoVenta],
      motivo: `Devolución de una ${tipoVenta}: corresponde ${NOTA_CREDITO_DE[tipoVenta]}.`,
      // La nota de crédito hereda los datos del comprobante original, que ya
      // los tiene congelados: no hay nada nuevo que identificar.
      requiereReceptorIdentificado: false,
    };
  }

  return {
    tipo: tipoVenta,
    motivo: motivoBase,
    // La A siempre necesita al receptor identificado: sin CUIT no hay crédito
    // fiscal que respaldar. La B a consumidor final lo exige por encima de un
    // monto, pero ese umbral lo fija ARCA y cambia con el tiempo — no se
    // hardcodea acá: lo resuelve quien conozca el valor vigente.
    requiereReceptorIdentificado: tipoVenta === "FACTURA_A",
  };
}

function esCondicionValidaReceptor(valor: unknown): boolean {
  return (
    valor === "Responsable Inscripto" ||
    valor === "Monotributo" ||
    valor === "Exento" ||
    valor === "Consumidor Final"
  );
}
