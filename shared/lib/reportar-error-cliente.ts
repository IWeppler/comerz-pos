/**
 * Reporte de errores de CLIENTE al log de Vercel.
 *
 * Contexto: los crasheos que reportaron las vendedoras durante la carga de
 * productos no dejaban rastro en ningún lado. La PWA instalada mostraba "This
 * page couldn't load" y Vercel no tenía un solo log, porque el request nunca
 * llegó al servidor: se moría el proceso del navegador. `instrumentation.ts`
 * es solo de servidor y no ve nada de esto.
 *
 * Esto manda el error a un route handler que lo escribe en el log de la
 * función, así aparece en Vercel junto al resto. Sin tabla nueva a propósito:
 * una tabla implicaría una migración y aplicarla en las 3 bases, y el log
 * alcanza para diagnosticar.
 */

export type TipoEventoCliente =
  | "error"
  | "unhandledrejection"
  | "react-error-boundary"
  | "posible-crash-renderer"
  // Un POST a una Server Action que se acerca al tope de la plataforma. No es
  // un error todavía: es el aviso de que va camino a serlo (ver
  // `tamano-payload.ts`).
  | "payload-grande"
  // El cliente de browser recibió un 401 de PostgREST o un refresh rechazado
  // y se fue solo a /auth/salir (ver `sesion-muerta-cliente.ts`). No es un
  // error del sistema: es la PWA con una sesión que otra ventana cerró.
  | "sesion-muerta";

export type EventoErrorCliente = {
  tipo: TipoEventoCliente;
  mensaje: string;
  stack?: string;
  url: string;
  /** Standalone = PWA instalada. Es donde aparecía el cartel de error. */
  standalone: boolean;
  userAgent: string;
  /** Memoria del dispositivo en GB, si el navegador la expone. Sirve para
   * confirmar o descartar la hipótesis de que el crash es por memoria. */
  memoriaGb?: number;
  /** Contexto extra del flujo que estaba corriendo (ej. cuántas imágenes). */
  detalle?: Record<string, unknown>;
};

type NavigatorConMemoria = Navigator & { deviceMemory?: number };

export function reportarErrorCliente(
  evento: Omit<EventoErrorCliente, "url" | "standalone" | "userAgent" | "memoriaGb">,
): void {
  if (typeof window === "undefined") return;

  try {
    const payload: EventoErrorCliente = {
      ...evento,
      url: window.location.href,
      standalone:
        window.matchMedia?.("(display-mode: standalone)").matches ?? false,
      userAgent: navigator.userAgent,
      memoriaGb: (navigator as NavigatorConMemoria).deviceMemory,
    };

    const body = JSON.stringify(payload);

    // sendBeacon sobrevive a que la página se esté descargando, que es
    // justamente cuando pasan estas cosas. Si no está disponible, fetch con
    // keepalive hace lo mismo.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/client-error",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }

    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Reportar el error no puede romper más que el error original.
    });
  } catch {
    // Idem.
  }
}
