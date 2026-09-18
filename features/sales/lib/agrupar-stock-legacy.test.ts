import { describe, expect, it } from "vitest";
import { agruparStockLegacy } from "./agrupar-stock-legacy";

describe("agruparStockLegacy", () => {
  it("suma unidad base y presentación que consumen la misma variante", () => {
    expect(
      agruparStockLegacy([
        { stockId: "crema-unico", cantidad: 1 },
        { stockId: "crema-unico", cantidad: 4.7 },
      ]),
    ).toEqual([{ stock_id: "crema-unico", cantidad: 5.7 }]);
  });

  it("mantiene variantes separadas y descarta venta libre", () => {
    expect(
      agruparStockLegacy([
        { stockId: "rojo", cantidad: 2 },
        { stockId: null, cantidad: 1 },
        { stockId: "azul", cantidad: 3 },
      ]),
    ).toEqual([
      { stock_id: "rojo", cantidad: 2 },
      { stock_id: "azul", cantidad: 3 },
    ]);
  });
});
