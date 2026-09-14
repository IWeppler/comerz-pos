import { describe, expect, it } from "vitest";
import { numeroTicketVenta } from "./numero-ticket";

const ID = "75df84c3-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("numeroTicketVenta", () => {
  it("usa el número del comprobante, que es el que está impreso", () => {
    expect(
      numeroTicketVenta({
        id: ID,
        comprobantes: [{ punto_venta: 1, numero: 417 }],
      }),
    ).toBe("00001-00000417");
  });

  it("cae al prefijo del UUID cuando la venta no tiene comprobante", () => {
    // Ventas anteriores a la tabla `comprobantes`, o emisiones que fallaron.
    expect(numeroTicketVenta({ id: ID, comprobantes: [] })).toBe("75DF84C3");
    expect(numeroTicketVenta({ id: ID })).toBe("75DF84C3");
    expect(numeroTicketVenta({ id: ID, comprobantes: null })).toBe("75DF84C3");
  });

  it("toma el comprobante de EMISIÓN y no una nota de crédito posterior", () => {
    expect(
      numeroTicketVenta({
        id: ID,
        comprobantes: [
          { punto_venta: 1, numero: 417 },
          { punto_venta: 1, numero: 998 },
        ],
      }),
    ).toBe("00001-00000417");
  });

  it("tolera el embed sin array, que es como lo devuelve un to-one", () => {
    expect(
      numeroTicketVenta({
        id: ID,
        comprobantes: { punto_venta: 3, numero: 12 },
      }),
    ).toBe("00003-00000012");
  });

  it("cae al respaldo si el comprobante está a medio cargar", () => {
    // `formatearNumeroComprobante` es fail-closed: sin punto de venta o sin
    // número no inventa un formato.
    expect(
      numeroTicketVenta({ id: ID, comprobantes: [{ punto_venta: 1 }] }),
    ).toBe("75DF84C3");
  });
});
