import { URLS_ARCA, fechaArcaAIso, type AmbienteArca } from "./codigos-arca";
import { describirErrorRed } from "./error-red";
import type { SolicitudCae } from "./armar-factura";
import type { TicketAcceso } from "./wsaa";
import { escaparXml, leerEtiqueta, leerEtiquetas, sobreSoap } from "./xml";

/**
 * WSFEv1: factura electrónica. Cuatro operaciones y nada más:
 *
 *   FEDummy                 ¿están vivos los servidores? (probar conexión)
 *   FECompUltimoAutorizado  último número autorizado por punto de venta y tipo
 *   FECAESolicitar          pedir el CAE de UN comprobante
 *   FECompConsultar         leer un comprobante ya autorizado
 *
 * La numeración fiscal la manda ARCA, no `comprobante_numeracion`: el número
 * a pedir es SIEMPRE `FECompUltimoAutorizado + 1`. Pedir otro es error 10016.
 *
 * ARCA distingue tres desenlaces y hay que respetarlos: `A` aprobado (CAE),
 * `R` rechazado (con `Observaciones`), y errores de la llamada (`Errors`, el
 * request ni se procesó). Un `A` puede venir CON observaciones — ARCA avisó
 * algo pero autorizó igual — y esas se guardan porque el contador las va a
 * querer ver.
 */

const NS = "http://ar.gov.afip.dif.FEV1/";
const TIMEOUT_MS = 25_000;

export interface AuthWsfe {
  ticket: TicketAcceso;
  cuit: string;
}

export interface ErrorArca {
  codigo: number;
  mensaje: string;
}

export class ErrorWsfe extends Error {
  constructor(
    public readonly codigo: "ERRORES" | "FAULT" | "HTTP" | "RESPUESTA_INVALIDA" | "RED",
    mensaje: string,
    public readonly errores: ErrorArca[] = [],
  ) {
    super(mensaje);
    this.name = "ErrorWsfe";
  }
}

export interface ResultadoCae {
  resultado: "A" | "R";
  cae: string | null;
  /** yyyy-mm-dd */
  caeVencimiento: string | null;
  numero: number;
  observaciones: ErrorArca[];
}

export interface ComprobanteConsultado {
  resultado: string;
  cae: string | null;
  caeVencimiento: string | null;
  impTotal: number;
  /** yyyy-mm-dd */
  fecha: string | null;
  docTipo: number;
  docNro: string;
}

const monto = (n: number) => n.toFixed(2);

function xmlAuth(auth: AuthWsfe): string {
  return (
    `<Auth><Token>${escaparXml(auth.ticket.token)}</Token>` +
    `<Sign>${escaparXml(auth.ticket.sign)}</Sign>` +
    `<Cuit>${escaparXml(auth.cuit)}</Cuit></Auth>`
  );
}

function leerErrores(xml: string, tag: string): ErrorArca[] {
  return leerEtiquetas(xml, tag).map((bloque) => ({
    codigo: Number(leerEtiqueta(bloque, "Code") ?? 0),
    mensaje: leerEtiqueta(bloque, "Msg") ?? "",
  }));
}

async function llamar(
  ambiente: AmbienteArca,
  operacion: string,
  cuerpoInterno: string,
): Promise<string> {
  const cuerpo = sobreSoap(
    `<${operacion} xmlns="${NS}">${cuerpoInterno}</${operacion}>`,
  );

  let respuesta: Response;
  try {
    respuesta = await fetch(URLS_ARCA[ambiente].wsfe, {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ErrorWsfe(
      "RED",
      `No se pudo conectar con WSFE (${ambiente}): ${describirErrorRed(e)}`,
    );
  }

  const texto = await respuesta.text();

  const fault =
    leerEtiqueta(texto, "faultstring") ?? leerEtiqueta(texto, "Text");
  if (!respuesta.ok) {
    throw new ErrorWsfe(
      fault ? "FAULT" : "HTTP",
      fault ?? `WSFE respondió HTTP ${respuesta.status}.`,
    );
  }

  // `Errors` a nivel respuesta: la llamada no se procesó. Distinto de un
  // rechazo, que viene como Resultado=R con Observaciones.
  const errores = leerErrores(leerEtiqueta(texto, "Errors") ?? "", "Err");
  if (errores.length > 0) {
    throw new ErrorWsfe(
      "ERRORES",
      errores.map((e) => `${e.codigo}: ${e.mensaje}`).join(" | "),
      errores,
    );
  }

  return texto;
}

export async function feDummy(
  ambiente: AmbienteArca,
): Promise<{ appServer: string; dbServer: string; authServer: string }> {
  const xml = await llamar(ambiente, "FEDummy", "");
  return {
    appServer: leerEtiqueta(xml, "AppServer") ?? "?",
    dbServer: leerEtiqueta(xml, "DbServer") ?? "?",
    authServer: leerEtiqueta(xml, "AuthServer") ?? "?",
  };
}

export async function feCompUltimoAutorizado(
  ambiente: AmbienteArca,
  auth: AuthWsfe,
  puntoVenta: number,
  cbteTipo: number,
): Promise<number> {
  const xml = await llamar(
    ambiente,
    "FECompUltimoAutorizado",
    `${xmlAuth(auth)}<PtoVta>${puntoVenta}</PtoVta><CbteTipo>${cbteTipo}</CbteTipo>`,
  );
  const nro = leerEtiqueta(xml, "CbteNro");
  if (nro == null || Number.isNaN(Number(nro))) {
    throw new ErrorWsfe(
      "RESPUESTA_INVALIDA",
      "FECompUltimoAutorizado respondió sin número.",
    );
  }
  return Number(nro);
}

/** El detalle en el orden del XSD: ARCA rechaza el request si se desordena. */
function xmlDetalle(s: SolicitudCae): string {
  const asociados =
    s.comprobantesAsociados.length > 0
      ? `<CbtesAsoc>${s.comprobantesAsociados
          .map(
            (c) =>
              `<CbteAsoc><Tipo>${c.tipo}</Tipo><PtoVta>${c.puntoVenta}</PtoVta>` +
              `<Nro>${c.numero}</Nro><CbteFch>${c.fecha}</CbteFch></CbteAsoc>`,
          )
          .join("")}</CbtesAsoc>`
      : "";

  // Sin IVA (Factura C) el bloque se OMITE entero: mandarlo vacío es error.
  const iva =
    s.iva.length > 0
      ? `<Iva>${s.iva
          .map(
            (a) =>
              `<AlicIva><Id>${a.id}</Id><BaseImp>${monto(a.baseImponible)}</BaseImp>` +
              `<Importe>${monto(a.importe)}</Importe></AlicIva>`,
          )
          .join("")}</Iva>`
      : "";

  return (
    `<FECAEDetRequest>` +
    `<Concepto>${s.concepto}</Concepto>` +
    `<DocTipo>${s.docTipo}</DocTipo>` +
    `<DocNro>${escaparXml(s.docNro)}</DocNro>` +
    `<CbteDesde>${s.numero}</CbteDesde>` +
    `<CbteHasta>${s.numero}</CbteHasta>` +
    `<CbteFch>${s.fecha}</CbteFch>` +
    `<ImpTotal>${monto(s.impTotal)}</ImpTotal>` +
    `<ImpTotConc>${monto(s.impTotConc)}</ImpTotConc>` +
    `<ImpNeto>${monto(s.impNeto)}</ImpNeto>` +
    `<ImpOpEx>${monto(s.impOpEx)}</ImpOpEx>` +
    `<ImpTrib>${monto(s.impTrib)}</ImpTrib>` +
    `<ImpIVA>${monto(s.impIva)}</ImpIVA>` +
    `<MonId>${s.moneda}</MonId>` +
    `<MonCotiz>${s.cotizacion}</MonCotiz>` +
    `<CondicionIVAReceptorId>${s.condicionIvaReceptorId}</CondicionIVAReceptorId>` +
    asociados +
    iva +
    `</FECAEDetRequest>`
  );
}

export async function feCaeSolicitar(
  ambiente: AmbienteArca,
  auth: AuthWsfe,
  solicitud: SolicitudCae,
): Promise<ResultadoCae> {
  const xml = await llamar(
    ambiente,
    "FECAESolicitar",
    `${xmlAuth(auth)}<FeCAEReq>` +
      `<FeCabReq><CantReg>1</CantReg><PtoVta>${solicitud.puntoVenta}</PtoVta>` +
      `<CbteTipo>${solicitud.cbteTipo}</CbteTipo></FeCabReq>` +
      `<FeDetReq>${xmlDetalle(solicitud)}</FeDetReq>` +
      `</FeCAEReq>`,
  );

  const detalle = leerEtiqueta(xml, "FECAEDetResponse");
  if (!detalle) {
    throw new ErrorWsfe(
      "RESPUESTA_INVALIDA",
      "FECAESolicitar respondió sin detalle.",
    );
  }

  const resultado = leerEtiqueta(detalle, "Resultado");
  if (resultado !== "A" && resultado !== "R") {
    throw new ErrorWsfe(
      "RESPUESTA_INVALIDA",
      `FECAESolicitar respondió Resultado=${resultado ?? "vacío"}.`,
    );
  }

  const cae = leerEtiqueta(detalle, "CAE") || null;
  const vto = leerEtiqueta(detalle, "CAEFchVto");

  return {
    resultado,
    cae: resultado === "A" ? cae : null,
    caeVencimiento: vto ? fechaArcaAIso(vto) : null,
    numero: Number(leerEtiqueta(detalle, "CbteDesde") ?? solicitud.numero),
    observaciones: leerErrores(
      leerEtiqueta(detalle, "Observaciones") ?? "",
      "Obs",
    ),
  };
}

export async function feCompConsultar(
  ambiente: AmbienteArca,
  auth: AuthWsfe,
  puntoVenta: number,
  cbteTipo: number,
  numero: number,
): Promise<ComprobanteConsultado | null> {
  let xml: string;
  try {
    xml = await llamar(
      ambiente,
      "FECompConsultar",
      `${xmlAuth(auth)}<FeCompConsReq><CbteTipo>${cbteTipo}</CbteTipo>` +
        `<CbteNro>${numero}</CbteNro><PtoVta>${puntoVenta}</PtoVta></FeCompConsReq>`,
    );
  } catch (e) {
    // 602: "No existen datos en nuestros registros para los parametros
    // ingresados". Es una respuesta, no una rotura.
    if (e instanceof ErrorWsfe && e.errores.some((x) => x.codigo === 602)) {
      return null;
    }
    throw e;
  }

  const r = leerEtiqueta(xml, "ResultGet");
  if (!r) return null;

  const fecha = leerEtiqueta(r, "CbteFch");
  const vto = leerEtiqueta(r, "FchVto");
  return {
    resultado: leerEtiqueta(r, "Resultado") ?? "",
    cae: leerEtiqueta(r, "CodAutorizacion") || null,
    caeVencimiento: vto ? fechaArcaAIso(vto) : null,
    impTotal: Number(leerEtiqueta(r, "ImpTotal") ?? 0),
    fecha: fecha ? fechaArcaAIso(fecha) : null,
    docTipo: Number(leerEtiqueta(r, "DocTipo") ?? 0),
    docNro: leerEtiqueta(r, "DocNro") ?? "",
  };
}
