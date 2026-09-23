import { describe, expect, it } from "vitest";
import {
  esFilaConsolidada,
  esMovimientoDeCuentas,
} from "./movimiento-de-cuentas";

describe("esMovimientoDeCuentas", () => {
  it("el gasto del cajón se ve en el turno; el de una cuenta sin arqueo, acá", () => {
    // Es el caso que motivó el corte: las bolsas que pagó la cajera de su
    // cajón no son un movimiento de cuentas, y los siete sueldos que salieron
    // de la Caja Grande de El Nono Cacho sí — no aparecían en ninguna parte.
    expect(esMovimientoDeCuentas("EGRESO", "CAJA_DIARIA")).toBe(false);
    expect(esMovimientoDeCuentas("EGRESO", "CAJA_GENERAL")).toBe(true);
    expect(esMovimientoDeCuentas("EGRESO", "BANCO")).toBe(true);
  });

  it("un ingreso libre sigue la misma regla que el gasto", () => {
    expect(esMovimientoDeCuentas("INGRESO", "CAJA_DIARIA")).toBe(false);
    expect(esMovimientoDeCuentas("INGRESO", "CAJA_GENERAL")).toBe(true);
  });

  it("los cobros de venta NO se esconden: se consolidan, y eso lo hace la base", () => {
    // La primera versión los escondía en todas las cuentas. Era cierto en el
    // cajón y falso en el banco: el 21/9/2026 Mercado Pago subió $282.175 en
    // 9 cobros y la tabla no mostraba una sola fila que lo explicara.
    expect(esMovimientoDeCuentas("VENTA_PAGO", "BANCO")).toBe(true);
    expect(esMovimientoDeCuentas("VENTA_PAGO", "BILLETERA")).toBe(true);
    expect(esMovimientoDeCuentas("VENTA_PAGO", "CAJA_DIARIA")).toBe(true);
  });

  it("la apertura y el cierre del turno entran, aunque sean de la caja diaria", () => {
    // El corte no es "sacar la caja diaria": es mostrar su SALDO y no el
    // detalle de los gastos que alguien cargó contra ella.
    expect(esMovimientoDeCuentas("TURNO_CAJA", "CAJA_DIARIA")).toBe(true);
    expect(esMovimientoDeCuentas("TURNO_CAJA", "CAJA_GENERAL")).toBe(true);
  });

  it("transferencias, acreditaciones y ajustes entran siempre", () => {
    expect(esMovimientoDeCuentas("TRANSFERENCIA", "CAJA_DIARIA")).toBe(true);
    expect(esMovimientoDeCuentas("ACREDITACION", "PUENTE_ACREDITACION")).toBe(true);
    expect(esMovimientoDeCuentas("AJUSTE", "BANCO")).toBe(true);
  });

  it("un origen desconocido se MUESTRA: acá el lado seguro no es esconder", () => {
    // Contra la costumbre fail-closed del resto de la base, y a propósito:
    // una fila de más se lee y se descarta; plata escondida en silencio por
    // una etiqueta que este código no conocía, no.
    expect(esMovimientoDeCuentas("ORIGEN_QUE_NO_EXISTE_TODAVIA", "BANCO")).toBe(
      true,
    );
    expect(
      esMovimientoDeCuentas("ORIGEN_QUE_NO_EXISTE_TODAVIA", "CAJA_DIARIA"),
    ).toBe(true);
  });
});

describe("esFilaConsolidada", () => {
  it("sin cantidad, la fila es un movimiento", () => {
    // Es lo que pasa mientras la migración de `p_vista` no esté aplicada: la
    // base no manda el campo, y entonces cada fila ES un movimiento.
    expect(esFilaConsolidada(undefined)).toBe(false);
    expect(esFilaConsolidada(1)).toBe(false);
  });

  it("con más de uno, la fila resume varios", () => {
    expect(esFilaConsolidada(9)).toBe(true);
  });
});
