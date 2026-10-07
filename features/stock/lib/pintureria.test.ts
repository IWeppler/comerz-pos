import { describe, expect, it } from "vitest";
import { plantillaImportProductos } from "./plantilla-import-productos";
import { parseProductosSheet } from "./parse-productos-csv";
import { parseRemitoProveedor } from "@/features/purchases/lib/parse-remito-proveedor";
import { claveDeGrupo } from "@/features/purchases/lib/filas-carga-inicial";
import { planillaALineasDeRemito } from "./planilla-a-remito";
import { atributosInlineDeRubro } from "@/features/carga-rapida/lib/atributos-inline-por-rubro";
import { rubroUsaMarca } from "./marca-por-rubro";
import { rubroUsaReservas } from "@/features/pos/lib/reservas-por-rubro";
import { posSinImagenes } from "@/features/pos/lib/vista-por-rubro";
import { categoriaPorTerminos } from "@/features/purchases/lib/terminos-por-rubro";
import { rubroOperativoDesde } from "@/shared/lib/rubros";

describe("Pinturería", () => {
  it("ofrece capacidad y color inline, marca y lista, sin reservas", () => {
    expect(rubroOperativoDesde("pintureria")).toBe("pintureria");
    expect(atributosInlineDeRubro("pintureria").map((a) => a.clave)).toEqual(["capacidad", "color"]);
    expect(rubroUsaMarca("pintureria")).toBe(true);
    expect(rubroUsaReservas("pintureria")).toBe(false);
    expect(posSinImagenes("pintureria")).toBe(true);
  });
  it("la plantilla conserva todos los datos y declara el aguarrás por litro", () => {
    const matriz = plantillaImportProductos("pintureria").split("\r\n").map((l) => l.split(","));
    expect(matriz[0]).toEqual(expect.arrayContaining(["capacidad", "color", "acabado"]));
    expect(matriz[0]).not.toContain("talle");
    expect(matriz[0]).not.toContain("medida");
    const res = parseProductosSheet(matriz, "pintureria");
    expect(res.columnasIgnoradas).toEqual([]);
    expect(res.filas[0].atributos).toEqual({ Capacidad: "4 L", Color: "Blanco", Acabado: "Mate" });
    expect(res.filas[2].unidadMedida).toBe("Litro");
  });
  it.each(["capacidad", "litros", "lts", "contenido", "tamaño"])("reconoce %s en los dos importadores", (alias) => {
    const matriz = [["producto", alias, "color", "stock"], ["Látex interior", "4 L", "Blanco", "2"], ["Látex interior", "10 L", "Blanco", "3"]];
    const res = parseProductosSheet(matriz, "pintureria");
    expect(res.filas.map((f) => f.atributos.Capacidad)).toEqual(["4 L", "10 L"]);
    expect(res.filas.every((f) => !f.atributos.Talle && !f.atributos.Memoria && !f.atributos.Peso)).toBe(true);
    const lineas = planillaALineasDeRemito(res.filas);
    expect(new Set(lineas.map(claveDeGrupo)).size).toBe(1);
    const remito = parseRemitoProveedor(matriz, "pintureria");
    expect(remito.filas.map((f) => f.raw_variante)).toEqual(["CAPACIDAD: 4 L / COLOR: Blanco", "CAPACIDAD: 10 L / COLOR: Blanco"]);
  });
  it("conserva los alias de electro e indumentaria", () => {
    expect(parseProductosSheet([["producto", "capacidad"], ["Celular", "128GB"]], "electro").filas[0].atributos.Memoria).toBe("128GB");
    expect(parseProductosSheet([["producto", "tamaño"], ["Remera", "M"]], "indumentaria").filas[0].atributos.Talle).toBe("M");
  });
  it.each([["latex interior alba 4l", "Látex"], ["esmalte sintetico", "Esmaltes"], ["barniz", "Barnices"],
    ["membrana", "Impermeabilizantes"], ["enduido", "Preparación"], ["aguarras", "Diluyentes"],
    ["pincel", "Herramientas"], ["esmalte aerosol", "Aerosoles"]])("sugiere categoría para %s", (nombre, categoria) => {
    expect(categoriaPorTerminos(nombre, "pintureria")).toBe(categoria);
  });
});
