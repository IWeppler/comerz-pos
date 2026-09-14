import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado de la clave privada del certificado de ARCA antes de guardarla.
 *
 * La clave privada es lo que permite facturar A NOMBRE DEL COMERCIO. Se
 * guarda en la base (una por negocio y ambiente, en `arca_credenciales`)
 * porque es lo único que sobrevive a un redeploy y escala a N negocios, pero
 * NUNCA en claro: un dump de la tabla no tiene que servir para firmar nada.
 *
 * AES-256-GCM con una clave maestra que vive SOLO en el server
 * (`ARCA_CLAVE_CIFRADO`, 32 bytes en base64). El IV es aleatorio por fila y
 * viaja adelante del texto; el tag de autenticación va al final. Formato:
 * `v1:<iv b64>:<tag b64>:<cifrado b64>`. La `v1` está para poder rotar el
 * esquema sin adivinar qué formato tiene cada fila.
 *
 * Sin la env var no se puede ni guardar ni leer credenciales, y el error lo
 * dice: fallar en claro es mejor que caer a un default que cualquiera conoce.
 */

const ALGORITMO = "aes-256-gcm";
const VERSION = "v1";

export function claveMaestraConfigurada(): boolean {
  return leerClaveMaestra() !== null;
}

function leerClaveMaestra(): Buffer | null {
  const cruda = process.env.ARCA_CLAVE_CIFRADO;
  if (!cruda) return null;
  const clave = Buffer.from(cruda, "base64");
  return clave.length === 32 ? clave : null;
}

function exigirClave(): Buffer {
  const clave = leerClaveMaestra();
  if (!clave) {
    throw new Error(
      "Falta ARCA_CLAVE_CIFRADO (32 bytes en base64): no se pueden guardar ni leer credenciales de ARCA.",
    );
  }
  return clave;
}

export function cifrar(textoPlano: string): string {
  const clave = exigirClave();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITMO, clave, iv);
  const cifrado = Buffer.concat([
    cipher.update(textoPlano, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    cifrado.toString("base64"),
  ].join(":");
}

export function descifrar(guardado: string): string {
  const clave = exigirClave();
  const [version, ivB64, tagB64, cifradoB64] = guardado.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !cifradoB64) {
    throw new Error("Credencial de ARCA con formato desconocido.");
  }
  const decipher = createDecipheriv(ALGORITMO, clave, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(cifradoB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Para generar la env var una sola vez: `node -e "..."` o desde un script. */
export function generarClaveMaestra(): string {
  return randomBytes(32).toString("base64");
}
