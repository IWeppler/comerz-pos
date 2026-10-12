import { crearCifrador, generarClaveMaestra } from "@/shared/lib/cifrado";

/**
 * Cifrado de la clave privada del certificado de ARCA antes de guardarla.
 *
 * La clave privada es lo que permite facturar A NOMBRE DEL COMERCIO. Se
 * guarda en la base (una por negocio y ambiente, en `arca_credenciales`)
 * porque es lo único que sobrevive a un redeploy y escala a N negocios, pero
 * NUNCA en claro: un dump de la tabla no tiene que servir para firmar nada.
 *
 * El esquema (AES-256-GCM, formato `v1:iv:tag:cifrado`) vive en
 * `shared/lib/cifrado.ts`, compartido con los tokens de Mercado Pago. Acá solo
 * se elige la clave: `ARCA_CLAVE_CIFRADO`, propia de ARCA.
 */
const arca = crearCifrador("ARCA_CLAVE_CIFRADO", "credenciales de ARCA");

export const claveMaestraConfigurada = arca.claveConfigurada;
export const cifrar = arca.cifrar;
export const descifrar = arca.descifrar;
export { generarClaveMaestra };
