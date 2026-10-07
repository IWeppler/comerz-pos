import { describe, expect, it } from "vitest";
import { elegirParaEnvioGratis } from "./completar-envio-gratis";
import type { Producto } from "@/entities/productos/types";
import type { CartItemStore } from "@/entities/cart/types";
const producto = (id: string, precio: number, stock = 5): Producto => ({ id, nombre: id, tipo: "Ropa", categoria_id: null, precio, slug: id, publicado: true, creado_en: "2026-10-07", imagen_url: null, grid_url: null, producto_variantes: [{ id: `v-${id}`, nombre_display: "Único", precio: null, stock }] });
const items: CartItemStore[] = [{ productoId: "carrito", varianteId: "v-carrito", nombre: "Carrito", tipo: "Ropa", variante: "Único", precio: 8000, cantidad: 1, stockMaximo: 10 }];
const elegir = (productos: Producto[], extra = {}) => elegirParaEnvioGratis({ productos, items, promociones: [], opcionPago: null, config: { envio_gratis_desde_monto: 10000 }, ...extra });
describe("completar envío gratis", () => {
  it("elige el menor gasto que alcanza el beneficio, no el precio más cercano por debajo", () => {
    expect(elegir([producto("corto", 1900), producto("justo", 2100), producto("caro", 9000)])[0].producto.id).toBe("justo");
  });
  it("sin uno que alcance, elige el que más reduce lo pendiente", () => {
    expect(elegir([producto("a", 500), producto("b", 1800)])[0]).toMatchObject({ producto: { id: "b" }, alcanza: false });
  });
  it("usa precio de variante y excluye falta de stock, inactivos y productos del carrito", () => {
    const propio = producto("propio", 100); propio.producto_variantes![0].precio = 2500;
    expect(elegir([propio, producto("agotado", 2000, 0), producto("carrito", 2000)])[0].precio).toBe(2500);
  });
  it("no sugiere un beneficio desactivado, ya alcanzado o local para un destino lejano", () => {
    expect(elegir([producto("a", 2100)], { config: null })).toEqual([]);
    expect(elegir([producto("a", 2100)], { config: { envio_gratis_desde_monto: 5000 } })).toEqual([]);
    expect(elegir([producto("a", 2100)], { destino: "LEJOS" })).toEqual([]);
  });
  it("por unidades elige el producto más barato que falta", () => {
    expect(elegir([producto("a", 3000), producto("b", 500)], { config: { envio_gratis_desde_unidades: 2 } })[0].producto.id).toBe("b");
  });
  it("sin carrito no inventa recomendaciones para alcanzar el envío", () => {
    expect(elegir([producto("a", 3000)], { items: [] })).toEqual([]);
  });
  it("recalcula el monto mínimo después del descuento elegido", () => {
    const resultado = elegir([producto("corto", 2100), producto("suficiente", 4000)], {
      promociones: [{ id: "promo", nombre: "10%", tipo_regla: "METODO_PAGO", tipo_descuento: "PORCENTAJE", valor_descuento: 10, monto_minimo: 0, mostrar_en_catalogo: true, promociones_metodos_pago: [{ metodo_pago: "EFECTIVO" }] }],
      opcionPago: { id: "efectivo", tipo: "EFECTIVO", etiqueta: "Efectivo", recargoPorcentaje: 0 },
    });
    expect(resultado[0]).toMatchObject({ producto: { id: "suficiente" }, alcanza: true });
    expect(resultado.find(c => c.producto.id === "corto")?.alcanza).toBe(false);
  });
  it("no promete una unidad de productos fraccionados ni usa variantes inactivas", () => {
    const peso = { ...producto("peso", 3000), unidad_medida: "KG" };
    const apagado = producto("apagado", 3000); apagado.producto_variantes![0].activa = false;
    expect(elegir([peso, apagado])).toEqual([]);
  });
});
