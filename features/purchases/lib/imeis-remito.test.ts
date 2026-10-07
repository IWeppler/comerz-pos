import { describe, expect, it } from "vitest";
import {
  aparatosSinImei,
  faltantesImei,
  imeisDeLinea,
  problemasImeis,
  totalFaltantes,
  type LineaConImei,
} from "./imeis-remito";

const linea = (extra: Partial<LineaConImei> = {}): LineaConImei => ({
  id: "i1",
  raw_nombre: "SAMSUNG A17",
  raw_variante: "Gris / 4/128gb",
  cantidad: 1,
  ...extra,
});

describe("imeisDeLinea", () => {
  it("junta el del Excel y los completados, normalizados", () => {
    expect(
      imeisDeLinea(
        linea({ raw_imei: " 35 1234 ", imeis_completados: ["abc 1", "", "  "] }),
      ),
    ).toEqual(["351234", "ABC1"]);
  });

  it("no deduplica: el repetido lo tiene que ver el guard", () => {
    expect(imeisDeLinea(linea({ raw_imei: "1", imeis_completados: ["1"] }))).toEqual([
      "1",
      "1",
    ]);
  });
});

describe("aparatosSinImei", () => {
  it("un renglón de 3 sin IMEI pide 3", () => {
    expect(aparatosSinImei(linea({ cantidad: 3 }))).toBe(3);
  });

  it("descuenta el del Excel y los completados", () => {
    expect(
      aparatosSinImei(linea({ cantidad: 3, raw_imei: "1", imeis_completados: ["2"] })),
    ).toBe(1);
  });

  it("usa lo recibido, no lo facturado", () => {
    expect(aparatosSinImei(linea({ cantidad: 3, cantidad_recibida: 2 }))).toBe(2);
  });

  it("un renglón 'no vino' no pide nada", () => {
    expect(aparatosSinImei(linea({ cantidad: 3, cantidad_recibida: 0 }))).toBe(0);
  });
});

describe("faltantesImei", () => {
  it("solo los que llevan IMEI, con cuántos faltan", () => {
    const celu = linea({ id: "c", cantidad: 2, imeis_completados: ["1"] });
    const funda = linea({ id: "f", raw_nombre: "Funda", cantidad: 10 });
    const completo = linea({ id: "k", raw_imei: "9" });
    const faltantes = faltantesImei([celu, funda, completo], (l) => l.id !== "f");
    expect(faltantes).toEqual([
      { itemId: "c", nombre: "SAMSUNG A17", variante: "Gris / 4/128gb", faltan: 1 },
    ]);
    expect(totalFaltantes(faltantes)).toBe(1);
  });
});

describe("problemasImeis", () => {
  it("más IMEI que unidades (espejo de REMITO_IMEIS_DE_MAS)", () => {
    expect(
      problemasImeis([linea({ cantidad: 1, imeis_completados: ["1", "2"] })]),
    ).toEqual(["SAMSUNG A17: 2 IMEI para 1 unidad."]);
  });

  it("el mismo IMEI en dos renglones (espejo de REMITO_IMEI_REPETIDO)", () => {
    expect(
      problemasImeis([
        linea({ id: "a", raw_imei: "35 1" }),
        linea({ id: "b", imeis_completados: ["351"] }),
      ]),
    ).toEqual(["El IMEI 351 está dos veces en el remito."]);
  });

  it("ignora los renglones que no vinieron", () => {
    expect(
      problemasImeis([
        linea({ cantidad: 1, cantidad_recibida: 0, raw_imei: "1", imeis_completados: ["2"] }),
      ]),
    ).toEqual([]);
  });

  it("sin problemas, vacío", () => {
    expect(
      problemasImeis([linea({ cantidad: 2, raw_imei: "1", imeis_completados: ["2"] })]),
    ).toEqual([]);
  });
});
