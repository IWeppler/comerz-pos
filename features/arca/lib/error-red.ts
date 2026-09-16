/**
 * Texto de un error de red de `fetch`, CON su causa.
 *
 * undici envuelve todo fallo de conexión en un `TypeError("fetch failed")` y
 * deja el motivo real en `cause` (ECONNRESET, ENOTFOUND, un error de TLS...).
 * El panel de conexión mostraba solo el envoltorio, y "fetch failed" no
 * distingue un DNS caído de un firewall de ARCA rechazando la IP del server:
 * son diagnósticos opuestos con el mismo mensaje. El timeout de
 * `AbortSignal.timeout` llega como `TimeoutError` sin causa, y se nombra
 * aparte por lo mismo.
 */
export function describirErrorRed(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "TimeoutError") return "sin respuesta (timeout)";
  const causa = e.cause;
  if (causa instanceof Error) {
    const codigo = (causa as NodeJS.ErrnoException).code;
    return `${e.message} — ${codigo ? `${codigo}: ` : ""}${causa.message}`;
  }
  return e.message;
}
