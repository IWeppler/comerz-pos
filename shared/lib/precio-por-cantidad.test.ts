import { describe, expect, it } from "vitest";
import { claveCantidad, leerTramosCantidad, precioPorCantidad, retarifarPorCantidad, validarTramosCantidad } from "./precio-por-cantidad";

const tramos = [{ desde: 10, precio: 220 }, { desde: 50, precio: 200 }, { desde: 100, precio: 180 }];
const linea = (varianteId = "simple") => ({ productoId: "a4", varianteId, variante: varianteId, cantidad: 1, precio: 250, tramoCantidadDesde: null as number | null, preciosPorCantidad: tramos });

describe("precio unitario por tramo de cantidad", () => {
  it.each([[1,250],[9,250],[10,220],[12,220],[49,220],[50,200],[99,200],[100,180],[1000,180]])("%s unidades a $%s cada una", (cantidad, precio) => {
    expect(precioPorCantidad(250, cantidad, tramos).precio).toBe(precio);
  });
  it("aplica a todas las unidades y reemplaza la lista, sin multiplicar descuentos", () => {
    expect(precioPorCantidad(230, 12, tramos).precio * 12).toBe(2640);
    expect(precioPorCantidad(230, 9, tramos).precio * 9).toBe(2070);
    expect(precioPorCantidad(250, 10, tramos).precio * 10).toBe(2200);
  });
  it("mantiene precisión monetaria y acepta un tramo desde 1", () => {
    expect(validarTramosCantidad([{ desde: 1, precio: 0.29 }])).toBe(true);
    expect(precioPorCantidad(250, 1, [{ desde: 1, precio: 220 }])).toEqual({ precio: 220, desde: 1 });
  });
  it.each([null, {}, [{}], [{desde:1,precio:0}], [{desde:1,precio:-1}], [{desde:1,precio:NaN}], [{desde:1,precio:Infinity}], [{desde:1.5,precio:220}], [{desde:0,precio:220}], [{desde:10,precio:220},{desde:9,precio:210}], [{desde:10,precio:220},{desde:10,precio:210}], [{desde:1,precio:0.001}], [{desde:1,precio:1.00000000001}], [{desde:1,precio:"220"}], [{desde:1,precio:220,extra:true}], Array.from({length:21}, (_,i)=>({desde:i+1,precio:220}))])("rechaza configuración inválida %j", (entrada) => {
    expect(validarTramosCantidad(entrada)).toBe(false);
    expect(precioPorCantidad(250, 100, entrada as typeof tramos).precio).toBe(250);
  });
  it("distingue campo ausente, borrado e inválido", () => {
    const form = new FormData();
    expect(leerTramosCantidad(form)).toBeNull();
    form.set("precios_por_cantidad", "[]"); expect(leerTramosCantidad(form)).toEqual([]);
    form.set("precios_por_cantidad", "no-json"); expect(() => leerTramosCantidad(form)).toThrow();
    form.set("precios_por_cantidad", '[{"desde":1,"precio":0}]'); expect(() => leerTramosCantidad(form)).toThrow();
  });
  it("agrupa líneas duplicadas sin sumar variantes, productos o presentaciones", () => {
    const items = retarifarPorCantidad([
      { ...linea(), cantidad: 6 }, { ...linea(), cantidad: 6 },
      { ...linea("doble"), cantidad: 6 }, { ...linea(), productoId: "oficio", cantidad: 6 },
      { ...linea(), presentacionId: "pack", cantidad: 100, precio: 1800 },
      { ...linea(), ventaLibre: true, cantidad: 100 },
    ]);
    expect(items.map(i => i.precio)).toEqual([220,220,250,250,1800,250]);
    expect(claveCantidad(linea())).not.toBe(claveCantidad(linea("doble")));
  });
  it("restaura el precio habitual al bajar del primer tramo sin aplicar sobre el precio reducido", () => {
    const [conTramo] = retarifarPorCantidad([{ ...linea(), cantidad: 12 }]);
    expect(retarifarPorCantidad([conTramo])[0]).toBe(conTramo);
    const [sinTramo] = retarifarPorCantidad([{ ...conTramo, cantidad: 9 }]);
    expect(sinTramo.precio).toBe(250);
    expect(sinTramo.tramoCantidadDesde).toBeNull();
  });
  it("suma fracciones al gramo sin perder un umbral por colas binarias", () => {
    const items = retarifarPorCantidad(Array.from({length:100},()=>({...linea(),cantidad:0.1})));
    expect(items.every(i=>i.precio===220)).toBe(true);
  });
  it("una regla nueva limpia un importe fijado y recupera el precio habitual", () => {
    const [item] = retarifarPorCantidad([{...linea(),cantidad:12,precio:1000/12,
      precioBase:250,precioBaseEfectivo:250,importeFijado:1000,precioSinImporte:250}]);
    expect(item.precio).toBe(220);
    expect(item.importeFijado).toBeNull();
    expect(item.precioSinImporte).toBeNull();
  });
});
