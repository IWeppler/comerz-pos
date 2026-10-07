import { describe, expect, it } from "vitest";
import { calcularTotalesPedido, progresoEnvioGratis } from "./totales-pedido-publico";
import type { CartItemStore } from "@/entities/cart/types";
import type { PromocionDB } from "@/shared/components/cart-sidebar/types";
import { generarLinkWhatsAppPublico } from "@/shared/components/cart-sidebar/cart-sidebar-utils";
const item: CartItemStore = { productoId: "p", nombre: "Remera", tipo: "", variante: "", cantidad: 2, precio: 1000, stockMaximo: 20 };
const pago = { tipo: "EFECTIVO" as const, etiqueta: "Efectivo", recargoPorcentaje: 0 };
const promo: PromocionDB = { id: "promo", nombre: "OFF", tipo_regla: null, tipo_descuento: "PORCENTAJE", valor_descuento: 10, monto_minimo: 0, mostrar_en_catalogo: true };

describe("envío gratis", () => {
  it("null o cero no activa el beneficio ni el carrito vacío lo alcanza", () => {
    expect(progresoEnvioGratis({ items: [item], base: 2000 }).aplica).toBe(false);
    expect(progresoEnvioGratis({ items: [item], base: 2000, config: { envio_gratis_desde_monto: 0 } }).aplica).toBe(false);
    expect(progresoEnvioGratis({ items: [], base: 2000, config: { envio_gratis_desde_monto: 1000 } }).alcanzado).toBe(false);
  });
  it("calcula monto faltante y limita la barra al 100%", () => {
    expect(progresoEnvioGratis({ items: [item], base: 2000, config: { envio_gratis_desde_monto: 2500 } })).toMatchObject({ faltaMonto: 500, porcentaje: 80, alcanzado: false });
    expect(progresoEnvioGratis({ items: [item], base: 3000, config: { envio_gratis_desde_monto: 2500 } })).toMatchObject({ faltaMonto: 0, porcentaje: 100, alcanzado: true });
  });
  it("cada renglón por peso cuenta uno; por unidad suma cantidades", () => {
    expect(progresoEnvioGratis({ items: [item, { ...item, productoId: "peso", unidadMedida: "KG", cantidad: .75 }], base: 2750, config: { envio_gratis_desde_unidades: 4 } })).toMatchObject({ faltaUnidades: 1, porcentaje: 75 });
  });
  it("los dos criterios son alternativas y se usa el progreso mayor", () => {
    expect(progresoEnvioGratis({ items: [item], base: 2000, config: { envio_gratis_desde_monto: 10000, envio_gratis_desde_unidades: 3 } }).porcentaje).toBeCloseTo(200 / 3);
    expect(progresoEnvioGratis({ items: [item], base: 2000, config: { envio_gratis_desde_monto: 10000, envio_gratis_desde_unidades: 2 } }).alcanzado).toBe(true);
  });
  it("usa mercadería después del descuento; no suma recargo ni flete", () => {
    const total = calcularTotalesPedido({ items: [item], promociones: [promo], opcionPago: { ...pago, recargoPorcentaje: 20 }, costoEnvio: 500, configEnvio: { envio_gratis_desde_monto: 1900 }, destinoEnvio: "LOCAL" });
    expect(total.total).toBe(2660);
    expect(total.envio?.monto).toBe(500);
  });
  it.each([ ["LOCAL", "LOCAL", true], ["LOCAL", "LEJOS", false], ["TODOS", "LEJOS", true], ["TODOS", null, false] ] as const)("alcance %s destino %s: gratis %s", (alcance, destino, gratis) => {
    const total = calcularTotalesPedido({ items: [item], promociones: [], opcionPago: pago, costoEnvio: destino === "LOCAL" ? 500 : 0, configEnvio: { envio_gratis_desde_monto: 2000, envio_gratis_alcance: alcance }, destinoEnvio: destino });
    expect(total.envio?.etiqueta === "Envío gratis").toBe(gratis);
    if (gratis) expect(total.total).toBe(2000);
  });
  it("cupones compiten con las automáticas y respetan mínimos y prioridad", () => {
    const cupon = { ...promo, id: "cupon", codigo: "VERANO10", prioridad: 10 };
    expect(calcularTotalesPedido({ items: [item], promociones: [promo, cupon], opcionPago: pago }).promosAplicadas.map(p => p.id)).toEqual(["cupon"]);
    expect(calcularTotalesPedido({ items: [item], promociones: [{ ...cupon, monto_minimo: 3000 }], opcionPago: pago }).descuento).toBeNull();
    expect(calcularTotalesPedido({ items: [item], promociones: [ { ...promo, acumulable: true }, { ...cupon, acumulable: true } ], opcionPago: pago }).descuento?.monto).toBe(400);
  });
  it("WhatsApp lleva el mismo total, cupón y envío gratis que el desglose", () => {
    const totales = calcularTotalesPedido({ items: [item], promociones: [{ ...promo, codigo: "VERANO10" }], opcionPago: pago, costoEnvio: 500, configEnvio: { envio_gratis_desde_unidades: 2 }, destinoEnvio: "LOCAL" });
    const mensaje = decodeURIComponent(generarLinkWhatsAppPublico({ numeroWhatsApp: "5491111111111", items: [item], totales, etiquetaPago: "Efectivo", nombreCliente: "Prueba", modalidad: "ENVIO", localidad: "Tostado", direccion: "Prueba 123" }).split("?text=")[1]);
    expect(mensaje).toContain("Cupón VERANO10: -$200");
    expect(mensaje).toContain("Envío: gratis");
    expect(mensaje).toContain("TOTAL: $1.800");
  });
});
