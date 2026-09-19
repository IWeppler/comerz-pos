import { describe, expect, it } from "vitest";
import { calcularTotalesTurno, type MovimientoCaja } from "./totales-turno";

const ventaEfectivo = (monto: number, anulada = false): MovimientoCaja => ({
  tipo: "INGRESO",
  metodo_tipo: "EFECTIVO",
  monto,
  comision: 0,
  neto: monto,
  anulada,
});

const ventaTarjeta = (
  monto: number,
  comision: number,
  anulada = false,
): MovimientoCaja => ({
  tipo: "INGRESO",
  metodo_tipo: "TARJETA",
  monto,
  comision,
  neto: monto - comision,
  anulada,
});

const egreso = (monto: number): MovimientoCaja => ({
  tipo: "EGRESO",
  metodo_tipo: "EFECTIVO",
  monto,
  comision: 0,
  neto: monto,
});

describe("calcularTotalesTurno", () => {
  it("una transferencia interna toca el cajón pero no la facturación", () => {
    const entrada: MovimientoCaja = {
      tipo: "INGRESO",
      metodo_tipo: "EFECTIVO",
      monto: 30_000,
      comision: 0,
      neto: 30_000,
      afecta_facturacion: false,
    };
    const salida: MovimientoCaja = {
      ...entrada,
      tipo: "EGRESO",
      monto: 10_000,
      neto: 10_000,
    };
    const totales = calcularTotalesTurno([entrada, salida], 5_000);
    expect(totales.efectivoEsperado).toBe(25_000);
    expect(totales.totalFacturado).toBe(0);
  });

  it("suma efectivo y descuenta egresos", () => {
    const totales = calcularTotalesTurno(
      [ventaEfectivo(45_000), ventaEfectivo(25_000), egreso(10_000)],
      1_000,
    );

    expect(totales.efectivoEsperado).toBe(61_000);
    expect(totales.totalFacturado).toBe(70_000);
  });

  it("una venta anulada en efectivo NETEA con su devolución, no resta dos veces", () => {
    // Vendió 80.000 en efectivo y lo devolvió entero en el mismo turno.
    const totales = calcularTotalesTurno(
      [ventaEfectivo(80_000, true), egreso(80_000)],
      0,
    );

    // El cajón quedó como estaba.
    expect(totales.efectivoEsperado).toBe(0);
    // Pero no se vendió nada.
    expect(totales.totalFacturado).toBe(0);
  });

  it("reproduce Ninja Camisetas del 22/8/2026", () => {
    // 5 ventas en efectivo en el turno abierto; 4 anuladas.
    // Además se devolvieron 2 ventas de un turno de MAYO ya cerrado
    // (45.000 + 25.000), cuyo egreso cae en este turno pero cuyo ingreso
    // nunca estuvo en este cajón.
    const movimientos: MovimientoCaja[] = [
      ventaEfectivo(45_000), // la única que quedó viva
      ventaEfectivo(125_000, true),
      ventaEfectivo(80_000, true),
      ventaEfectivo(45_000, true),
      ventaEfectivo(45_000, true),
      egreso(125_000),
      egreso(80_000),
      egreso(45_000),
      egreso(45_000),
      egreso(45_000), // venta de mayo
      egreso(25_000), // venta de mayo
    ];

    const totales = calcularTotalesTurno(movimientos, 0);

    expect(totales.ingresosEfectivo).toBe(340_000);
    expect(totales.totalEgresos).toBe(365_000);

    // Lo que falta DE VERDAD: se devolvieron 70.000 de mayo desde un cajón
    // que solo tenía los 45.000 de hoy. Es un faltante real, no un bug.
    expect(totales.efectivoEsperado).toBe(-25_000);

    // Y NO los −320.000 que mostraba antes, que salían de excluir el ingreso
    // de las anuladas y restar igual su egreso.
    expect(totales.efectivoEsperado).not.toBe(-320_000);

    // Facturado del turno: solo la venta que sobrevivió.
    expect(totales.totalFacturado).toBe(45_000);
  });

  it("una venta anulada por tarjeta no suma a lo digital ni toca el cajón", () => {
    // `anular_venta` no genera egreso para lo cobrado con tarjeta: eso vuelve
    // por donde entró. Si se contara el ingreso, quedaría cobrado de más.
    const totales = calcularTotalesTurno(
      [ventaTarjeta(100_000, 5_000, true), ventaTarjeta(50_000, 2_500)],
      0,
    );

    expect(totales.ingresosDigitalesBruto).toBe(50_000);
    expect(totales.comisionesRetenidas).toBe(2_500);
    expect(totales.ingresosDigitalesNeto).toBe(47_500);
    expect(totales.efectivoEsperado).toBe(0);
    expect(totales.totalFacturado).toBe(50_000);
  });

  it("el fondo inicial entra en el arqueo pero no en lo facturado", () => {
    const totales = calcularTotalesTurno([ventaEfectivo(10_000)], 5_000);

    expect(totales.efectivoEsperado).toBe(15_000);
    expect(totales.totalFacturado).toBe(10_000);
  });
});
