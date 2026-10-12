import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado en reposo de secretos POR COMERCIO (la clave privada de ARCA, los
 * tokens de Mercado Pago).
 *
 * AES-256-GCM con una clave maestra que vive SOLO en el server, en una env var
 * de 32 bytes en base64. El IV es aleatorio por valor y viaja adelante del
 * texto; el tag de autenticación va al final. Formato:
 * `v1:<iv b64>:<tag b64>:<cifrado b64>`. La `v1` está para poder rotar el
 * esquema sin adivinar qué formato tiene cada fila.
 *
 * POR QUÉ EN LA APP Y NO CON VAULT: la clave no está en la base, así que un
 * dump de las tablas no descifra nada. Con Vault la clave vive del mismo lado
 * que los datos.
 *
 * Cada secreto tiene SU clave (`ARCA_CLAVE_CIFRADO`, `MP_CLAVE_CIFRADO`): que
 * se filtre una no abre la otra, y rotar una no obliga a recifrar todo.
 *
 * Sin la env var no se puede ni guardar ni leer, y el error lo dice: fallar en
 * claro es mejor que caer a un default que cualquiera conoce.
 */

const ALGORITMO = "aes-256-gcm";
const VERSION = "v1";

export interface Cifrador {
  claveConfigurada(): boolean;
  cifrar(textoPlano: string): string;
  descifrar(guardado: string): string;
}

/**
 * @param envVar nombre de la env var con la clave maestra.
 * @param que cómo se nombra el secreto en los errores ("credenciales de ARCA").
 */
export function crearCifrador(envVar: string, que: string): Cifrador {
  const leerClave = (): Buffer | null => {
    const cruda = process.env[envVar];
    if (!cruda) return null;
    const clave = Buffer.from(cruda, "base64");
    return clave.length === 32 ? clave : null;
  };

  const exigirClave = (): Buffer => {
    const clave = leerClave();
    if (!clave) {
      throw new Error(
        `Falta ${envVar} (32 bytes en base64): no se pueden guardar ni leer ${que}.`,
      );
    }
    return clave;
  };

  return {
    claveConfigurada: () => leerClave() !== null,

    cifrar(textoPlano) {
      const clave = exigirClave();
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITMO, clave, iv);
      const cifrado = Buffer.concat([cipher.update(textoPlano, "utf8"), cipher.final()]);
      return [
        VERSION,
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        cifrado.toString("base64"),
      ].join(":");
    },

    descifrar(guardado) {
      const clave = exigirClave();
      const [version, ivB64, tagB64, cifradoB64] = guardado.split(":");
      if (version !== VERSION || !ivB64 || !tagB64 || !cifradoB64) {
        throw new Error(`${que[0].toUpperCase()}${que.slice(1)} con formato desconocido.`);
      }
      const decipher = createDecipheriv(ALGORITMO, clave, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(cifradoB64, "base64")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

/** Para generar una env var una sola vez: `node -e "..."` o desde un script. */
export function generarClaveMaestra(): string {
  return randomBytes(32).toString("base64");
}
