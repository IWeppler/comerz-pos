import { describe, expect, it } from "vitest";
import { categoriaPideImeiPorNombre } from "./categoria-pide-imei";

// Mismos casos que los guards de 20261007140000 (categoria_pide_imei_por_nombre).
const SI = [
  "Celulares",
  "celular",
  "SMARTPHONES",
  "Tablets",
  "Celulares y Tablets",
  "Teléfonos Celulares",
  "Móviles",
  "  celulares  ",
];
const NO = [
  "Accesorios para celulares",
  "Fundas de tablet",
  "Televisores",
  "Aires Acondicionados",
  "Auriculares",
  "Telefonos",
  "",
  null,
];

describe("categoriaPideImeiPorNombre (espejo de SQL)", () => {
  it.each(SI)("'%s' pide IMEI", (nombre) => {
    expect(categoriaPideImeiPorNombre(nombre)).toBe(true);
  });

  it.each(NO)("'%s' no pide IMEI", (nombre) => {
    expect(categoriaPideImeiPorNombre(nombre)).toBe(false);
  });
});
