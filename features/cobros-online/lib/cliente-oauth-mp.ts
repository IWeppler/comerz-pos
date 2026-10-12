import "server-only";
import { urlDelPanel } from "@/shared/lib/ruteo-host";
import type { ClienteOAuthMp, ErrorOAuthMp } from "./conexion-mercadopago";
import { MP_URL_TOKEN, interpretarRespuestaToken } from "./oauth-mercadopago";

/**
 * La configuración de la app de Comerz en Mercado Pago Developers.
 *
 * `MP_REDIRECT_URI` tiene que ser EXACTAMENTE la registrada en la app (MP la
 * compara al canjear el código). Sin la env var se usa la del panel
 * (`https://app.comerz.app/api/mercadopago/oauth/callback`), que es la de
 * producción; en previews y local hay que ponerla a mano.
 */
export interface ConfigAppMp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function leerConfigAppMp(): ConfigAppMp | null {
  const clientId = process.env.MP_CLIENT_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.MP_CLAVE_CIFRADO) return null;
  return {
    clientId,
    clientSecret,
    redirectUri:
      process.env.MP_REDIRECT_URI || urlDelPanel("/api/mercadopago/oauth/callback"),
  };
}

const TIMEOUT_MS = 10_000;

/** POST a /oauth/token. Nunca loguea el cuerpo (trae tokens o el secret). */
async function pedirToken(
  config: ConfigAppMp,
  cuerpo: Record<string, string>,
): Promise<{ ok: true; json: unknown } | { ok: false; error: ErrorOAuthMp }> {
  let respuesta: Response;
  try {
    respuesta = await fetch(MP_URL_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...cuerpo,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "RED" };
  }

  const json = await respuesta.json().catch(() => null);
  if (respuesta.ok) return { ok: true, json };
  if (respuesta.status >= 500 || respuesta.status === 429) return { ok: false, error: "RED" };

  const codigo = (json as { error?: string } | null)?.error ?? "";
  console.error(`[MP OAUTH] /oauth/token respondió ${respuesta.status} (${codigo || "sin código"})`);
  return { ok: false, error: codigo === "invalid_grant" ? "INVALID_GRANT" : "RECHAZADO" };
}

export function crearClienteOAuthMp(config: ConfigAppMp): ClienteOAuthMp {
  return {
    async intercambiarCodigo(code, codeVerifier) {
      const r = await pedirToken(config, {
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        code_verifier: codeVerifier,
      });
      if (!r.ok) return r;
      const tokens = interpretarRespuestaToken(r.json, new Date());
      return tokens ? { ok: true, tokens } : { ok: false, error: "RECHAZADO" };
    },

    async renovar(refreshToken) {
      const r = await pedirToken(config, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      if (!r.ok) return r;
      const tokens = interpretarRespuestaToken(r.json, new Date());
      return tokens ? { ok: true, tokens } : { ok: false, error: "RECHAZADO" };
    },
  };
}
