import { describe, expect, it } from "vitest";
import { REGLAS_AUTH, consultaDeCupo, ipDelPedido } from "./limites-auth";

describe("ipDelPedido", () => {
  it("la primera de x-forwarded-for es la del cliente", () => {
    expect(ipDelPedido("200.1.2.3, 10.0.0.1")).toBe("200.1.2.3");
    expect(ipDelPedido(" 2800:810::1 ")).toBe("2800:810::1");
  });

  it("sin x-forwarded-for cae a x-real-ip, y si no hay nada, null", () => {
    expect(ipDelPedido(null, "200.1.2.3")).toBe("200.1.2.3");
    expect(ipDelPedido("", "")).toBeNull();
    expect(ipDelPedido(undefined)).toBeNull();
  });
});

describe("consultaDeCupo", () => {
  it("login: limita por IP y por mail, con la ventana de la regla", () => {
    const c = consultaDeCupo("LOGIN", { ip: "200.1.2.3", email: "dueña@local.com" });
    expect(c?.maximos).toEqual([REGLAS_AUTH.LOGIN.maxPorIp, REGLAS_AUTH.LOGIN.maxPorEmail]);
    expect(c?.ventanaSeg).toBe(REGLAS_AUTH.LOGIN.ventanaSeg);
    expect(c?.claves).toHaveLength(2);
  });

  it("no guarda mails ni IPs en claro", () => {
    const c = consultaDeCupo("LOGIN", { ip: "200.1.2.3", email: "duena@local.com" });
    for (const clave of c?.claves ?? []) {
      expect(clave).toMatch(/^[0-9a-f]{64}$/);
      expect(clave).not.toContain("200.1.2.3");
    }
  });

  it("el mismo mail con mayúsculas o espacios es la misma clave", () => {
    const a = consultaDeCupo("RECUPERAR", { ip: null, email: "Duena@Local.com " });
    const b = consultaDeCupo("RECUPERAR", { ip: null, email: "duena@local.com" });
    expect(a?.claves).toEqual(b?.claves);
  });

  it("IP y mail iguales no comparten clave", () => {
    const c = consultaDeCupo("LOGIN", { ip: "x@y.com", email: "x@y.com" });
    expect(new Set(c?.claves).size).toBe(2);
  });

  it("el registro no limita por mail (todavía no hay cuenta)", () => {
    const c = consultaDeCupo("REGISTRO", { ip: "200.1.2.3", email: "nuevo@local.com" });
    expect(c?.claves).toHaveLength(1);
    expect(c?.maximos).toEqual([REGLAS_AUTH.REGISTRO.maxPorIp]);
  });

  it("sin IP ni mail no hay nada que controlar", () => {
    expect(consultaDeCupo("LOGIN", { ip: null, email: "" })).toBeNull();
    expect(consultaDeCupo("REGISTRO", { ip: null, email: "a@b.com" })).toBeNull();
  });
});
