import forge from "node-forge";
import { describirErrorRed } from "./error-red";
import { SERVICIO_WSFE, URLS_ARCA, type AmbienteArca } from "./codigos-arca";
import { escaparXml, leerEtiqueta } from "./xml";

/**
 * WSAA: el servicio de autenticación de ARCA.
 *
 * Cómo funciona, en tres pasos: se arma un TRA (un XML chico con el servicio
 * que se quiere usar y una ventana de validez), se lo firma como CMS/PKCS#7
 * con el certificado del comercio, y se lo manda a `loginCms`. ARCA devuelve
 * un Ticket de Acceso (TA) —token + sign— que dura 12 horas y que va en cada
 * llamada a WSFE.
 *
 * Dos cosas que hay que saber y que no están en el manual:
 *
 * - **Un TA vigente no se puede volver a pedir.** Si se llama a loginCms con
 *   uno vivo, ARCA responde el fault `coe.alreadyAuthenticated`. Por eso el
 *   TA se cachea en la base (ver credenciales.ts) y esto se llama SOLO cuando
 *   venció. Sin ese cache, dos ventas seguidas fallarían la segunda.
 *
 * - **El reloj importa.** `generationTime` no puede estar en el futuro
 *   respecto del de ARCA. Se retrocede 10 minutos a propósito; la ventana
 *   sigue siendo cómoda porque `expirationTime` va 10 minutos adelante.
 */

export interface TicketAcceso {
  token: string;
  sign: string;
  /** ISO. Lo dice ARCA; no se calcula acá. */
  expiraEn: string;
}

export class ErrorWsaa extends Error {
  constructor(
    public readonly codigo: "FAULT" | "HTTP" | "RESPUESTA_INVALIDA" | "RED",
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorWsaa";
  }
}

const TIMEOUT_MS = 20_000;

function armarTra(servicio: string, ahora: Date): string {
  const generacion = new Date(ahora.getTime() - 10 * 60 * 1000);
  const expiracion = new Date(ahora.getTime() + 10 * 60 * 1000);
  // uniqueId es un entero de 32 bits: los segundos del epoch entran.
  const uniqueId = Math.floor(ahora.getTime() / 1000);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generacion.toISOString()}</generationTime>` +
    `<expirationTime>${expiracion.toISOString()}</expirationTime>` +
    `</header>` +
    `<service>${escaparXml(servicio)}</service>` +
    `</loginTicketRequest>`
  );
}

/** Firma el TRA como CMS (SignedData, DER) y lo devuelve en base64. */
export function firmarTra(
  tra: string,
  clavePrivadaPem: string,
  certificadoPem: string,
): string {
  const clave = forge.pki.privateKeyFromPem(clavePrivadaPem);
  const certificado = forge.pki.certificateFromPem(certificadoPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(certificado);
  p7.addSigner({
    key: clave,
    certificate: certificado,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // Sin `value`: forge pone la hora actual.
      { type: forge.pki.oids.signingTime },
    ],
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

/**
 * Pide un TA nuevo a ARCA. NO mira el cache: eso es responsabilidad de quien
 * llama (credenciales.ts), que sabe si el vigente venció.
 */
export async function pedirTicketAcceso(
  ambiente: AmbienteArca,
  clavePrivadaPem: string,
  certificadoPem: string,
  ahora: Date = new Date(),
): Promise<TicketAcceso> {
  const tra = armarTra(SERVICIO_WSFE, ahora);
  const cms = firmarTra(tra, clavePrivadaPem, certificadoPem);

  // WSAA habla SOAP 1.1 (a diferencia de WSFE, que acepta 1.2).
  const cuerpo =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body>` +
    `</soapenv:Envelope>`;

  let respuesta: Response;
  try {
    respuesta = await fetch(URLS_ARCA[ambiente].wsaa, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ErrorWsaa(
      "RED",
      `No se pudo conectar con WSAA (${ambiente}): ${describirErrorRed(e)}`,
    );
  }

  const texto = await respuesta.text();

  // Un fault viene con HTTP 500 y `<faultstring>`; se lee antes que el
  // status porque el mensaje de ARCA es más útil que "500".
  const fault = leerEtiqueta(texto, "faultstring");
  if (fault) {
    throw new ErrorWsaa("FAULT", fault);
  }
  if (!respuesta.ok) {
    throw new ErrorWsaa("HTTP", `WSAA respondió HTTP ${respuesta.status}.`);
  }

  // loginCmsReturn trae el XML del TA ESCAPADO adentro del SOAP;
  // leerEtiqueta ya lo desescapa.
  const ta = leerEtiqueta(texto, "loginCmsReturn") ?? "";
  const token = leerEtiqueta(ta, "token");
  const sign = leerEtiqueta(ta, "sign");
  const expiraEn = leerEtiqueta(ta, "expirationTime");

  if (!token || !sign || !expiraEn) {
    throw new ErrorWsaa(
      "RESPUESTA_INVALIDA",
      "WSAA respondió sin token, sign o vencimiento.",
    );
  }

  return { token, sign, expiraEn: new Date(expiraEn).toISOString() };
}
