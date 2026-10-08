import { describe, expect, it } from "vitest";
import { validarAliasTransferencia } from "./alias-transferencia";

describe("validarAliasTransferencia (espejo del CHECK)", () => {
  it("acepta un alias con puntos", () => {
    expect(validarAliasTransferencia("evens.indumentaria")).toEqual({
      ok: true,
      valor: "evens.indumentaria",
    });
  });

  it("acepta un CBU/CVU pegado con espacios", () => {
    expect(validarAliasTransferencia("0000003 1000123456 78901")).toEqual({
      ok: true,
      valor: "0000003100012345678901",
    });
  });

  it("vacío = no se muestra (null, no cadena vacía)", () => {
    expect(validarAliasTransferencia("   ")).toEqual({ ok: true, valor: null });
  });

  it("rechaza un alias corto", () => {
    expect(validarAliasTransferencia("abc").ok).toBe(false);
  });

  it("rechaza caracteres que el CHECK no acepta", () => {
    expect(validarAliasTransferencia("mi_alias!").ok).toBe(false);
  });

  it("rechaza un CBU de 21 dígitos", () => {
    expect(validarAliasTransferencia("0".repeat(21)).ok).toBe(false);
  });

  it("acepta 22 dígitos", () => {
    expect(validarAliasTransferencia("1".repeat(22))).toEqual({
      ok: true,
      valor: "1".repeat(22),
    });
  });
});
