import { describe, it, expect } from "vitest";
import {
  nombreArchivoPlantilla,
  plantillaImportProductos,
} from "./plantilla-import-productos";
import { parseProductosSheet } from "./parse-productos-csv";
import type { Rubro } from "@/entities/config/types";

/** Todos los rubros que el sistema declara. Si se agrega uno al tipo y no
 * acá, el test de cobertura deja de cubrirlo — por eso está escrito a mano
 * y no derivado del catálogo que se está probando. */
const RUBROS: Rubro[] = [
  "indumentaria",
  "electro",
  "alimentos",
  "farmacia",
  "ferreteria",
  "quioscos",
  "cotillon",
  "pintureria",
  "otros",
];

/** Split naíf, alcanza porque la plantilla no tiene celdas con coma. */
function comoMatriz(csv: string): string[][] {
  return csv.split("\r\n").map((linea) => linea.split(","));
}

describe("plantillaImportProductos", () => {
  it("la plantilla de electro la parsea el mismo parser, sin columnas ignoradas", () => {
    const res = parseProductosSheet(comoMatriz(plantillaImportProductos("electro")));

    expect(res.error).toBeNull();
    expect(res.columnasIgnoradas).toEqual([]);
    expect(res.invalidas).toEqual([]);
    expect(res.filas).toHaveLength(3);
  });

  it("la de cotillón trae color y unidad de medida, y un ejemplo por kilo", () => {
    const csv = plantillaImportProductos("cotillon");
    const [encabezado, ...filas] = comoMatriz(csv);

    // Color parte variantes: es lo que separa a un cotillón de un kiosco.
    expect(encabezado).toContain("color");
    // Y la unidad de medida es lo que deja convivir la piñata por unidad con
    // los confites por kilo en el mismo mostrador.
    expect(encabezado).toContain("unidad_medida");
    expect(csv).toContain("Kilogramo");

    const res = parseProductosSheet(comoMatriz(csv));
    expect(res.error).toBeNull();
    expect(res.columnasIgnoradas).toEqual([]);
    expect(res.invalidas).toEqual([]);
    expect(res.filas).toHaveLength(filas.filter((f) => f.some(Boolean)).length);
  });

  it("la plantilla de indumentaria también", () => {
    const res = parseProductosSheet(
      comoMatriz(plantillaImportProductos("indumentaria")),
    );

    expect(res.error).toBeNull();
    expect(res.columnasIgnoradas).toEqual([]);
    expect(res.filas).toHaveLength(3);
  });

  it("electro muestra dos aparatos iguales con IMEI distinto, una unidad cada uno", () => {
    const { filas } = parseProductosSheet(
      comoMatriz(plantillaImportProductos("electro")),
    );
    const conImei = filas.filter((f) => f.imei);

    expect(conImei).toHaveLength(2);
    expect(conImei[0].producto).toBe(conImei[1].producto);
    expect(conImei[0].imei).not.toBe(conImei[1].imei);
    expect(conImei.every((f) => f.stock === 1)).toBe(true);
  });

  it("indumentaria no trae IMEI ni memoria: no aplican al rubro", () => {
    const { filas } = parseProductosSheet(
      comoMatriz(plantillaImportProductos("indumentaria")),
    );

    expect(filas.every((f) => f.imei === null)).toBe(true);
    expect(filas.every((f) => !("Memoria" in f.atributos))).toBe(true);
    expect(filas.every((f) => Boolean(f.atributos.Color))).toBe(true);
  });

  it("los ejemplos traen precio de venta: sin él una fila nueva se bloquea", () => {
    for (const rubro of ["electro", "indumentaria"] as const) {
      const { filas } = parseProductosSheet(
        comoMatriz(plantillaImportProductos(rubro)),
      );
      expect(filas.every((f) => (f.precioVenta ?? 0) > 0)).toBe(true);
    }
  });

  it("el nombre del archivo dice el rubro", () => {
    expect(nombreArchivoPlantilla("electro")).toBe(
      "plantilla-mercaderia-electro.csv",
    );
    expect(nombreArchivoPlantilla("carniceria" as never)).toBe(
      "plantilla-mercaderia-carniceria.csv",
    );
  });

  it("TODOS los rubros generan una plantilla que el parser entiende", () => {
    // Es la garantía que sostiene el catálogo por rubro: si alguien agrega una
    // columna a un rubro y el parser no la conoce, el comercio baja una
    // plantilla que su propia importación descarta. Acá salta.
    for (const rubro of RUBROS) {
      const res = parseProductosSheet(comoMatriz(plantillaImportProductos(rubro)), rubro);

      expect(res.error, `rubro ${rubro}`).toBeNull();
      expect(res.columnasIgnoradas, `rubro ${rubro}`).toEqual([]);
      expect(res.invalidas, `rubro ${rubro}`).toEqual([]);
      expect(res.filas.length, `rubro ${rubro}`).toBeGreaterThan(0);
    }
  });

  it("cada rubro trae SUS columnas y no las del otro", () => {
    const ferreteria = plantillaImportProductos("ferreteria").split("\r\n")[0];
    const indumentaria = plantillaImportProductos("indumentaria").split("\r\n")[0];

    expect(ferreteria).toContain("medida");
    expect(ferreteria).toContain("material");
    expect(ferreteria).not.toContain("talle");
    // La ropa de proveedor local rara vez trae EAN: una columna que siempre va
    // vacía enseña a ignorar columnas.
    expect(indumentaria).not.toContain("codigo_barras");
    expect(indumentaria).toContain("talle");
  });

  it("las columnas de variante se convierten en atributos", () => {
    const { filas } = parseProductosSheet(
      comoMatriz(plantillaImportProductos("ferreteria")),
    );

    expect(filas[0].atributos.Medida).toBeTruthy();
    expect(filas[0].atributos.Material).toBeTruthy();
  });

  it("un producto en dos variantes son dos filas con el mismo nombre", () => {
    // Es la regla que la plantilla tiene que enseñar sola, en todos los rubros
    // que tienen variantes.
    for (const rubro of ["indumentaria", "ferreteria", "farmacia"] as const) {
      const { filas } = parseProductosSheet(
        comoMatriz(plantillaImportProductos(rubro)),
      );
      const nombres = filas.map((f) => f.producto);
      const repetido = nombres.find(
        (n, i) => nombres.indexOf(n) !== i,
      );
      expect(repetido, `rubro ${rubro}`).toBeTruthy();
    }
  });
});
