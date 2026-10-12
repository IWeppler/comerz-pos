import {
  VIDA_STATE_MS,
  generarInicioOAuth,
  hashState,
  necesitaRenovar,
  urlAutorizacion,
  type TokensMercadoPago,
} from "./oauth-mercadopago";
import type { CodigoResultadoOAuth } from "./mensajes-oauth";

/**
 * La conexión de un comercio con Mercado Pago: iniciar, completar el callback
 * y conseguir un token vigente.
 *
 * Todo con las dependencias INYECTADAS (`DepsConexion`): la base y la API de
 * MP entran por parámetro, así el callback y la renovación se prueban sin red
 * ni Supabase. La implementación real está en `repo-conexion-supabase.ts`
 * (service_role + cifrado) y `cliente-oauth-mp.ts` (fetch).
 *
 * El negocio NUNCA sale de un parámetro del navegador: al iniciar lo da la
 * sesión (`negocio_actual()`), y en el callback lo da la fila del `state`,
 * que se creó con ese mismo negocio.
 */

export interface FilaEstadoOAuth {
  negocioId: string;
  usuarioId: string;
  codeVerifier: string;
}

export interface FilaConexion {
  negocioId: string;
  mpUserId: string;
  accessToken: string;
  refreshToken: string;
  expiraEn: Date;
  estado: "ACTIVA" | "REQUIERE_RECONEXION" | "DESCONECTADA";
}

export interface RepoConexion {
  crearEstado(fila: FilaEstadoOAuth & { stateHash: string; expiraEn: Date }): Promise<void>;
  /**
   * Marca el state como usado y devuelve su fila, en UN UPDATE condicional
   * (`usado_en is null and expira_en > now()`). Null si no existe, venció o ya
   * se usó: dos callbacks con el mismo state no pueden ganar los dos.
   */
  consumirEstado(stateHash: string): Promise<FilaEstadoOAuth | null>;
  /** Upsert por negocio: reconectar reemplaza, no duplica. */
  guardarConexion(
    negocioId: string,
    usuarioId: string,
    tokens: TokensMercadoPago,
  ): Promise<void>;
  leerConexion(negocioId: string): Promise<FilaConexion | null>;
  /**
   * Guarda tokens renovados SOLO si el refresh_token guardado sigue siendo el
   * que se usó para renovar. Devuelve false si otro proceso renovó primero.
   */
  reemplazarTokens(
    negocioId: string,
    refreshTokenUsado: string,
    tokens: TokensMercadoPago,
  ): Promise<boolean>;
  marcarRequiereReconexion(negocioId: string, motivo: string): Promise<void>;
}

export type ErrorOAuthMp = "INVALID_GRANT" | "RECHAZADO" | "RED";

export interface ClienteOAuthMp {
  intercambiarCodigo(code: string, codeVerifier: string): Promise<
    { ok: true; tokens: TokensMercadoPago } | { ok: false; error: ErrorOAuthMp }
  >;
  renovar(refreshToken: string): Promise<
    { ok: true; tokens: TokensMercadoPago } | { ok: false; error: ErrorOAuthMp }
  >;
}

export interface DepsConexion {
  repo: RepoConexion;
  mp: ClienteOAuthMp;
  ahora?: () => Date;
}

const ahoraDe = (deps: DepsConexion) => (deps.ahora ? deps.ahora() : new Date());

/** Arma la URL de MP y deja el state guardado. */
export async function iniciarConexion(
  deps: DepsConexion,
  {
    negocioId,
    usuarioId,
    clientId,
    redirectUri,
  }: { negocioId: string; usuarioId: string; clientId: string; redirectUri: string },
): Promise<string> {
  const inicio = generarInicioOAuth();
  await deps.repo.crearEstado({
    stateHash: inicio.stateHash,
    negocioId,
    usuarioId,
    codeVerifier: inicio.codeVerifier,
    expiraEn: new Date(ahoraDe(deps).getTime() + VIDA_STATE_MS),
  });
  return urlAutorizacion({
    clientId,
    redirectUri,
    state: inicio.state,
    codeChallenge: inicio.codeChallenge,
  });
}

/**
 * La vuelta de Mercado Pago. Orden importante:
 *   1. El state se consume ANTES de mirar cualquier otra cosa, incluso si MP
 *      dice que la persona canceló: un state no se reusa nunca.
 *   2. Quien vuelve tiene que ser el mismo usuario que empezó.
 *   3. Recién ahí se canjea el código, con el verifier guardado.
 */
export async function completarCallback(
  deps: DepsConexion,
  {
    code,
    state,
    error,
    usuarioSesionId,
  }: {
    code: string | null;
    state: string | null;
    error: string | null;
    usuarioSesionId: string | null;
  },
): Promise<{ resultado: CodigoResultadoOAuth; negocioId?: string; mpUserId?: string }> {
  const fila = state ? await deps.repo.consumirEstado(hashState(state)) : null;

  if (error) return { resultado: "cancelado", negocioId: fila?.negocioId };
  if (!fila || !code) return { resultado: "state_invalido" };
  if (!usuarioSesionId || usuarioSesionId !== fila.usuarioId) {
    return { resultado: "otra_sesion", negocioId: fila.negocioId };
  }

  const canje = await deps.mp.intercambiarCodigo(code, fila.codeVerifier);
  if (!canje.ok) {
    return {
      resultado: canje.error === "RED" ? "error" : "rechazado",
      negocioId: fila.negocioId,
    };
  }

  await deps.repo.guardarConexion(fila.negocioId, fila.usuarioId, canje.tokens);
  return {
    resultado: "conectado",
    negocioId: fila.negocioId,
    mpUserId: canje.tokens.mpUserId,
  };
}

export type TokenVigente =
  | { ok: true; accessToken: string; mpUserId: string }
  | { ok: false; motivo: "SIN_CONEXION" | "REQUIERE_RECONEXION" | "RED" };

/**
 * Un access token que se puede usar YA, renovándolo antes si le queda menos
 * de 30 días (refresh perezoso: no hace falta un job, el token dura 180).
 *
 * Carrera: dos checkouts al mismo tiempo pueden intentar renovar con el MISMO
 * refresh_token. El que guarda primero gana (`reemplazarTokens` compara el
 * refresh usado); el otro relee la fila y usa el token nuevo. Solo si MP
 * rechaza el refresh Y nadie lo renovó, la conexión pasa a "requiere
 * reconexión". Un error de red NO la marca: no se le pide al comercio que
 * reconecte por un corte.
 */
export async function tokenVigente(
  deps: DepsConexion,
  negocioId: string,
): Promise<TokenVigente> {
  const fila = await deps.repo.leerConexion(negocioId);
  if (!fila || fila.estado === "DESCONECTADA") return { ok: false, motivo: "SIN_CONEXION" };
  if (fila.estado === "REQUIERE_RECONEXION") return { ok: false, motivo: "REQUIERE_RECONEXION" };

  const ahora = ahoraDe(deps);
  if (!necesitaRenovar(fila.expiraEn, ahora)) {
    return { ok: true, accessToken: fila.accessToken, mpUserId: fila.mpUserId };
  }

  const renovado = await deps.mp.renovar(fila.refreshToken);
  if (renovado.ok) {
    const gane = await deps.repo.reemplazarTokens(negocioId, fila.refreshToken, renovado.tokens);
    if (gane) {
      return { ok: true, accessToken: renovado.tokens.accessToken, mpUserId: renovado.tokens.mpUserId };
    }
    return releerTrasCarrera(deps, negocioId, fila.refreshToken);
  }

  if (renovado.error === "RED") {
    // El token viejo todavía vale (le quedan hasta 30 días): se usa.
    if (fila.expiraEn.getTime() > ahora.getTime()) {
      return { ok: true, accessToken: fila.accessToken, mpUserId: fila.mpUserId };
    }
    return { ok: false, motivo: "RED" };
  }

  // MP rechazó el refresh. ¿Lo renovó otro proceso mientras tanto?
  const otra = await releerTrasCarrera(deps, negocioId, fila.refreshToken);
  if (otra.ok) return otra;

  await deps.repo.marcarRequiereReconexion(
    negocioId,
    "Mercado Pago rechazó la renovación del permiso.",
  );
  return { ok: false, motivo: "REQUIERE_RECONEXION" };
}

async function releerTrasCarrera(
  deps: DepsConexion,
  negocioId: string,
  refreshUsado: string,
): Promise<TokenVigente> {
  const actual = await deps.repo.leerConexion(negocioId);
  if (
    actual &&
    actual.estado === "ACTIVA" &&
    actual.refreshToken !== refreshUsado &&
    actual.expiraEn.getTime() > ahoraDe(deps).getTime()
  ) {
    return { ok: true, accessToken: actual.accessToken, mpUserId: actual.mpUserId };
  }
  return { ok: false, motivo: "REQUIERE_RECONEXION" };
}
