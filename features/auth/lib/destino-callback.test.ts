import { describe, expect, it } from "vitest";
import {
  DESTINO_POR_DEFECTO,
  destinoSeguro,
  destinoSeguroDesdeRedirect,
} from "./destino-callback";

describe("rutas internas: pasan", () => {
  it("el caso normal del mail de alta", () => {
    expect(destinoSeguro("/onboarding")).toBe("/onboarding");
  });

  it("conserva query y hash", () => {
    expect(destinoSeguro("/configuracion?seccion=listasPrecios")).toBe(
      "/configuracion?seccion=listasPrecios",
    );
  });
});

describe("redirect abierto: no", () => {
  it("una URL absoluta", () => {
    expect(destinoSeguro("https://otro-sitio.com")).toBe(DESTINO_POR_DEFECTO);
  });

  it("protocol-relative, que es el que se escapa", () => {
    // `//evil.com` empieza con "/" y engaña a un `startsWith("/")` solo. El
    // navegador la resuelve como host externo con el protocolo actual.
    expect(destinoSeguro("//evil.com")).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("//evil.com/robar")).toBe(DESTINO_POR_DEFECTO);
  });

  it("con backslash, que varios navegadores normalizan a barra", () => {
    expect(destinoSeguro("/\\evil.com")).toBe(DESTINO_POR_DEFECTO);
  });

  it("un esquema raro", () => {
    expect(destinoSeguro("javascript:alert(1)")).toBe(DESTINO_POR_DEFECTO);
  });
});

describe("ausente o vacío", () => {
  it("cae al onboarding, que es lo que le falta al que confirmó", () => {
    expect(destinoSeguro(null)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro(undefined)).toBe(DESTINO_POR_DEFECTO);
    expect(destinoSeguro("")).toBe(DESTINO_POR_DEFECTO);
  });
});

describe("destinoSeguroDesdeRedirect: el RedirectTo del template", () => {
  const ORIGEN = "https://app.comerz.app";
  const PASSWORD = "/auth/actualizar-password";

  it("absoluta del propio origen: se queda con path + query", () => {
    expect(
      destinoSeguroDesdeRedirect(
        "https://app.comerz.app/auth/actualizar-password?invitacion=abc",
        ORIGEN,
        PASSWORD,
      ),
    ).toBe("/auth/actualizar-password?invitacion=abc");
  });

  it("absoluta de OTRO origen: default", () => {
    expect(
      destinoSeguroDesdeRedirect("https://evil.com/auth/actualizar-password", ORIGEN, PASSWORD),
    ).toBe(PASSWORD);
    expect(
      destinoSeguroDesdeRedirect("https://app.comerz.app.evil.com/x", ORIGEN, PASSWORD),
    ).toBe(PASSWORD);
  });

  it("relativa: misma regla que destinoSeguro, con el default pedido", () => {
    expect(destinoSeguroDesdeRedirect("/pos", ORIGEN, PASSWORD)).toBe("/pos");
    expect(destinoSeguroDesdeRedirect("//evil.com", ORIGEN, PASSWORD)).toBe(PASSWORD);
    expect(destinoSeguroDesdeRedirect(null, ORIGEN, PASSWORD)).toBe(PASSWORD);
    expect(destinoSeguroDesdeRedirect("basura", ORIGEN, PASSWORD)).toBe(PASSWORD);
  });
});
