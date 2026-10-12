import { describe, expect, it, vi } from "vitest";
import {
  completarCallback,
  iniciarConexion,
  tokenVigente,
  type ClienteOAuthMp,
  type DepsConexion,
  type FilaConexion,
  type FilaEstadoOAuth,
  type RepoConexion,
} from "./conexion-mercadopago";
import { hashState, type TokensMercadoPago } from "./oauth-mercadopago";

const AHORA = new Date("2026-10-12T12:00:00Z");
const DIA = 24 * 60 * 60 * 1000;

/** Repo en memoria con las MISMAS reglas que la base: state de un solo uso,
 * upsert por negocio y reemplazo condicional de tokens. */
function repoEnMemoria() {
  const estados = new Map<string, FilaEstadoOAuth & { expiraEn: Date; usado: boolean }>();
  const conexiones = new Map<string, FilaConexion>();
  const repo: RepoConexion = {
    async crearEstado({ stateHash, expiraEn, ...fila }) {
      estados.set(stateHash, { ...fila, expiraEn, usado: false });
    },
    async consumirEstado(stateHash) {
      const fila = estados.get(stateHash);
      if (!fila || fila.usado || fila.expiraEn <= AHORA) return null;
      fila.usado = true;
      return { negocioId: fila.negocioId, usuarioId: fila.usuarioId, codeVerifier: fila.codeVerifier };
    },
    async guardarConexion(negocioId, _usuarioId, tokens) {
      conexiones.set(negocioId, { negocioId, ...tokens, estado: "ACTIVA" });
    },
    async leerConexion(negocioId) {
      const fila = conexiones.get(negocioId);
      return fila ? { ...fila } : null;
    },
    async reemplazarTokens(negocioId, refreshUsado, tokens) {
      const fila = conexiones.get(negocioId);
      if (!fila || fila.refreshToken !== refreshUsado) return false;
      conexiones.set(negocioId, { ...fila, ...tokens, estado: "ACTIVA" });
      return true;
    },
    async marcarRequiereReconexion(negocioId) {
      const fila = conexiones.get(negocioId);
      if (fila) fila.estado = "REQUIERE_RECONEXION";
    },
  };
  return { repo, estados, conexiones };
}

const tokens = (n: number, vidaDias = 180): TokensMercadoPago => ({
  accessToken: `APP_USR-${n}`,
  refreshToken: `TG-${n}`,
  mpUserId: "999",
  expiraEn: new Date(AHORA.getTime() + vidaDias * DIA),
});

function mpFalso(over: Partial<ClienteOAuthMp> = {}): ClienteOAuthMp {
  return {
    intercambiarCodigo: vi.fn(async () => ({ ok: true as const, tokens: tokens(1) })),
    renovar: vi.fn(async () => ({ ok: true as const, tokens: tokens(2) })),
    ...over,
  };
}

/** Inicia una conexión y devuelve el state crudo que viajó en la URL. */
async function iniciar(deps: DepsConexion, usuarioId = "u1") {
  const url = await iniciarConexion(deps, {
    negocioId: "n1",
    usuarioId,
    clientId: "cid",
    redirectUri: "https://app.comerz.app/api/mercadopago/oauth/callback",
  });
  return new URL(url).searchParams.get("state")!;
}

describe("callback de OAuth", () => {
  it("conecta, guarda tokens del negocio del state y no guarda el state en claro", async () => {
    const { repo, estados, conexiones } = repoEnMemoria();
    const mp = mpFalso();
    const deps = { repo, mp, ahora: () => AHORA };
    const state = await iniciar(deps);

    expect([...estados.keys()]).toEqual([hashState(state)]);

    const r = await completarCallback(deps, { code: "c", state, error: null, usuarioSesionId: "u1" });
    expect(r).toEqual({ resultado: "conectado", negocioId: "n1", mpUserId: "999" });
    expect(conexiones.get("n1")?.accessToken).toBe("APP_USR-1");
    // Se canjeó con el verifier que se generó al iniciar, no con otro.
    const verifier = (mp.intercambiarCodigo as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(verifier).toBe(estados.get(hashState(state))!.codeVerifier);
  });

  it("un state reusado se rechaza y no canjea dos veces", async () => {
    const { repo } = repoEnMemoria();
    const mp = mpFalso();
    const deps = { repo, mp, ahora: () => AHORA };
    const state = await iniciar(deps);

    await completarCallback(deps, { code: "c", state, error: null, usuarioSesionId: "u1" });
    const segunda = await completarCallback(deps, { code: "c", state, error: null, usuarioSesionId: "u1" });

    expect(segunda.resultado).toBe("state_invalido");
    expect(mp.intercambiarCodigo).toHaveBeenCalledTimes(1);
  });

  it("un state inventado o vencido se rechaza", async () => {
    const { repo, estados } = repoEnMemoria();
    const mp = mpFalso();
    const deps = { repo, mp, ahora: () => AHORA };

    expect(
      (await completarCallback(deps, { code: "c", state: "inventado", error: null, usuarioSesionId: "u1" })).resultado,
    ).toBe("state_invalido");

    const state = await iniciar(deps);
    estados.get(hashState(state))!.expiraEn = new Date(AHORA.getTime() - 1);
    expect(
      (await completarCallback(deps, { code: "c", state, error: null, usuarioSesionId: "u1" })).resultado,
    ).toBe("state_invalido");
    expect(mp.intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("si la persona cancela en MP, el state igual queda consumido", async () => {
    const { repo, estados } = repoEnMemoria();
    const deps = { repo, mp: mpFalso(), ahora: () => AHORA };
    const state = await iniciar(deps);

    const r = await completarCallback(deps, { code: null, state, error: "access_denied", usuarioSesionId: "u1" });
    expect(r.resultado).toBe("cancelado");
    expect(estados.get(hashState(state))!.usado).toBe(true);
  });

  it("otro usuario no puede completar la conexión que empezó alguien más", async () => {
    const { repo, conexiones } = repoEnMemoria();
    const mp = mpFalso();
    const deps = { repo, mp, ahora: () => AHORA };
    const state = await iniciar(deps, "u1");

    const r = await completarCallback(deps, { code: "c", state, error: null, usuarioSesionId: "u2" });
    expect(r.resultado).toBe("otra_sesion");
    expect(mp.intercambiarCodigo).not.toHaveBeenCalled();
    expect(conexiones.size).toBe(0);
  });

  it("si MP rechaza el código no guarda nada", async () => {
    const { repo, conexiones } = repoEnMemoria();
    const deps = {
      repo,
      mp: mpFalso({ intercambiarCodigo: async () => ({ ok: false, error: "INVALID_GRANT" }) }),
      ahora: () => AHORA,
    };
    const state = await iniciar(deps);
    const r = await completarCallback(deps, { code: "c", state, error: null, usuarioSesionId: "u1" });
    expect(r.resultado).toBe("rechazado");
    expect(conexiones.size).toBe(0);
  });

  it("reconectar reemplaza la conexión, no la duplica", async () => {
    const { repo, conexiones } = repoEnMemoria();
    let n = 0;
    const deps = {
      repo,
      mp: mpFalso({ intercambiarCodigo: async () => ({ ok: true, tokens: tokens(++n) }) }),
      ahora: () => AHORA,
    };
    for (let i = 0; i < 2; i++) {
      const state = await iniciar(deps);
      await completarCallback(deps, { code: "c", state, error: null, usuarioSesionId: "u1" });
    }
    expect(conexiones.size).toBe(1);
    expect(conexiones.get("n1")?.accessToken).toBe("APP_USR-2");
  });
});

describe("token vigente y renovación", () => {
  it("sin conexión o pidiendo reconexión, no hay token", async () => {
    const { repo, conexiones } = repoEnMemoria();
    const deps = { repo, mp: mpFalso(), ahora: () => AHORA };
    expect(await tokenVigente(deps, "n1")).toEqual({ ok: false, motivo: "SIN_CONEXION" });

    conexiones.set("n1", { negocioId: "n1", ...tokens(1), estado: "REQUIERE_RECONEXION" });
    expect(await tokenVigente(deps, "n1")).toEqual({ ok: false, motivo: "REQUIERE_RECONEXION" });
  });

  it("con más de 30 días de vida usa el token sin llamar a MP", async () => {
    const { repo, conexiones } = repoEnMemoria();
    const mp = mpFalso();
    conexiones.set("n1", { negocioId: "n1", ...tokens(1, 90), estado: "ACTIVA" });
    const r = await tokenVigente({ repo, mp, ahora: () => AHORA }, "n1");
    expect(r).toEqual({ ok: true, accessToken: "APP_USR-1", mpUserId: "999" });
    expect(mp.renovar).not.toHaveBeenCalled();
  });

  it("con menos de 30 días renueva y guarda el refresh nuevo", async () => {
    const { repo, conexiones } = repoEnMemoria();
    conexiones.set("n1", { negocioId: "n1", ...tokens(1, 10), estado: "ACTIVA" });
    const r = await tokenVigente({ repo, mp: mpFalso(), ahora: () => AHORA }, "n1");
    expect(r).toEqual({ ok: true, accessToken: "APP_USR-2", mpUserId: "999" });
    expect(conexiones.get("n1")?.refreshToken).toBe("TG-2");
  });

  it("si MP rechaza el refresh y nadie renovó, pide reconexión", async () => {
    const { repo, conexiones } = repoEnMemoria();
    conexiones.set("n1", { negocioId: "n1", ...tokens(1, 10), estado: "ACTIVA" });
    const deps = {
      repo,
      mp: mpFalso({ renovar: async () => ({ ok: false, error: "INVALID_GRANT" }) }),
      ahora: () => AHORA,
    };
    expect(await tokenVigente(deps, "n1")).toEqual({ ok: false, motivo: "REQUIERE_RECONEXION" });
    expect(conexiones.get("n1")?.estado).toBe("REQUIERE_RECONEXION");
  });

  it("carrera: si otro proceso renovó primero, usa SU token y no pide reconexión", async () => {
    const { repo, conexiones } = repoEnMemoria();
    conexiones.set("n1", { negocioId: "n1", ...tokens(1, 10), estado: "ACTIVA" });
    const deps = {
      repo,
      mp: mpFalso({
        // Mientras este proceso pedía, otro renovó y guardó el token 3.
        renovar: async () => {
          conexiones.set("n1", { negocioId: "n1", ...tokens(3), estado: "ACTIVA" });
          return { ok: false as const, error: "INVALID_GRANT" as const };
        },
      }),
      ahora: () => AHORA,
    };
    expect(await tokenVigente(deps, "n1")).toEqual({ ok: true, accessToken: "APP_USR-3", mpUserId: "999" });
    expect(conexiones.get("n1")?.estado).toBe("ACTIVA");
  });

  it("carrera: si los dos renuevan bien, gana el primero y el segundo usa el guardado", async () => {
    const { repo, conexiones } = repoEnMemoria();
    conexiones.set("n1", { negocioId: "n1", ...tokens(1, 10), estado: "ACTIVA" });
    const deps = {
      repo,
      mp: mpFalso({
        renovar: async () => {
          conexiones.set("n1", { negocioId: "n1", ...tokens(3), estado: "ACTIVA" });
          return { ok: true as const, tokens: tokens(2) };
        },
      }),
      ahora: () => AHORA,
    };
    expect(await tokenVigente(deps, "n1")).toEqual({ ok: true, accessToken: "APP_USR-3", mpUserId: "999" });
    expect(conexiones.get("n1")?.refreshToken).toBe("TG-3");
  });

  it("un corte de red no pide reconexión: usa el token viejo mientras valga", async () => {
    const { repo, conexiones } = repoEnMemoria();
    conexiones.set("n1", { negocioId: "n1", ...tokens(1, 10), estado: "ACTIVA" });
    const deps = {
      repo,
      mp: mpFalso({ renovar: async () => ({ ok: false, error: "RED" }) }),
      ahora: () => AHORA,
    };
    expect(await tokenVigente(deps, "n1")).toEqual({ ok: true, accessToken: "APP_USR-1", mpUserId: "999" });
    expect(conexiones.get("n1")?.estado).toBe("ACTIVA");
  });
});
