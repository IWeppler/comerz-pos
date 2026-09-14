import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _reiniciarSalidaParaTests,
  esRespuestaDeSesionMuerta,
  hayCookieDeSesion,
  nombreCookieSesion,
  salirPorSesionMuerta,
} from "./sesion-muerta-cliente";

const SUPABASE = "https://pwrvyfavqkyyprdgyxuk.supabase.co";
const REST = `${SUPABASE}/rest/v1/turnos_caja?select=id`;

const senal = (parcial: Partial<Parameters<typeof esRespuestaDeSesionMuerta>[0]>) => ({
  url: REST,
  status: 401,
  codigo: null,
  haySesionLocal: true,
  ...parcial,
});

describe("esRespuestaDeSesionMuerta", () => {
  it("401 con JWT rechazado por PostgREST (PGRST301) es sesión muerta", () => {
    expect(esRespuestaDeSesionMuerta(senal({ codigo: "PGRST301" }))).toBe(true);
    expect(esRespuestaDeSesionMuerta(senal({ codigo: "PGRST303" }))).toBe(true);
  });

  it("401 sin cookie de sesión (request como anon) es sesión muerta — el caso del 12/9", () => {
    // `permission denied for table turnos_caja` con rol anon: PostgREST lo
    // devuelve como 401 y sin code PGRST3xx.
    expect(esRespuestaDeSesionMuerta(senal({ codigo: "42501", haySesionLocal: false }))).toBe(true);
    expect(esRespuestaDeSesionMuerta(senal({ codigo: null, haySesionLocal: false }))).toBe(true);
  });

  it("401 de Kong (API key) con sesión local NO es sesión muerta", () => {
    expect(esRespuestaDeSesionMuerta(senal({ codigo: null }))).toBe(false);
  });

  it("401 con sesión local y un code que no es de JWT NO cuenta", () => {
    expect(esRespuestaDeSesionMuerta(senal({ codigo: "42501" }))).toBe(false);
  });

  it("solo 401 y solo /rest/v1/", () => {
    expect(esRespuestaDeSesionMuerta(senal({ status: 403, codigo: "PGRST301" }))).toBe(false);
    expect(esRespuestaDeSesionMuerta(senal({ status: 200, haySesionLocal: false }))).toBe(false);
    expect(
      esRespuestaDeSesionMuerta(
        senal({ url: `${SUPABASE}/storage/v1/object/a`, haySesionLocal: false }),
      ),
    ).toBe(false);
    expect(
      esRespuestaDeSesionMuerta(
        senal({
          url: `${SUPABASE}/auth/v1/token?grant_type=refresh_token`,
          status: 401,
          haySesionLocal: false,
        }),
      ),
    ).toBe(false);
  });
});

describe("cookie de sesión de @supabase/ssr", () => {
  it("se llama sb-<ref>-auth-token", () => {
    expect(nombreCookieSesion(SUPABASE)).toBe("sb-pwrvyfavqkyyprdgyxuk-auth-token");
    expect(nombreCookieSesion("no es url")).toBeNull();
  });

  it("detecta la cookie entera y sus chunks", () => {
    expect(hayCookieDeSesion("a=1; sb-pwrvyfavqkyyprdgyxuk-auth-token=xyz", SUPABASE)).toBe(true);
    expect(hayCookieDeSesion("sb-pwrvyfavqkyyprdgyxuk-auth-token.0=xyz; b=2", SUPABASE)).toBe(true);
    expect(hayCookieDeSesion("negocio_activo_id=abc", SUPABASE)).toBe(false);
    expect(hayCookieDeSesion("", SUPABASE)).toBe(false);
  });
});

describe("salirPorSesionMuerta", () => {
  beforeEach(() => _reiniciarSalidaParaTests());

  const ubicacion = (pathname: string, search = "") => ({
    pathname,
    search,
    assign: vi.fn(),
  });

  it("va a /auth/salir una sola vez", () => {
    const u = ubicacion("/pos");
    expect(salirPorSesionMuerta(u)).toBe(true);
    expect(salirPorSesionMuerta(u)).toBe(false);
    expect(u.assign).toHaveBeenCalledTimes(1);
    expect(u.assign).toHaveBeenCalledWith("/auth/salir");
  });

  it("nunca desde el login ni desde la propia salida", () => {
    for (const u of [
      ubicacion("/auth"),
      ubicacion("/auth/salir"),
      ubicacion("/pos", "?sesion=vencida"),
    ]) {
      expect(salirPorSesionMuerta(u)).toBe(false);
      expect(u.assign).not.toHaveBeenCalled();
    }
  });
});
