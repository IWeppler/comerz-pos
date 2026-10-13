import { describe, expect, it } from "vitest";
import { etiquetaMinutos, validarCobros, type EntradaCobros } from "./validar-cobros";

const base: EntradaCobros = {
  cobroTransferencia: false,
  cobroMercadoPago: false,
  aliasMercadoPago: "",
  titular: "",
  cvu: "",
  cuitTitular: "",
  minutosVenceTransferencia: 120,
  minutosVenceMp: 60,
};

describe("validarCobros", () => {
  it("todo apagado se guarda aunque MP no esté conectado", () => {
    const r = validarCobros(base, { mercadoPagoConectado: false });
    expect(r).toEqual({
      ok: true,
      valores: {
        cobro_online_transferencia: false,
        cobro_online_mp: false,
        alias_mercadopago_tienda: null,
        transferencia_titular: null,
        transferencia_cvu: null,
        transferencia_cuit: null,
        minutos_vence_transferencia: 120,
        minutos_vence_mp: 60,
      },
    });
  });

  it("ningún medio se prende sin Mercado Pago conectado", () => {
    for (const medio of [{ cobroTransferencia: true }, { cobroMercadoPago: true }]) {
      const r = validarCobros(
        { ...base, ...medio, aliasMercadoPago: "mi.alias.mp" },
        { mercadoPagoConectado: false },
      );
      expect(r.ok).toBe(false);
    }
  });

  it("la transferencia pide el alias", () => {
    const r = validarCobros({ ...base, cobroTransferencia: true }, { mercadoPagoConectado: true });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/alias/) });
  });

  it("limpia el alias pegado con espacios y el titular", () => {
    const r = validarCobros(
      {
        ...base,
        cobroTransferencia: true,
        aliasMercadoPago: " 0000 0031 0000 0000 0000 01 ",
        titular: "  María   López ",
      },
      { mercadoPagoConectado: true },
    );
    expect(r.ok && r.valores.alias_mercadopago_tienda).toBe("0000003100000000000001");
    expect(r.ok && r.valores.transferencia_titular).toBe("María López");
  });

  it("rechaza alias inválido y plazos fuera de las opciones (el navegador no elige otros)", () => {
    expect(validarCobros({ ...base, aliasMercadoPago: "con espacio!" }, { mercadoPagoConectado: true }).ok).toBe(false);
    expect(validarCobros({ ...base, minutosVenceTransferencia: 2880 }, { mercadoPagoConectado: true }).ok).toBe(false);
    expect(validarCobros({ ...base, minutosVenceMp: 5 }, { mercadoPagoConectado: true }).ok).toBe(false);
    expect(validarCobros({ ...base, titular: "X" }, { mercadoPagoConectado: true }).ok).toBe(false);
  });
});

describe("etiquetaMinutos", () => {
  it.each([
    [30, "30 min"],
    [60, "1 h"],
    [90, "1 h 30 min"],
    [120, "2 h"],
  ])("%i → %s", (min, txt) => expect(etiquetaMinutos(min)).toBe(txt));
});

describe("datos para transferir", () => {
  it("CVU y CUIT se guardan solo con números", () => {
    const r = validarCobros(
      { ...base, cvu: "0000 0031 0000 1234 5678 90", cuitTitular: "20-12345678-6" },
      { mercadoPagoConectado: true },
    );
    expect(r.ok && r.valores.transferencia_cvu).toBe("0000003100001234567890");
    expect(r.ok && r.valores.transferencia_cuit).toBe("20123456786");
  });

  it("un CVU que no tiene 22 números o un CUIT mal tipeado no se guardan", () => {
    expect(validarCobros({ ...base, cvu: "123" }, { mercadoPagoConectado: true }).ok).toBe(false);
    expect(validarCobros({ ...base, cuitTitular: "20-12345678-0" }, { mercadoPagoConectado: true }).ok).toBe(false);
  });
});
