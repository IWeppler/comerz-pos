import { describe, expect, it } from "vitest";
import {
  agruparDeudaPorProveedor,
  conceptoPagoRemito,
  diasSinIngresar,
  mensajeErrorRemito,
  SIN_PROVEEDOR,
  type RemitoResumenPago,
} from "./pago-remito";

function remito(p: Partial<RemitoResumenPago>): RemitoResumenPago {
  return {
    id: "r",
    nombre: "INGRESO",
    fecha_remito: "2026-10-01",
    creado_en: "2026-10-01T12:00:00Z",
    aprobado_en: "2026-10-01T13:00:00Z",
    estado: "APROBADA",
    pago_modo: "EN_COMERZ",
    proveedor_id: "p1",
    proveedor_nombre: "Mayorista",
    valor: 100,
    total_pagado: 0,
    saldo_pendiente: 100,
    situacion: "A_PAGAR",
    ...p,
  };
}

describe("agruparDeudaPorProveedor", () => {
  it("suma solo lo A_PAGAR, por proveedor, el que más se debe primero", () => {
    const grupos = agruparDeudaPorProveedor([
      remito({ id: "a", saldo_pendiente: 100 }),
      remito({ id: "b", saldo_pendiente: 50, fecha_remito: "2026-09-01" }),
      remito({ id: "c", proveedor_id: "p2", proveedor_nombre: "Fábrica", saldo_pendiente: 500 }),
      remito({ id: "d", situacion: "ANTERIOR", saldo_pendiente: 9999 }),
      remito({ id: "e", situacion: "SIN_RESPONDER", saldo_pendiente: 9999 }),
    ]);
    expect(grupos.map((g) => [g.proveedorNombre, g.total])).toEqual([
      ["Fábrica", 500],
      ["Mayorista", 150],
    ]);
    // El remito más viejo primero.
    expect(grupos[1].remitos.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("los remitos sin proveedor van juntos, rotulados", () => {
    const [g] = agruparDeudaPorProveedor([
      remito({ proveedor_id: null, proveedor_nombre: null }),
    ]);
    expect(g.proveedorId).toBeNull();
    expect(g.proveedorNombre).toBe(SIN_PROVEEDOR);
  });
});

describe("diasSinIngresar", () => {
  it("cuenta días enteros y nunca da negativo", () => {
    const ahora = new Date("2026-10-22T12:00:00Z");
    expect(diasSinIngresar("2026-10-12T12:00:00Z", ahora)).toBe(10);
    expect(diasSinIngresar("2026-10-23T12:00:00Z", ahora)).toBe(0);
  });
});

describe("conceptoPagoRemito", () => {
  it("nombra al proveedor si lo hay", () => {
    expect(conceptoPagoRemito({ nombre: "VERANO23", proveedor_nombre: "Mayorista" })).toBe(
      "Pago a Mayorista · VERANO23",
    );
    expect(conceptoPagoRemito({ nombre: "VERANO23", proveedor_nombre: null })).toBe(
      "Pago de VERANO23",
    );
  });
});

describe("mensajeErrorRemito", () => {
  it("traduce los códigos de la base y deja pasar lo desconocido", () => {
    expect(mensajeErrorRemito("PROVEEDOR_REQUERIDO: para dejarlo...")).toMatch(/proveedor/);
    expect(mensajeErrorRemito("REMITO_DESCARTADO: este remito")).toMatch(/descartado/);
    expect(mensajeErrorRemito("otra cosa")).toBeNull();
    expect(mensajeErrorRemito(null)).toBeNull();
  });
});
