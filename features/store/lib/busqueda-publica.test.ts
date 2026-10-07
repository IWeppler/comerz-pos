import { describe, expect, it } from "vitest";
import type { Producto } from "@/entities/productos/types";
import { buscarEnCatalogoPublico, puedeBuscarSinNavegar, rutaBusquedaPublica } from "./busqueda-publica";

const producto = (props: Partial<Producto> = {}): Producto => ({
  id: "1", nombre: "Látex interior", tipo: "Pinturas", precio: 12000,
  imagen_url: null, grid_url: null, creado_en: "2026-10-07", publicado: true,
  slug: "latex", marca: "Alba", producto_variantes: [
    { id: "v1", nombre_display: "4 L", precio: null, stock: 2, sku: "779123" },
  ], ...props,
});

describe("buscador público", () => {
  it("comparte búsqueda sin acentos, marca y SKU con la grilla", () => {
    for (const q of ["LATEX", "álba", "779123"])
      expect(buscarEnCatalogoPublico([producto()], q).total).toBe(1);
  });
  it("no sugiere productos ocultos, sin ruta ni stock cuando el comercio los oculta", () => {
    const productos = [producto(), producto({ id: "2", publicado: false }),
      producto({ id: "3", slug: null }), producto({ id: "4", producto_variantes: [] })];
    expect(buscarEnCatalogoPublico(productos, "latex", { mostrar_sin_stock: false }).total).toBe(1);
    expect(buscarEnCatalogoPublico(productos, "latex").total).toBe(2);
  });
  it("muestra cuatro tarjetas pero cuenta el catálogo entero, incluso más de mil", () => {
    const productos = Array.from({ length: 1542 }, (_, i) => producto({ id: String(i) }));
    const resultado = buscarEnCatalogoPublico(productos, "latex");
    expect(resultado.total).toBe(1542);
    expect(resultado.productos).toHaveLength(4);
  });
  it("deduplica sugerencias normalizadas y no inventa búsquedas populares", () => {
    const resultado = buscarEnCatalogoPublico([producto(), producto({ nombre: "LATEX INTERIOR" })], "latex");
    expect(resultado.sugerencias).toEqual(["Látex interior"]);
    expect(buscarEnCatalogoPublico([producto()], "").sugerencias).toEqual([]);
  });
  it("limita las sugerencias a tres términos existentes para dejar los productos a la vista", () => {
    expect(buscarEnCatalogoPublico(Array.from({ length: 8 }, (_, i) => producto({ nombre: `Látex ${i}` })), "latex").sugerencias).toHaveLength(3);
  });
  it("prioriza nombre/código exacto, luego prefijo y entre iguales lo más reciente", () => {
    const productos = [producto({ id: "1", nombre: "Otro Látex", creado_en: "2026-10-07" }),
      producto({ id: "2", nombre: "Látex interior", creado_en: "2026-10-01" }),
      producto({ id: "3", nombre: "Látex exterior", creado_en: "2026-10-07" }),
      producto({ id: "4", nombre: "Látex", creado_en: "2025-01-01" })];
    expect(buscarEnCatalogoPublico(productos, "latex").productos.map(p => p.id)).toEqual(["4", "3", "2", "1"]);
  });
  it("sin coincidencias devuelve un estado vacío real", () => {
    expect(buscarEnCatalogoPublico([producto()], "inexistente")).toEqual({ total: 0, productos: [], sugerencias: [] });
  });
});

describe("navegación de búsqueda", () => {
  it("usa la ruta de la tienda y codifica la consulta sin heredar filtros", () => {
    expect(rutaBusquedaPublica("/store/evens", "  Alba & Color  ")).toBe("/store/evens?q=Alba+%26+Color");
    expect(rutaBusquedaPublica("/", "camión")).toBe("/?q=cami%C3%B3n");
    expect(rutaBusquedaPublica("/", " ")).toBe("/?ver=todo");
    expect(rutaBusquedaPublica("#", "camión")).toBe("#");
  });
  it.each(["/store/evens/latex", "/latex"])("desde ficha %s exige router, nunca reemplaza solo la URL", (ruta) => {
    expect(puedeBuscarSinNavegar(ruta, ruta.startsWith("/store") ? "/store/evens" : "/", new URLSearchParams())).toBe(false);
  });
  it.each(["categoria", "sub", "productos"])("quitar %s exige regenerar metadata", (param) => {
    expect(puedeBuscarSinNavegar("/store/evens", "/store/evens", new URLSearchParams({ [param]: "algo" }))).toBe(false);
  });
  it("desde portada usa History API tanto por path como con rewrite", () => {
    const params = new URLSearchParams("q=viejo&color=rojo&orden=menor_precio");
    expect(puedeBuscarSinNavegar("/store/evens", "/store/evens", params)).toBe(true);
    expect(puedeBuscarSinNavegar("/", "/", params)).toBe(true);
    expect(puedeBuscarSinNavegar("/store/evens", "/", params)).toBe(true);
  });
});
