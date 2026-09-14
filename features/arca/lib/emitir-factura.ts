import {
  armarFactura,
  ErrorFactura,
  type AlicuotaIva,
  type ComprobanteAsociado,
  type DesgloseFiscal,
  type EntradaFactura,
  type ReceptorFiscal,
  type RenglonFiscal,
  type TipoFiscal,
} from "./armar-factura";
import { CBTE_TIPO, fechaArcaAIso, type AmbienteArca } from "./codigos-arca";
import { obtenerTicketAcceso } from "./credenciales";
import {
  ErrorWsfe,
  feCaeSolicitar,
  feCompConsultar,
  feCompUltimoAutorizado,
  type ErrorArca,
} from "./wsfe";
import { ErrorWsaa } from "./wsaa";

/**
 * Pedir el CAE de un comprobante, de punta a punta: ticket de acceso, último
 * número autorizado, armar, solicitar, y resolver los dos casos feos.
 *
 * LOS DOS CASOS FEOS, que son el motivo de que esto exista como módulo y no
 * como tres llamadas seguidas en create-sale:
 *
 * 1. **Timeout con CAE emitido.** ARCA recibió el pedido, autorizó, y la
 *    respuesta se perdió. Reintentar "de cero" pediría el número siguiente y
 *    dejaría una factura autorizada que Comerz no conoce. Por eso, ante un
 *    error de red, se vuelve a consultar el último autorizado: si avanzó
 *    hasta NUESTRO número, se lee ese comprobante (FECompConsultar) y, si
 *    importe, fecha y documento coinciden con lo que se mandó, ES el nuestro
 *    y se usa su CAE. Si no coincide, se falla con todo el detalle en el log.
 *
 * 2. **Dos cajas a la vez.** Las dos leen el mismo último número, las dos
 *    piden N+1, y ARCA le rechaza a la segunda con 10016 ("no se corresponde
 *    con el próximo a autorizar"). Se reintenta UNA vez con el número fresco.
 *    Una sola: si vuelve a pasar, algo más está mal que la concurrencia.
 *
 * Nunca devuelve un comprobante rechazado como si fuera emitido: `R` lanza
 * con las observaciones de ARCA, que son el mensaje que la vendedora
 * necesita ("el CUIT del receptor no es válido", etc.).
 */

export interface EntradaEmision {
  negocioId: string;
  ambiente: AmbienteArca;
  cuitEmisor: string;
  condicionIvaEmisor: string;
  tipo: TipoFiscal;
  puntoVenta: number;
  renglones: RenglonFiscal[];
  recargos: number;
  total: number;
  receptor: ReceptorFiscal | null;
  fecha: Date;
  comprobantesAsociados?: ComprobanteAsociado[];
  /** Ver `EntradaFactura.desgloseFijo`: para la nota de crédito. */
  desgloseFijo?: EntradaFactura["desgloseFijo"];
  tratamientoRecargos?: unknown;
  topeConsumidorFinal?: number | null;
}

export interface FacturaEmitida {
  tipo: TipoFiscal;
  puntoVenta: number;
  numero: number;
  cae: string;
  /** yyyy-mm-dd */
  caeVencimiento: string;
  /** yyyy-mm-dd, el CbteFch. */
  fechaComprobante: string;
  desglose: DesgloseFiscal;
  iva: AlicuotaIva[];
  observaciones: ErrorArca[];
  ambiente: AmbienteArca;
  /** True si el CAE se recuperó tras un timeout en vez de recibirse directo. */
  recuperada: boolean;
}

export class ErrorEmision extends Error {
  constructor(
    public readonly codigo:
      | "CREDENCIALES"
      | "WSAA"
      | "WSFE"
      | "RECHAZADO"
      | "DATOS"
      | "INCONSISTENTE",
    mensaje: string,
    public readonly detalle?: unknown,
  ) {
    super(mensaje);
    this.name = "ErrorEmision";
  }
}

const CODIGO_NUMERO_DESFASADO = 10016;

export async function emitirFacturaArca(
  entrada: EntradaEmision,
): Promise<FacturaEmitida> {
  const cbteTipo = CBTE_TIPO[entrada.tipo];
  if (cbteTipo == null) {
    throw new ErrorEmision("DATOS", `${entrada.tipo} no es fiscal.`);
  }

  let ticket;
  try {
    ({ ticket } = await obtenerTicketAcceso(entrada.negocioId, entrada.ambiente));
  } catch (e) {
    if (e instanceof ErrorWsaa) {
      throw new ErrorEmision(
        "WSAA",
        `ARCA no autorizó la conexión: ${e.message}`,
        e,
      );
    }
    throw new ErrorEmision("CREDENCIALES", (e as Error).message, e);
  }

  const auth = { ticket, cuit: entrada.cuitEmisor.replaceAll(/\D/g, "") };
  const consultarUltimo = () =>
    feCompUltimoAutorizado(
      entrada.ambiente,
      auth,
      entrada.puntoVenta,
      cbteTipo,
    );

  let ultimo: number;
  try {
    ultimo = await consultarUltimo();
  } catch (e) {
    throw new ErrorEmision("WSFE", mensajeWsfe(e), e);
  }

  for (let intento = 1; intento <= 2; intento++) {
    const numero = ultimo + 1;

    let armado;
    try {
      armado = armarFactura({
        tipo: entrada.tipo,
        puntoVenta: entrada.puntoVenta,
        numero,
        emisorCondicionIva: entrada.condicionIvaEmisor,
        emisorCuit: auth.cuit,
        renglones: entrada.renglones,
        recargos: entrada.recargos,
        total: entrada.total,
        receptor: entrada.receptor,
        fecha: entrada.fecha,
        comprobantesAsociados: entrada.comprobantesAsociados,
        desgloseFijo: entrada.desgloseFijo,
        tratamientoRecargos: entrada.tratamientoRecargos,
        topeConsumidorFinal: entrada.topeConsumidorFinal,
      });
    } catch (e) {
      if (e instanceof ErrorFactura) {
        throw new ErrorEmision("DATOS", e.message, e);
      }
      throw e;
    }
    const { solicitud, desglose } = armado;

    try {
      const r = await feCaeSolicitar(entrada.ambiente, auth, solicitud);

      if (r.resultado === "R" || !r.cae || !r.caeVencimiento) {
        throw new ErrorEmision(
          "RECHAZADO",
          `ARCA rechazó el comprobante: ${
            r.observaciones.map((o) => `${o.codigo} ${o.mensaje}`).join(" | ") ||
            "sin detalle"
          }`,
          r,
        );
      }

      return {
        tipo: entrada.tipo,
        puntoVenta: entrada.puntoVenta,
        numero: r.numero,
        cae: r.cae,
        caeVencimiento: r.caeVencimiento,
        fechaComprobante: fechaArcaAIso(solicitud.fecha)!,
        desglose,
        iva: desglose.iva,
        observaciones: r.observaciones,
        ambiente: entrada.ambiente,
        recuperada: false,
      };
    } catch (e) {
      if (e instanceof ErrorEmision) throw e;

      if (e instanceof ErrorWsfe && e.codigo === "RED") {
        // Caso 1: ¿ARCA lo autorizó y perdimos la respuesta?
        const recuperada = await intentarRecuperar(entrada, auth, cbteTipo, solicitud.numero, {
          impTotal: solicitud.impTotal,
          fecha: solicitud.fecha,
          docNro: solicitud.docNro,
        });
        if (recuperada) {
          console.warn("[ARCA] CAE recuperado tras timeout", {
            negocioId: entrada.negocioId,
            tipo: entrada.tipo,
            numero: solicitud.numero,
          });
          return {
            tipo: entrada.tipo,
            puntoVenta: entrada.puntoVenta,
            numero: solicitud.numero,
            cae: recuperada.cae,
            caeVencimiento: recuperada.caeVencimiento,
            fechaComprobante: fechaArcaAIso(solicitud.fecha)!,
            desglose,
            iva: desglose.iva,
            observaciones: [],
            ambiente: entrada.ambiente,
            recuperada: true,
          };
        }
        throw new ErrorEmision("WSFE", mensajeWsfe(e), e);
      }

      // Caso 2: otra caja se llevó el número. Una vez, con el número fresco.
      if (
        e instanceof ErrorWsfe &&
        intento === 1 &&
        e.errores.some((x) => x.codigo === CODIGO_NUMERO_DESFASADO)
      ) {
        try {
          ultimo = await consultarUltimo();
        } catch (e2) {
          throw new ErrorEmision("WSFE", mensajeWsfe(e2), e2);
        }
        continue;
      }

      throw new ErrorEmision("WSFE", mensajeWsfe(e), e);
    }
  }

  throw new ErrorEmision(
    "INCONSISTENTE",
    "ARCA rechazó el número dos veces seguidas. Reintentá la venta.",
  );
}

async function intentarRecuperar(
  entrada: EntradaEmision,
  auth: { ticket: { token: string; sign: string; expiraEn: string }; cuit: string },
  cbteTipo: number,
  numero: number,
  esperado: { impTotal: number; fecha: string; docNro: string },
): Promise<{ cae: string; caeVencimiento: string } | null> {
  try {
    const ultimoAhora = await feCompUltimoAutorizado(
      entrada.ambiente,
      auth,
      entrada.puntoVenta,
      cbteTipo,
    );
    if (ultimoAhora < numero) return null;

    const c = await feCompConsultar(
      entrada.ambiente,
      auth,
      entrada.puntoVenta,
      cbteTipo,
      numero,
    );
    if (!c || c.resultado !== "A" || !c.cae || !c.caeVencimiento) return null;

    const coincide =
      Math.abs(c.impTotal - esperado.impTotal) < 0.005 &&
      c.fecha === fechaArcaAIso(esperado.fecha) &&
      c.docNro.replaceAll(/\D/g, "") === esperado.docNro.replaceAll(/\D/g, "");

    if (!coincide) {
      // Hay un comprobante con nuestro número que NO es el nuestro: lo pidió
      // otra caja en el medio. No se toca; el que llama reintenta y este
      // log es lo que explica el hueco si alguien lo busca.
      console.error("[ARCA] Comprobante con el número esperado pero otros datos", {
        negocioId: entrada.negocioId,
        numero,
        esperado,
        encontrado: c,
      });
      return null;
    }

    return { cae: c.cae, caeVencimiento: c.caeVencimiento };
  } catch (e) {
    console.error("[ARCA] No se pudo verificar si el CAE quedó emitido", {
      negocioId: entrada.negocioId,
      numero,
      error: e,
    });
    return null;
  }
}

function mensajeWsfe(e: unknown): string {
  if (e instanceof ErrorWsfe) {
    if (e.codigo === "RED") {
      return "ARCA no responde. Reintentá en unos segundos; si sigue así, la venta se puede registrar con ticket interno.";
    }
    return `ARCA respondió con error: ${e.message}`;
  }
  return (e as Error).message;
}
