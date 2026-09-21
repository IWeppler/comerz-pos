import { describe, it, expect } from "vitest";
import {
  DEFINICION_TIPO_EGRESO,
  TIPOS_EGRESO,
  TIPOS_EGRESO_MANUALES,
  esGastoDelNegocio,
  normalizarTipoEgreso,
  salePlataDeLaCaja,
  sumarGastosOperativos,
  sumarSalidasDeCaja,
} from "./tipo-egreso";

describe("TIPOS_EGRESO_MANUALES", () => {
  it("deja afuera DEVOLUCION: eso lo escriben las RPCs de venta, no una persona", () => {
    expect(TIPOS_EGRESO_MANUALES).not.toContain("DEVOLUCION");
    expect(TIPOS_EGRESO_MANUALES).toEqual([
      "OPERATIVO",
      "RETIRO_SOCIO",
      "COMPRA_MERCADERIA",
    ]);
  });
});

describe("normalizarTipoEgreso", () => {
  it("deja pasar los tipos válidos", () => {
    for (const tipo of TIPOS_EGRESO) {
      expect(normalizarTipoEgreso(tipo)).toBe(tipo);
    }
  });

  it("fail-closed: lo desconocido se trata como gasto operativo", () => {
    for (const basura of [null, undefined, "", "RETIRO", "operativo", 7, {}]) {
      expect(normalizarTipoEgreso(basura)).toBe("OPERATIVO");
    }
  });
});

describe("qué afecta cada tipo", () => {
  it("los TRES sacan plata del cajón: el arqueo no distingue", () => {
    for (const tipo of TIPOS_EGRESO) {
      expect(salePlataDeLaCaja(tipo)).toBe(true);
      expect(DEFINICION_TIPO_EGRESO[tipo].afectaEfectivo).toBe(true);
    }
  });

  it("solo el gasto operativo resta de la ganancia", () => {
    expect(esGastoDelNegocio("OPERATIVO")).toBe(true);
    expect(esGastoDelNegocio("RETIRO_SOCIO")).toBe(false);
    expect(esGastoDelNegocio("COMPRA_MERCADERIA")).toBe(false);
  });

  it("una devolución al cliente sale del cajón pero no es gasto: la venta ya salió de los ingresos", () => {
    expect(salePlataDeLaCaja("DEVOLUCION")).toBe(true);
    expect(esGastoDelNegocio("DEVOLUCION")).toBe(false);
  });

  it("un egreso viejo sin tipo sigue restando, como antes de la columna", () => {
    expect(esGastoDelNegocio(undefined)).toBe(true);
    expect(esGastoDelNegocio(null)).toBe(true);
  });
});

describe("sumas", () => {
  const egresos = [
    { monto: 1000, tipo: "OPERATIVO" },
    { monto: "500", tipo: "OPERATIVO" },
    { monto: 50000, tipo: "RETIRO_SOCIO" },
    { monto: 120000, tipo: "COMPRA_MERCADERIA" },
    { monto: 300, tipo: null },
    { monto: 12000, tipo: "DEVOLUCION" },
  ];

  it("gastos operativos ignora retiros y compras", () => {
    expect(sumarGastosOperativos(egresos)).toBe(1800);
  });

  it("salidas de caja los suma todos", () => {
    expect(sumarSalidasDeCaja(egresos)).toBe(183800);
  });

  it("acepta montos en texto, que es como los devuelve PostgREST", () => {
    expect(sumarGastosOperativos([{ monto: "2500.50", tipo: "OPERATIVO" }])).toBe(
      2500.5,
    );
  });

  it("una lista vacía da 0, no NaN", () => {
    expect(sumarGastosOperativos([])).toBe(0);
    expect(sumarSalidasDeCaja([])).toBe(0);
  });
});
