import { describe, expect, it } from "vitest";
import {
  lineasCuentaRecibo,
  numeroReciboCC,
  reciboDesdeFila,
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
  imputaciones: [],
  pendientes: [],
  comercio: {
    nombre: "Librería Colores",
    direccion: null,
    whatsapp: null,
    anchoTicketMm: null,
  },
};

describe("reciboDesdeFila", () => {
  // La respuesta real de `recibo_cobro_cc` en el ensayo en seco del 1/10/2026
  // (CELESTE VENICA, Evens): $40.000 cancelan un ticket y casi todo otro.
  const fila = {
    pago_id: "11111111-2222-4333-8444-555555555555",
    cliente_nombre: "CELESTE VENICA",
    fecha: "2026-10-01T12:39:48.368258+00:00",
    metodo_nombre: "Efectivo",
    monto_base: 40000,
    recargo_porcentaje: 0,
    recargo_monto: 0,
    monto_bruto: "40000.00",
    saldo_anterior: "64725.00",
    mora_monto: 0,
    monto_aplicado: "40000.00",
    saldo_nuevo: "24725.00",
    fecha_vencimiento: "2026-10-14",
    imputaciones: [
      {
        debito_id: "7fe4945c",
        venta_id: "9894267e-fbaf-4c7b-abef-d00a3c58e6d1",
        comprobante_punto_venta: 1,
        comprobante_numero: 422,
        fecha: "2026-09-03",
        vence_el: "2026-10-08",
        descripcion: "Compra Fiada - Ticket #9894267E",
        monto: "33125.00",
        aplicado: "3675.00",
        saldo_restante: 0,
        es_mora_huerfana: false,
      },
      {
        debito_id: "3eeb47d6",
        venta_id: "6bd69093-b2a7-4e6c-9fde-174d5fc91471",
        comprobante_punto_venta: 1,
        comprobante_numero: 515,
        fecha: "2026-09-09",
        vence_el: "2026-10-14",
        descripcion: "Compra Fiada - Ticket #6BD69093",
        monto: "36750.00",
        aplicado: "36325.00",
        saldo_restante: "425.00",
        es_mora_huerfana: false,
      },
    ],
    pendientes: [
      {
        debito_id: "3eeb47d6",
        venta_id: "6bd69093-b2a7-4e6c-9fde-174d5fc91471",
        comprobante_punto_venta: 1,
        comprobante_numero: 515,
        fecha: "2026-09-09",
        vence_el: "2026-10-14",
        monto: "36750.00",
        vivo: "425.00",
      },
      {
        debito_id: "57beaf9b",
        venta_id: "744ed2df-478b-44e5-b5bc-a3c23b2c7dd2",
        comprobante_punto_venta: 1,
        comprobante_numero: 607,
        fecha: "2026-09-12",
        vence_el: "2026-10-17",
        monto: "24300.00",
        vivo: "24300.00",
      },
    ],
    comercio: {
      nombre: "Evens Indumentaria",
      direccion: null,
      whatsapp: null,
      ancho_ticket_mm: 80,
    },
  };

  it("lo aplicado suma el pago y lo pendiente suma el saldo nuevo", () => {
    const recibo = reciboDesdeFila(fila);
    const aplicado = recibo.imputaciones.reduce((t, i) => t + i.aplicado, 0);
    const pendiente = recibo.pendientes.reduce((t, d) => t + d.vivo, 0);
    expect(aplicado).toBe(recibo.montoBase);
    expect(pendiente).toBe(recibo.saldoNuevo);
    expect(recibo.imputaciones[0].numeroTicket).toBe("00001-00000422");
    expect(recibo.imputaciones[0].saldoRestante).toBe(0);
    expect(recibo.comercio.anchoTicketMm).toBe(80);
  });
});

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
