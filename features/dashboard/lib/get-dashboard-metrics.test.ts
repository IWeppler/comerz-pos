import { describe, expect, it } from "vitest";
import { getDashboardMetrics } from "./get-dashboard-metrics";
import type { Venta, VentaPago } from "@/entities/ventas/types";

/**
 * Cobertura de la plata financiera del dashboard: recargo por método (que NO
 * es venta de mercadería) y comisiones de los cobros de cuenta corriente (que
 * antes se veían en Caja pero no acá, sobreestimando la ganancia).
 *
 * Todo con periodo "historico" para que el filtro de fechas no participe.
 */

const ventaBase = {
  id: "v1",
  cantidad: 1,
  fecha_venta: "2026-07-30T12:00:00Z",
  estado_operacion: "CONFIRMADA",
  estado_pago: "PAGADA",
} as unknown as Venta;

const metricas = (ventas: Venta[], pagosCC: VentaPago[] = []) =>
  getDashboardMetrics(
    ventas,
    [],
    [],
    [],
    "historico",
    undefined,
    undefined,
    pagosCC,
  );

describe("recargo por método en las métricas", () => {
  it("no cuenta el recargo como venta de mercadería", () => {
    // Ticket de $10.000 de mercadería + $1.500 de recargo, costo $6.000.
    const m = metricas([
      {
        ...ventaBase,
        total: 11500,
        recargo_metodo_total: 1500,
        precio_costo: 6000,
      } as unknown as Venta,
    ]);

    expect(m.ingresos).toBe(10000);
    expect(m.gananciaBrutaVentas).toBe(4000);
    expect(m.recargosCobrados).toBe(1500);
  });

  it("mantiene la identidad ingresos - gananciaBruta = costo de mercadería", () => {
    // Es la resta que hace reportes/page.tsx para mostrar el costo.
    const m = metricas([
      {
        ...ventaBase,
        total: 11500,
        recargo_metodo_total: 1500,
        precio_costo: 6000,
      } as unknown as Venta,
    ]);

    expect(m.ingresos - m.gananciaBrutaVentas).toBe(6000);
  });

  it("suma el recargo a la ganancia neta, del lado de la comisión que compensa", () => {
    const m = metricas([
      {
        ...ventaBase,
        total: 11500,
        recargo_metodo_total: 1500,
        precio_costo: 6000,
        venta_pagos: [
          {
            metodo_nombre: "Tarjeta",
            metodo_tipo: "TARJETA",
            monto_bruto: 11500,
            recargo_monto: 1500,
            comision_monto: 1000,
            monto_neto: 10500,
            acreditacion_dias: 0,
          },
        ],
      } as unknown as Venta,
    ]);

    // 4.000 de margen + 1.500 de recargo - 1.000 de comisión.
    expect(m.gananciaNeta).toBe(4500);
  });
});

describe("cobros de cuenta corriente", () => {
  const cobroConTarjeta = {
    id: "p1",
    metodo_nombre: "Tarjeta",
    metodo_tipo: "TARJETA",
    monto_base: 10000,
    recargo_porcentaje: 15,
    recargo_monto: 1500,
    monto_bruto: 11500,
    comision_porcentaje: 6,
    comision_monto: 690,
    monto_neto: 10810,
    acreditacion_dias: 0,
    tipo_movimiento: "PAGO_CUENTA_CORRIENTE",
    creado_en: "2026-07-30T18:00:00Z",
  } as unknown as VentaPago;

  it("descuenta su comisión de la ganancia neta", () => {
    const sinCobro = metricas([]);
    const conCobro = metricas([], [cobroConTarjeta]);

    expect(sinCobro.totalComisiones).toBe(0);
    expect(conCobro.totalComisiones).toBe(690);
    // Recargo cobrado (1.500) menos comisión (690).
    expect(conCobro.gananciaNeta - sinCobro.gananciaNeta).toBe(810);
  });

  it("no suma el capital cobrado a ingresos (ya lo contó la venta fiada)", () => {
    const m = metricas([], [cobroConTarjeta]);

    expect(m.ingresos).toBe(0);
    expect(m.cobrosCuentaCorriente).toBe(11500);
  });

  it("aparece en el desglose por método, para que cierre contra Caja", () => {
    const m = metricas([], [cobroConTarjeta]);
    const tarjeta = m.ventasPorMetodo.find((x) => x.label === "Tarjeta");

    expect(tarjeta).toEqual({
      label: "Tarjeta",
      bruto: 11500,
      comision: 690,
      neto: 10810,
      // Toda la comisión vino de cobrar la deuda: Rentabilidad la separa.
      comisionCuentaCorriente: 690,
    });
  });

  it("ignora los cobros anulados", () => {
    const m = metricas(
      [],
      [{ ...cobroConTarjeta, estado_pago_operacion: "ANULADO" } as VentaPago],
    );

    expect(m.totalComisiones).toBe(0);
    expect(m.cobrosCuentaCorriente).toBe(0);
  });
});

describe("devoluciones parciales en las métricas", () => {
  /**
   * La venta con devolución sigue CONFIRMADA (ver 20260903160000), así que no
   * la filtra `ventasOperativas`: sin el neteo, estos casos contarían el ticket
   * entero.
   *
   * La invariante que sostiene toda esta cuenta es
   * `monto_devuelto = base_devuelta + recargo_cc_devuelto`: el recargo por
   * MÉTODO nunca se devuelve porque se lo quedó el banco (20260903190000), y el
   * de CUENTA CORRIENTE sí porque no se lo quedó nadie (20260903200000).
   */
  const contado = (extra: Partial<Venta>) =>
    ({
      ...ventaBase,
      // $10.000 de mercadería + $1.500 de recargo por método.
      total: 11500,
      recargo_metodo_total: 1500,
      precio_costo: 6000,
      ...extra,
    }) as unknown as Venta;

  it("resta lo devuelto de los ingresos y NO toca el recargo por método", () => {
    const m = metricas([
      contado({
        monto_devuelto: 4000,
        base_devuelta: 4000,
        ventas_items: [
          { precio_costo: 2400, cantidad_devuelta: 1 },
        ] as unknown as Venta["ventas_items"],
      }),
    ]);

    expect(m.ingresos).toBe(6000);
    // El banco se quedó su comisión igual: el recargo cobrado no baja.
    expect(m.recargosCobrados).toBe(1500);
  });

  it("resta también el COSTO de lo devuelto, o el margen queda peor que el real", () => {
    const m = metricas([
      contado({
        monto_devuelto: 4000,
        base_devuelta: 4000,
        ventas_items: [
          { precio_costo: 2400, cantidad_devuelta: 1 },
        ] as unknown as Venta["ventas_items"],
      }),
    ]);

    // Ingresos 6.000 menos costo neto 3.600.
    expect(m.gananciaBrutaVentas).toBe(2400);
    expect(m.ingresos - m.gananciaBrutaVentas).toBe(3600);
  });

  it("una venta devuelta entera no deja ingresos ni ganancia, pero sí el recargo", () => {
    const m = metricas([
      contado({
        monto_devuelto: 10000,
        base_devuelta: 10000,
        ventas_items: [
          { precio_costo: 6000, cantidad_devuelta: 1 },
        ] as unknown as Venta["ventas_items"],
      }),
    ]);

    expect(m.ingresos).toBe(0);
    expect(m.gananciaBrutaVentas).toBe(0);
    // Sigue en 1.500: esa plata la clienta la pagó y el banco la retuvo.
    expect(m.recargosCobrados).toBe(1500);
  });

  it("en cuenta corriente el recargo perdonado también baja de ingresos", () => {
    // Fiado de $100.000 + 15% de recargo de CC = $115.000. Se devuelven
    // $40.000 de mercadería, así que se le perdonan $6.000 de recargo.
    const m = metricas([
      {
        ...ventaBase,
        total: 115000,
        recargo_metodo_total: 0,
        recargo_cc_monto: 15000,
        monto_pendiente: 115000,
        precio_costo: 50000,
        monto_devuelto: 46000,
        base_devuelta: 40000,
        recargo_cc_devuelto: 6000,
        ventas_items: [
          { precio_costo: 20000, cantidad_devuelta: 1 },
        ] as unknown as Venta["ventas_items"],
      } as unknown as Venta,
    ]);

    // Quedan $60.000 de mercadería + $9.000 de recargo de CC.
    expect(m.ingresos).toBe(69000);
    expect(m.gananciaBrutaVentas).toBe(39000);
  });

  it("una venta sin devolución no cambia", () => {
    const m = metricas([contado({})]);

    expect(m.ingresos).toBe(10000);
    expect(m.recargosCobrados).toBe(1500);
    expect(m.gananciaBrutaVentas).toBe(4000);
  });
});
