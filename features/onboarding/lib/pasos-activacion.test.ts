import { describe, expect, it } from "vitest";
import {
  calcularProgresoActivacion,
  type EstadoActivacion,
} from "./pasos-activacion";
const nuevo: EstadoActivacion = {
  rubro: "indumentaria",
  marca: false,
  metodos_pago: true,
  productos: false,
  stock_y_precios: false,
  empleados: false,
  catalogo_publicado: false,
  caja: false,
  primera_venta: false,
  venta_libre_elegida: false,
};
describe("activación autónoma", () => {
  it("recién creado cuenta 1 de 4 y propone elegir camino", () => {
    const p = calcularProgresoActivacion(nuevo);
    expect([p.completados, p.total, p.activado]).toEqual([1, 4, false]);
    expect(p.siguiente?.accion).toBe("elegir-camino");
  });
  it("venta libre cumple productos sin catálogo", () => {
    const p = calcularProgresoActivacion({
      ...nuevo,
      venta_libre_elegida: true,
    });
    expect(p.completados).toBe(2);
    expect(p.siguiente?.clave).toBe("caja");
    expect(
      p.pasos.find((paso) => paso.clave === "primera_venta")?.detalle,
    ).toContain("Venta libre");
  });
  it("productos necesita precio y stock", () => {
    expect(
      calcularProgresoActivacion({ ...nuevo, productos: true }).completados,
    ).toBe(1);
    expect(
      calcularProgresoActivacion({
        ...nuevo,
        productos: true,
        stock_y_precios: true,
      }).completados,
    ).toBe(2);
  });
  it("una venta activa aunque falten pasos", () => {
    expect(
      calcularProgresoActivacion({ ...nuevo, primera_venta: true }).activado,
    ).toBe(true);
  });
  it("los opcionales no cuentan", () => {
    const p = calcularProgresoActivacion({
      ...nuevo,
      marca: true,
      empleados: true,
      catalogo_publicado: true,
    });
    expect(p.completados).toBe(1);
    expect(
      p.pasos.filter((paso) => paso.opcional).map((paso) => paso.clave),
    ).toEqual(["marca", "empleados", "catalogo_publicado"]);
  });
});
