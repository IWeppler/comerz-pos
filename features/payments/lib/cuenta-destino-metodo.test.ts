import { describe, expect, it } from "vitest";
import {
  cuentasElegibles,
  requiereCuentaDestino,
  tipoCuentaSugerido,
  validarCuentaDestino,
} from "./cuenta-destino-metodo";

describe("requiereCuentaDestino", () => {
  it("el efectivo no la necesita: va siempre a la caja diaria", () => {
    expect(requiereCuentaDestino("EFECTIVO")).toBe(false);
  });

  it("los tres digitales sí", () => {
    expect(requiereCuentaDestino("TRANSFERENCIA")).toBe(true);
    expect(requiereCuentaDestino("BILLETERA_VIRTUAL")).toBe(true);
    expect(requiereCuentaDestino("TARJETA")).toBe(true);
  });
});

describe("tipoCuentaSugerido", () => {
  it("la billetera virtual sugiere BILLETERA y el resto BANCO", () => {
    expect(tipoCuentaSugerido("BILLETERA_VIRTUAL")).toBe("BILLETERA");
    expect(tipoCuentaSugerido("TRANSFERENCIA")).toBe("BANCO");
    expect(tipoCuentaSugerido("TARJETA")).toBe("BANCO");
  });
});

describe("cuentasElegibles", () => {
  it("saca el puente: no es un lugar donde el comercio tenga plata", () => {
    const cuentas = [
      { codigo: "CAJA_DIARIA" },
      { codigo: "POR_ACREDITAR" },
      { codigo: "BANCO_NACION_A1B2C3" },
    ];
    expect(cuentasElegibles(cuentas).map((c) => c.codigo)).toEqual([
      "CAJA_DIARIA",
      "BANCO_NACION_A1B2C3",
    ]);
  });
});

describe("validarCuentaDestino", () => {
  it("el efectivo pasa sin cuenta", () => {
    expect(validarCuentaDestino("EFECTIVO", null)).toBeNull();
    expect(validarCuentaDestino("EFECTIVO", "")).toBeNull();
  });

  it("un digital sin cuenta no pasa", () => {
    expect(validarCuentaDestino("TRANSFERENCIA", null)).toBe(
      "Elegí en qué cuenta cae la plata de este método.",
    );
    expect(validarCuentaDestino("TARJETA", "")).toBe(
      "Elegí en qué cuenta cae la plata de este método.",
    );
  });

  it("un digital con cuenta pasa", () => {
    expect(validarCuentaDestino("BILLETERA_VIRTUAL", "uuid-cuenta")).toBeNull();
  });

  it("fail-closed: un tipo que este codigo no conoce pide cuenta igual", () => {
    expect(validarCuentaDestino("CRIPTO", null)).not.toBeNull();
  });
});
