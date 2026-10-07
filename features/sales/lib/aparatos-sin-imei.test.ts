import { describe, expect, it } from "vitest";
import {
  MOTIVO_SIN_IMEI_MAX,
  normalizarMotivoSinImei,
  parsearMotivosSinImei,
  resolverAparatosSinImei,
} from "./aparatos-sin-imei";

const celular = "var-celular";
const funda = "var-funda";
const llevaSerie = new Set([celular]);

describe("resolverAparatosSinImei", () => {
  it("no pide nada a lo que no lleva IMEI", () => {
    const r = resolverAparatosSinImei({
      renglones: [{ varianteId: funda, cantidad: 3, aparatosConImei: 0 }],
      llevaSerie,
      motivos: new Map(),
      esVentaOffline: false,
    });
    expect(r).toEqual({ ok: true, motivoPorRenglon: new Map() });
  });

  it("no pide motivo si todos los aparatos salen con IMEI", () => {
    const r = resolverAparatosSinImei({
      renglones: [{ varianteId: celular, cantidad: 2, aparatosConImei: 2 }],
      llevaSerie,
      motivos: new Map(),
      esVentaOffline: false,
    });
    expect(r).toEqual({ ok: true, motivoPorRenglon: new Map() });
  });

  it("rechaza un celular sin IMEI y sin motivo en una venta online (caso 1-18)", () => {
    const r = resolverAparatosSinImei({
      renglones: [
        { varianteId: funda, cantidad: 1, aparatosConImei: 0 },
        { varianteId: celular, cantidad: 1, aparatosConImei: 0 },
      ],
      llevaSerie,
      motivos: new Map(),
      esVentaOffline: false,
    });
    expect(r).toEqual({ ok: false, indice: 1 });
  });

  it("pide motivo para el que sobra: se venden 3 y solo 2 tienen IMEI", () => {
    const r = resolverAparatosSinImei({
      renglones: [{ varianteId: celular, cantidad: 3, aparatosConImei: 2 }],
      llevaSerie,
      motivos: new Map(),
      esVentaOffline: false,
    });
    expect(r).toEqual({ ok: false, indice: 0 });
  });

  it("con motivo, lo deja para el renglón", () => {
    const r = resolverAparatosSinImei({
      renglones: [{ varianteId: celular, cantidad: 1, aparatosConImei: 0 }],
      llevaSerie,
      motivos: new Map([[celular, "Aparato en caja sellada"]]),
      esVentaOffline: false,
    });
    expect(r).toEqual({
      ok: true,
      motivoPorRenglon: new Map([[0, "Aparato en caja sellada"]]),
    });
  });

  it("offline sin motivo: se graba como pendiente (null), no se rechaza", () => {
    const r = resolverAparatosSinImei({
      renglones: [{ varianteId: celular, cantidad: 1, aparatosConImei: 0 }],
      llevaSerie,
      motivos: new Map(),
      esVentaOffline: true,
    });
    expect(r).toEqual({ ok: true, motivoPorRenglon: new Map([[0, null]]) });
  });

  it("venta libre (sin variante) no aplica", () => {
    const r = resolverAparatosSinImei({
      renglones: [{ varianteId: null, cantidad: 1, aparatosConImei: 0 }],
      llevaSerie,
      motivos: new Map(),
      esVentaOffline: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe("parsearMotivosSinImei", () => {
  it("lee el payload del POS", () => {
    expect(
      parsearMotivosSinImei(
        JSON.stringify([{ varianteId: celular, motivo: "  Sin  conexión " }]),
      ),
    ).toEqual(new Map([[celular, "Sin conexión"]]));
  });

  it("ignora lo mal formado y los motivos vacíos", () => {
    expect(parsearMotivosSinImei("no es json")).toEqual(new Map());
    expect(parsearMotivosSinImei(JSON.stringify({ a: 1 }))).toEqual(new Map());
    expect(
      parsearMotivosSinImei(
        JSON.stringify([
          { varianteId: celular, motivo: "   " },
          { varianteId: 3, motivo: "x" },
          null,
        ]),
      ),
    ).toEqual(new Map());
    expect(parsearMotivosSinImei(null)).toEqual(new Map());
  });
});

describe("normalizarMotivoSinImei", () => {
  it("recorta al largo de la columna (check de 1 a 200)", () => {
    expect(normalizarMotivoSinImei("x".repeat(500))?.length).toBe(MOTIVO_SIN_IMEI_MAX);
    expect(normalizarMotivoSinImei(42)).toBeNull();
  });
});
