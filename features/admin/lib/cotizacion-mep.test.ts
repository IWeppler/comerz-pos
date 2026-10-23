import { describe, expect, it } from "vitest";
import { leerCotizacionMep, pesosAUsd, usdAPesos } from "./cotizacion-mep";

const AHORA = new Date("2026-10-23T15:00:00Z");

describe("leerCotizacionMep", () => {
  it("toma la venta de la respuesta de dolarapi", () => {
    const c = leerCotizacionMep(
      { casa: "bolsa", compra: 1557.8, venta: 1557.8, fechaActualizacion: "2026-10-23T13:59:00.000Z" },
      AHORA,
    );
    expect(c).toEqual({ venta: 1557.8, fecha: "2026-10-23T13:59:00.000Z", vieja: false });
  });

  it("usa la venta y no la compra: pagar en dólares es comprar dólares", () => {
    const c = leerCotizacionMep(
      { compra: 1555.9, venta: 1558.8, fechaActualizacion: "2026-10-23T13:59:00.000Z" },
      AHORA,
    );
    expect(c?.venta).toBe(1558.8);
  });

  it("marca como vieja la que lleva más de 3 días sin actualizarse", () => {
    const c = leerCotizacionMep(
      { venta: 1500, fechaActualizacion: "2026-10-19T10:00:00.000Z" },
      AHORA,
    );
    expect(c?.vieja).toBe(true);
  });

  it("descarta lo que no es una cotización, sin adivinar", () => {
    const fecha = "2026-10-23T13:59:00.000Z";
    expect(leerCotizacionMep(null, AHORA)).toBeNull();
    expect(leerCotizacionMep("hola", AHORA)).toBeNull();
    expect(leerCotizacionMep({ venta: "abc", fechaActualizacion: fecha }, AHORA)).toBeNull();
    expect(leerCotizacionMep({ venta: 0, fechaActualizacion: fecha }, AHORA)).toBeNull();
    expect(leerCotizacionMep({ venta: -5, fechaActualizacion: fecha }, AHORA)).toBeNull();
    expect(leerCotizacionMep({ venta: 9e9, fechaActualizacion: fecha }, AHORA)).toBeNull();
    // Sin fecha no se sabe si es de hoy: no se supone que sí.
    expect(leerCotizacionMep({ venta: 1500 }, AHORA)).toBeNull();
    expect(leerCotizacionMep({ venta: 1500, fechaActualizacion: "ayer" }, AHORA)).toBeNull();
  });
});

describe("conversión", () => {
  it("20 USD al MEP de hoy", () => {
    expect(usdAPesos(20, 1557.8)).toBe(31156);
  });

  it("los $33.000 de Vercel son unos 21 dólares", () => {
    expect(pesosAUsd(33000, 1557.8)).toBe(21.18);
  });
});
