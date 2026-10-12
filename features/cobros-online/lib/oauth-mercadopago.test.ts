import { describe, expect, it } from "vitest";
import {
  codeChallengeS256,
  generarInicioOAuth,
  hashState,
  interpretarRespuestaToken,
  necesitaRenovar,
  urlAutorizacion,
} from "./oauth-mercadopago";
import { MENSAJES_OAUTH, esCodigoResultado } from "./mensajes-oauth";

describe("PKCE y state", () => {
  it("el challenge S256 coincide con el vector del RFC 7636", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("genera un verifier válido y un state que solo se guarda hasheado", () => {
    const inicio = generarInicioOAuth();
    expect(inicio.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(inicio.codeChallenge).toBe(codeChallengeS256(inicio.codeVerifier));
    expect(inicio.stateHash).toBe(hashState(inicio.state));
    expect(inicio.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inicio.stateHash).not.toContain(inicio.state);
  });

  it("dos inicios no comparten state ni verifier", () => {
    const a = generarInicioOAuth();
    const b = generarInicioOAuth();
    expect(a.state).not.toBe(b.state);
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });

  it("arma la URL de autorización con PKCE y platform_id", () => {
    const url = new URL(
      urlAutorizacion({
        clientId: "123",
        redirectUri: "https://app.comerz.app/api/mercadopago/oauth/callback",
        state: "abc",
        codeChallenge: "xyz",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://auth.mercadopago.com/authorization");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123",
      response_type: "code",
      platform_id: "mp",
      state: "abc",
      redirect_uri: "https://app.comerz.app/api/mercadopago/oauth/callback",
      code_challenge: "xyz",
      code_challenge_method: "S256",
    });
  });
});

describe("respuesta de /oauth/token", () => {
  const ahora = new Date("2026-10-12T12:00:00Z");

  it("lee tokens, usuario y vencimiento (180 días)", () => {
    const tokens = interpretarRespuestaToken(
      {
        access_token: "APP_USR-a",
        token_type: "bearer",
        expires_in: 15552000,
        scope: "offline_access read write",
        user_id: 724484980,
        refresh_token: "TG-r",
      },
      ahora,
    );
    expect(tokens).toEqual({
      accessToken: "APP_USR-a",
      refreshToken: "TG-r",
      mpUserId: "724484980",
      expiraEn: new Date("2027-04-10T12:00:00Z"),
    });
  });

  it.each([
    ["sin refresh", { access_token: "a", user_id: 1, expires_in: 10 }],
    ["sin usuario", { access_token: "a", refresh_token: "r", expires_in: 10 }],
    ["sin vencimiento", { access_token: "a", refresh_token: "r", user_id: 1 }],
    ["un error de MP", { error: "invalid_grant", message: "x" }],
    ["basura", "hola"],
  ])("devuelve null con %s", (_, json) => {
    expect(interpretarRespuestaToken(json, ahora)).toBeNull();
  });

  it("renueva con menos de 30 días de vida, no antes", () => {
    const dia = 24 * 60 * 60 * 1000;
    expect(necesitaRenovar(new Date(ahora.getTime() + 31 * dia), ahora)).toBe(false);
    expect(necesitaRenovar(new Date(ahora.getTime() + 29 * dia), ahora)).toBe(true);
    expect(necesitaRenovar(new Date(ahora.getTime() - dia), ahora)).toBe(true);
  });
});

describe("mensajes de vuelta a Cobros", () => {
  it("solo acepta códigos conocidos (lo que viene en la URL no se muestra crudo)", () => {
    expect(esCodigoResultado("conectado")).toBe(true);
    expect(esCodigoResultado("<script>")).toBe(false);
    expect(esCodigoResultado("toString")).toBe(false);
    expect(esCodigoResultado(null)).toBe(false);
  });

  it("hablan en voseo", () => {
    const todos = Object.values(MENSAJES_OAUTH).join(" ");
    expect(todos).not.toMatch(/\b(tienes|puedes|intenta|conecta|vuelve)\b/i);
  });
});
