import { describe, expect, it } from "vitest";
import {
  MARCA_CREDENCIAL_ANULADA,
  debeAnularCredencialPrevia,
} from "./credencial-previa";

const AHORA = new Date("2026-10-22T15:00:00Z");
const HACE_UN_MINUTO = "2026-10-22T14:59:00Z";
const HACE_UNA_HORA = "2026-10-22T14:00:00Z";

const mail = (email_verified: unknown) => ({
  provider: "email",
  created_at: "2026-10-01T10:00:00Z",
  identity_data: { email_verified },
});
const google = (created_at: string) => ({
  provider: "google",
  created_at,
  identity_data: { email_verified: true },
});

describe("se anula: el caso del agujero", () => {
  it("mail sin verificar + Google que se vinculó en este login", () => {
    expect(
      debeAnularCredencialPrevia(
        { identities: [mail(false), google(HACE_UN_MINUTO)] },
        AHORA,
      ),
    ).toBe(true);
  });

  it("email_verified como texto, que es como lo guarda la base", () => {
    expect(
      debeAnularCredencialPrevia(
        { identities: [mail("false"), google(HACE_UN_MINUTO)] },
        AHORA,
      ),
    ).toBe(true);
  });

  it("sin el dato de verificación: no se probó el mail", () => {
    expect(
      debeAnularCredencialPrevia(
        { identities: [{ provider: "email" }, google(HACE_UN_MINUTO)] },
        AHORA,
      ),
    ).toBe(true);
  });
});

describe("no se toca", () => {
  it("el mail se verificó por link: la clave es del dueño", () => {
    expect(
      debeAnularCredencialPrevia(
        { identities: [mail(true), google(HACE_UN_MINUTO)] },
        AHORA,
      ),
    ).toBe(false);
    expect(
      debeAnularCredencialPrevia(
        { identities: [mail("true"), google(HACE_UN_MINUTO)] },
        AHORA,
      ),
    ).toBe(false);
  });

  it("Google vinculado hace rato: no es este login", () => {
    expect(
      debeAnularCredencialPrevia(
        { identities: [mail(false), google(HACE_UNA_HORA)] },
        AHORA,
      ),
    ).toBe(false);
  });

  it("cuenta solo de Google: no hay contraseña ajena", () => {
    expect(
      debeAnularCredencialPrevia({ identities: [google(HACE_UN_MINUTO)] }, AHORA),
    ).toBe(false);
  });

  it("cuenta solo de mail: nadie entró con Google", () => {
    expect(debeAnularCredencialPrevia({ identities: [mail(false)] }, AHORA)).toBe(false);
  });

  it("ya se anuló una vez (el callback corre dos veces)", () => {
    expect(
      debeAnularCredencialPrevia(
        {
          identities: [mail(false), google(HACE_UN_MINUTO)],
          app_metadata: { [MARCA_CREDENCIAL_ANULADA]: "2026-10-22T14:59:30Z" },
        },
        AHORA,
      ),
    ).toBe(false);
  });

  it("sin identidades o con fecha ilegible", () => {
    expect(debeAnularCredencialPrevia({}, AHORA)).toBe(false);
    expect(
      debeAnularCredencialPrevia(
        { identities: [mail(false), google("no es una fecha")] },
        AHORA,
      ),
    ).toBe(false);
  });
});
