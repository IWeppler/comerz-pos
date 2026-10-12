import { createHash, randomBytes } from "node:crypto";

/**
 * OAuth de Mercado Pago: la parte PURA (sin red ni base).
 *
 * Flujo verificado en la documentación oficial el 12/10/2026
 * (docs/pagos-auditoria.md §4.1):
 *   - autorización en `auth.mercadopago.com/authorization` con `client_id`,
 *     `response_type=code`, `platform_id=mp`, `state` y `redirect_uri`;
 *   - PKCE con S256 (verifier de 43 a 128 caracteres);
 *   - el token dura 180 días (`expires_in: 15552000`) y CADA renovación
 *     devuelve un refresh_token nuevo que reemplaza al anterior.
 *
 * El `state` ata la vuelta de MP al comercio y al usuario que tocaron
 * "Conectar": se guarda HASHEADO (sha256) en `mercadopago_oauth_estados`, se
 * consume una sola vez y vence a los 10 minutos.
 */

export const MP_URL_AUTORIZACION = "https://auth.mercadopago.com/authorization";
export const MP_URL_TOKEN = "https://api.mercadopago.com/oauth/token";

/** Cuánto vive un `state` sin usarse. */
export const VIDA_STATE_MS = 10 * 60 * 1000;

/** Con menos que esto de vida, el token se renueva antes de usarlo. */
export const MARGEN_RENOVACION_MS = 30 * 24 * 60 * 60 * 1000;

const base64url = (buffer: Buffer): string =>
  buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function codeChallengeS256(codeVerifier: string): string {
  return base64url(createHash("sha256").update(codeVerifier, "ascii").digest());
}

export interface InicioOAuth {
  state: string;
  stateHash: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function generarInicioOAuth(): InicioOAuth {
  const state = base64url(randomBytes(32));
  // 48 bytes en base64url = 64 caracteres: dentro del 43–128 que pide PKCE.
  const codeVerifier = base64url(randomBytes(48));
  return {
    state,
    stateHash: hashState(state),
    codeVerifier,
    codeChallenge: codeChallengeS256(codeVerifier),
  };
}

export function urlAutorizacion({
  clientId,
  redirectUri,
  state,
  codeChallenge,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${MP_URL_AUTORIZACION}?${params.toString()}`;
}

export interface TokensMercadoPago {
  accessToken: string;
  refreshToken: string;
  mpUserId: string;
  expiraEn: Date;
}

/**
 * Lee la respuesta de `/oauth/token`. Devuelve null si falta algo: un token
 * sin refresh o sin usuario no sirve para guardarse, y guardar "lo que vino"
 * dejaría una conexión que parece andar y no renueva.
 */
export function interpretarRespuestaToken(
  json: unknown,
  ahora: Date,
): TokensMercadoPago | null {
  if (!json || typeof json !== "object") return null;
  const r = json as Record<string, unknown>;
  const accessToken = typeof r.access_token === "string" ? r.access_token : "";
  const refreshToken = typeof r.refresh_token === "string" ? r.refresh_token : "";
  const userId = r.user_id;
  const expiresIn = Number(r.expires_in);
  if (!accessToken || !refreshToken) return null;
  if (userId === null || userId === undefined || String(userId).trim() === "") return null;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return {
    accessToken,
    refreshToken,
    mpUserId: String(userId),
    expiraEn: new Date(ahora.getTime() + expiresIn * 1000),
  };
}

export function necesitaRenovar(expiraEn: Date, ahora: Date): boolean {
  return expiraEn.getTime() - ahora.getTime() < MARGEN_RENOVACION_MS;
}
