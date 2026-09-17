import https from "node:https";

/**
 * POST de un sobre SOAP a ARCA, con la capa TLS que sus servidores exigen.
 *
 * Por qué no es un `fetch` a secas: `servicios1.afip.gov.ar` (WSFE de
 * producción) prefiere el intercambio de claves DHE con un grupo de **1024
 * bits**, y OpenSSL 3 —el de Node en Vercel— lo rechaza en su nivel de
 * seguridad por defecto: `ERR_SSL_DH_KEY_TOO_SMALL`. Medido el 16/9/2026:
 * la prueba de conexión fallaba en FEDummy, antes de mandar un solo byte
 * firmado. Desde una máquina con otra build de OpenSSL conectaba, lo que lo
 * hacía parecer un bloqueo de red y no lo era.
 *
 * La salida NO es bajar el nivel de seguridad (`@SECLEVEL=1`): eso acepta el
 * DH chico. Es no ofrecer DHE, y el servidor elige otra cosa: ECDHE con
 * P-256 en `wsaa`, `wsaahomo` y `wswhomo`, y RSA-AES256-GCM en `servicios1`,
 * que no tiene PFS pero es lo que ese servidor sabe hacer sin DH. Verificado
 * con `openssl s_client -cipher` contra los cuatro hosts.
 *
 * Va por `node:https` y no por `fetch` con un dispatcher de undici porque
 * el `fetch` del server lo envuelve Next, y no está garantizado que le pase
 * opciones de conexión. Un agente propio por proceso: se reusa la conexión
 * entre llamadas (WSAA + WSFE en una misma venta) y no toca el TLS del resto
 * de la app.
 */
const AGENTE_ARCA = new https.Agent({
  keepAlive: true,
  ciphers: "ECDHE+AESGCM:ECDHE+AES:AESGCM:AES:!DH:!aNULL:!MD5",
  minVersion: "TLSv1.2",
});

export interface RespuestaHttp {
  ok: boolean;
  status: number;
  text: string;
}

/**
 * Lanza en fallo de red con `code` de Node (ECONNRESET, ENOTFOUND,
 * ERR_SSL_...) o un `TimeoutError`, que es lo que `describirErrorRed` lee.
 */
export function postXml(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<RespuestaHttp> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        agent: AGENTE_ARCA,
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (chunk: Buffer) => partes.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: Buffer.concat(partes).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(timeoutMs, () => {
      const e = new Error(`Sin respuesta en ${timeoutMs} ms`);
      e.name = "TimeoutError";
      req.destroy(e);
    });
    req.on("error", reject);
    req.end(body);
  });
}
