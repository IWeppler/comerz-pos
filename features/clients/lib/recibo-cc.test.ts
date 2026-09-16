import { describe, expect, it } from "vitest";
import {
  lineasCuentaRecibo,
  numeroReciboCC,
  type ReciboCobroCC,
} from "./recibo-cc";

const BASE: ReciboCobroCC = {
  pagoId: "1484ce10-efb3-4009-a1b4-855dc27223ff",
  fecha: "2026-09-15T20:00:00.000Z",
  clienteNombre: "MIRTA MOREYRA",
  metodoNombre: "Efectivo",
  montoBase: 10000,
  recargoMetodoPorcentaje: 0,
  recargoMetodoMonto: 0,
  montoBruto: 10000,
  moraMonto: 0,
  saldoAnterior: 39000,
  saldoNuevo: 29000,
  fechaVencimiento: "2026-10-15",
  comercio: {
    nombre: "Librería Colores",
    direccion: null,
    whatsapp: null,
    anchoTicketMm: null,
  },
};

describe("numeroReciboCC", () => {
  it("son los primeros 8 del uuid del pago, en mayúsculas", () => {
    expect(numeroReciboCC(BASE)).toBe("1484CE10");
  });
});

describe("lineasCuentaRecibo", () => {
  it("sin mora: saldo anterior y pago", () => {
    expect(lineasCuentaRecibo(BASE)).toEqual([
      { etiqueta: "Saldo anterior", monto: 39000, signo: "" },
      { etiqueta: "Pago a cuenta", monto: 10000, signo: "-" },
    ]);
  });

  it("con mora: la línea del recargo va ANTES del pago", () => {
    const lineas = lineasCuentaRecibo({
      ...BASE,
      moraMonto: 1500,
      saldoAnterior: 10000,
      montoBase: 10000,
      saldoNuevo: 1500,
    });
    expect(lineas.map((l) => l.etiqueta)).toEqual([
      "Saldo anterior",
      "Recargo por mora",
      "Pago a cuenta",
    ]);
    // La cuenta del papel tiene que cerrar con el saldo nuevo.
    const total = lineas.reduce(
      (acc, l) => acc + (l.signo === "-" ? -l.monto : l.monto),
      0,
    );
    expect(total).toBe(1500);
  });
});
