import { describe, expect, it } from "vitest";
import {
  DIAS_PARA_VERIFICAR,
  MARCA_MAIL_VERIFICADO,
  estadoVerificacionEmail,
  mailVerificado,
  metodoPruebaElMail,
} from "./verificacion-email";

const AHORA = new Date("2026-08-26T12:00:00Z");

describe("estadoVerificacionEmail", () => {
  it("quien verificó no ve ningún aviso", () => {
    expect(
      estadoVerificacionEmail({
        emailConfirmado: true,
        creadoEn: "2026-01-01T00:00:00Z",
        ahora: AHORA,
      }),
    ).toEqual({ estado: "verificado" });
  });

  it("recién registrado: aviso suave con el plazo completo", () => {
    expect(
      estadoVerificacionEmail({
        emailConfirmado: false,
        creadoEn: "2026-08-26T09:00:00Z",
        ahora: AHORA,
      }),
    ).toEqual({ estado: "pendiente", diasRestantes: 7 });
  });

  it("descuenta los días transcurridos", () => {
    expect(
      estadoVerificacionEmail({
        emailConfirmado: false,
        creadoEn: "2026-08-21T12:00:00Z",
        ahora: AHORA,
      }),
    ).toEqual({ estado: "pendiente", diasRestantes: 2 });
  });

  it("el día 7 ya está vencido", () => {
    // El plazo es de 7 días completos: al séptimo se terminó, no queda uno más.
    expect(
      estadoVerificacionEmail({
        emailConfirmado: false,
        creadoEn: "2026-08-19T12:00:00Z",
        ahora: AHORA,
      }),
    ).toEqual({ estado: "vencido", diasVencido: 0 });
  });

  it("cuenta hace cuánto se venció", () => {
    expect(
      estadoVerificacionEmail({
        emailConfirmado: false,
        creadoEn: "2026-08-16T12:00:00Z",
        ahora: AHORA,
      }),
    ).toEqual({ estado: "vencido", diasVencido: 3 });
  });

  it("sin fecha de alta avisa suave, no apura", () => {
    // El dato que falta es nuestro: apurar a alguien por eso sería cobrarle un
    // error del sistema.
    for (const creadoEn of [null, undefined, "no-es-una-fecha"]) {
      expect(
        estadoVerificacionEmail({
          emailConfirmado: false,
          creadoEn,
          ahora: AHORA,
        }),
      ).toEqual({ estado: "pendiente", diasRestantes: DIAS_PARA_VERIFICAR });
    }
  });
});

describe("mailVerificado", () => {
  const mail = (email_verified: unknown) => ({ provider: "email", identity_data: { email_verified } });

  it("alta con contraseña y la confirmación apagada: NO está probado", () => {
    // email_confirmed_at viene lleno, pero eso no se mira: ese era el bug.
    expect(mailVerificado({ identities: [mail(false)] })).toBe(false);
    expect(mailVerificado({ identities: [mail("false")] })).toBe(false);
    expect(mailVerificado({ identities: [{ provider: "email" }] })).toBe(false);
  });

  it("abrió el link del correo: la marca propia", () => {
    expect(
      mailVerificado({
        identities: [mail(false)],
        app_metadata: { [MARCA_MAIL_VERIFICADO]: "2026-10-22T15:00:00Z" },
      }),
    ).toBe(true);
  });

  it("la identidad de mail verificada (confirmación prendida, invitados)", () => {
    expect(mailVerificado({ identities: [mail(true)] })).toBe(true);
    expect(mailVerificado({ identities: [mail("true")] })).toBe(true);
  });

  it("entra con Google: Google ya verificó el correo", () => {
    expect(mailVerificado({ identities: [{ provider: "google" }] })).toBe(true);
    expect(mailVerificado({ identities: [mail(false), { provider: "google" }] })).toBe(true);
  });

  it("sin identidades: no está probado", () => {
    expect(mailVerificado({})).toBe(false);
  });
});

describe("metodoPruebaElMail", () => {
  it("los links del correo prueban la casilla", () => {
    for (const m of ["otp", "magiclink", "recovery", "invite", "email/signup", "email_change"]) {
      expect(metodoPruebaElMail([m])).toBe(true);
    }
  });

  it("contraseña y Google no prueban el correo de esta cuenta", () => {
    expect(metodoPruebaElMail(["password"])).toBe(false);
    expect(metodoPruebaElMail(["oauth"])).toBe(false);
    expect(metodoPruebaElMail([])).toBe(false);
  });
});
