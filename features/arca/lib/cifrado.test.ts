import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cifrar,
  claveMaestraConfigurada,
  descifrar,
  generarClaveMaestra,
} from "./cifrado";

describe("cifrado de credenciales de ARCA", () => {
  const original = process.env.ARCA_CLAVE_CIFRADO;

  beforeEach(() => {
    process.env.ARCA_CLAVE_CIFRADO = generarClaveMaestra();
  });
  afterEach(() => {
    process.env.ARCA_CLAVE_CIFRADO = original;
  });

  it("cifra y descifra ida y vuelta", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
    const guardado = cifrar(pem);
    expect(guardado.startsWith("v1:")).toBe(true);
    expect(guardado).not.toContain("abc");
    expect(descifrar(guardado)).toBe(pem);
  });

  it("dos cifrados del mismo texto no se parecen (IV aleatorio)", () => {
    expect(cifrar("x")).not.toBe(cifrar("x"));
  });

  it("con otra clave maestra no descifra: falla, no devuelve basura", () => {
    const guardado = cifrar("secreto");
    process.env.ARCA_CLAVE_CIFRADO = generarClaveMaestra();
    expect(() => descifrar(guardado)).toThrow();
  });

  it("sin env var no hay clave y el error lo dice", () => {
    delete process.env.ARCA_CLAVE_CIFRADO;
    expect(claveMaestraConfigurada()).toBe(false);
    expect(() => cifrar("x")).toThrow(/ARCA_CLAVE_CIFRADO/);
  });

  it("una clave de largo incorrecto se trata como no configurada", () => {
    process.env.ARCA_CLAVE_CIFRADO = Buffer.from("corta").toString("base64");
    expect(claveMaestraConfigurada()).toBe(false);
  });
});
