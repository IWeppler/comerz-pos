/**
 * Texto de un error de red, CON su causa.
 *
 * "fetch failed" / "socket hang up" no distinguen un DNS caído de un
 * firewall de ARCA rechazando la IP del server ni de un error de TLS: son
 * diagnósticos opuestos con el mismo mensaje. Acá se saca el `code` de Node
 * (ECONNRESET, ENOTFOUND, ERR_SSL_...), esté en el error mismo (`node:https`)
 * o en `cause` (undici). El timeout se nombra aparte por lo mismo.
 */
export function describirErrorRed(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "TimeoutError") return "sin respuesta (timeout)";
  const propio = (e as NodeJS.ErrnoException).code;
  if (propio) return `${propio}: ${e.message}`;
  const causa = e.cause;
  if (causa instanceof Error) {
    const codigo = (causa as NodeJS.ErrnoException).code;
    return `${e.message} — ${codigo ? `${codigo}: ` : ""}${causa.message}`;
  }
  return e.message;
}
