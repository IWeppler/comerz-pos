/**
 * Una sonda al servidor para clasificar un server action que volvió roto.
 *
 * El error de Next "An unexpected response was received from the server" es
 * uno solo para tres causas que se arreglan distinto: la sesión murió (hay
 * que volver a entrar), la red se cortó (esperar) o el servidor contestó una
 * página de error (mirar Vercel). Se pide la MISMA ruta con `HEAD` y sin
 * seguir redirecciones: el middleware sin sesión responde 307 al login, que
 * con `redirect: "manual"` llega como `opaqueredirect` con status 0 — eso, y
 * solo eso, es "no hay sesión". Con sesión llega 200; un 5xx es el servidor;
 * y si el fetch tira, es la red.
 *
 * Es diagnóstico, no control de flujo: corre después del error, una vez, y su
 * resultado se manda al log junto con el error. No decide nada: `sinSesion`
 * puede ser también un redirect a /seleccionar-negocio o el de un VENDEDOR
 * en `/`, así que sirve para leer el log, no para cerrar sesión.
 */
export type SondaServidor = {
  online: boolean;
  visibilidad: DocumentVisibilityState;
  segundosDesdeCarga: number;
  /** `status` del HEAD; 0 si fue una redirección no seguida. */
  status: number | null;
  redirigida: boolean;
  /** No pudo ni salir: red caída o el proceso descargándose. */
  fallaDeRed: boolean;
  /** Redirigida sin sesión: el middleware mandó al login. */
  sinSesion: boolean;
};

export function clasificarSonda(
  respuesta: { status: number; type: ResponseType } | null,
  contexto: {
    online: boolean;
    visibilidad: DocumentVisibilityState;
    segundosDesdeCarga: number;
  },
): SondaServidor {
  if (!respuesta) {
    return {
      ...contexto,
      status: null,
      redirigida: false,
      fallaDeRed: true,
      sinSesion: false,
    };
  }
  const redirigida = respuesta.type === "opaqueredirect";
  return {
    ...contexto,
    status: respuesta.status,
    redirigida,
    fallaDeRed: false,
    sinSesion: redirigida,
  };
}

export async function sondearServidor(): Promise<SondaServidor> {
  const contexto = {
    online: navigator.onLine,
    visibilidad: document.visibilityState,
    segundosDesdeCarga: Math.round(performance.now() / 1000),
  };
  try {
    const respuesta = await fetch(window.location.pathname, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      credentials: "same-origin",
    });
    return clasificarSonda(respuesta, contexto);
  } catch {
    return clasificarSonda(null, contexto);
  }
}
