/**
 * Continuar con Google.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ, EN UNA LÍNEA: elimina el salto de dispositivo.
 *
 * No es "un botón más de login". El alta con mail tiene un punto donde la
 * persona se va del navegador —abre la casilla, muchas veces en otro
 * aparato— y ahí se perdieron 6 de las 10 cuentas sin negocio medidas el
 * 9/9/2026. Google no tiene ese punto: no hay link que abrir, y el mail viene
 * verificado por Google.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL RIESGO QUE HAY QUE CONOCER ANTES DE PRENDERLO
 *
 * Supabase VINCULA identidades cuando el mail coincide y viene verificado del
 * proveedor. Eso normalmente es lo que uno quiere: la misma persona entra con
 * password o con Google y cae en la misma cuenta.
 *
 * Pero el 9/9/2026 se apagó "Confirm email" para sacar el mail del camino
 * crítico, y eso cambia el cuadro: ahora CUALQUIERA puede registrarse con un
 * mail que no es suyo y esa cuenta queda con `email_confirmed_at` puesto sin
 * que nadie lo haya probado. Si después el dueño real del mail entra con
 * Google, cae en esa cuenta — y el que la creó ya tiene la contraseña.
 *
 * Las dos decisiones por separado son razonables; juntas abren esto. No es
 * teórico y no lo arregla este archivo: la salida es una de estas dos, y hay
 * que elegir antes de prender el flag en producción.
 *
 *   a) Volver a exigir confirmación SOLO para el alta con password, dejando
 *      Google como el camino sin fricción. Es lo mejor de los dos mundos y
 *      hoy no se puede hacer desde el dashboard: "Confirm email" es global.
 *   b) Prenderlo igual, aceptando el riesgo mientras el volumen sea de una
 *      decena de altas por mes y todas conocidas. Con el embudo instrumentado,
 *      un alta con un mail ajeno se ve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EL FLAG. Default APAGADO, y solo el literal "on" lo prende: cualquier otro
 * valor —vacío, "true", "1", un typo— deja el botón invisible. Fail-closed,
 * mismo criterio que `normalizarAmbiente` de ARCA.
 *
 * Vive en una env var y no en una constante del código porque prenderlo
 * depende de algo que NO está en el repo: las credenciales de OAuth cargadas
 * en el dashboard de Supabase. Con el flag prendido y el proveedor sin
 * configurar, el botón lleva a un error de Supabase — así que el orden es
 * primero configurar, después prender.
 */
export const GOOGLE_AUTH_HABILITADO =
  process.env.NEXT_PUBLIC_GOOGLE_AUTH === "on";

/**
 * A dónde vuelve Google después de autenticar.
 *
 * Va al MISMO `/auth/callback` que el mail: el flujo de OAuth también aterriza
 * con un `code` de PKCE que hay que canjear, y ese handler ya es idempotente
 * —lo aprendió a los golpes el 9/9/2026, ver el comentario de su archivo—.
 *
 * `next` decide dónde sigue. Desde el alta va a `/onboarding`, que detecta la
 * sesión y arranca en el paso 2; desde el login va a `/`, y de ahí lo acomoda
 * el middleware según tenga negocio o no.
 */
export function urlDeRetornoGoogle(base: string, next: string): string {
  return `${base}/auth/callback?next=${encodeURIComponent(next)}`;
}
