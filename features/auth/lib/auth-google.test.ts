import { describe, expect, it } from "vitest";
import { urlDeRetornoGoogle } from "@/shared/lib/auth-google";

describe("urlDeRetornoGoogle", () => {
  it("vuelve al mismo callback que el mail", () => {
    // No hay un handler aparte para OAuth: el flujo también aterriza con un
    // `code` de PKCE, y ese callback ya es idempotente.
    expect(urlDeRetornoGoogle("https://comerz.app", "/empezar")).toBe(
      "https://comerz.app/auth/callback?next=%2Fempezar",
    );
  });

  it("escapa el next", () => {
    // Sin encodear, un `next` con query rompe la URL de retorno: el `?` de
    // adentro se leería como separador y Google recibiría otra cosa.
    expect(
      urlDeRetornoGoogle("https://comerz.app", "/configuracion?seccion=listasPrecios"),
    ).toBe(
      "https://comerz.app/auth/callback?next=%2Fconfiguracion%3Fseccion%3DlistasPrecios",
    );
  });

  it("respeta el host de la request, que en localhost no es producción", () => {
    expect(urlDeRetornoGoogle("http://localhost:3000", "/")).toBe(
      "http://localhost:3000/auth/callback?next=%2F",
    );
  });
});
