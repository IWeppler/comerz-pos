import { describe, expect, it } from "vitest";
import type { EstadoActivacion } from "./pasos-activacion";
import { pantallaPrimerosPasos } from "./primeros-pasos";

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

describe("pantalla de primeros pasos", () => {
  it("recién creado: arranca por los productos; vender está bloqueado hasta tenerlos", () => {
    const p = pantallaPrimerosPasos(nuevo);
    expect(p.titulo).toBe("Empezá por tus productos");
    expect([p.completados, p.total]).toEqual([1, 4]);
    expect(p.grandes.map((t) => [t.clave, t.siguiente, t.accion])).toEqual([
      ["productos", true, "elegir-camino"],
      ["vender", false, undefined],
    ]);
    expect(p.grandes[1].bloqueado).toBe("Primero prepará tus productos");
  });

  it("con productos: la tarjeta queda hecha y ofrece seguir cargando; sigue vender (caja incluida)", () => {
    const p = pantallaPrimerosPasos({ ...nuevo, productos: true, stock_y_precios: true });
    expect(p.titulo).toBe("Ahora empezá a vender");
    expect(p.grandes[0]).toMatchObject({ hecho: true, cta: "Agregar otro producto", href: "/stock" });
    expect(p.grandes[0].accion).toBeUndefined();
    expect(p.grandes[1]).toMatchObject({ bloqueado: null, siguiente: true, href: "/pos", cta: "Ir a vender" });
  });

  it("con la caja ya abierta sigue siendo vender", () => {
    const p = pantallaPrimerosPasos({ ...nuevo, productos: true, stock_y_precios: true, caja: true });
    expect(p.titulo).toBe("Ahora empezá a vender");
    expect(p.grandes[1].siguiente).toBe(true);
  });

  it("venta libre cuenta como productos, pero el catálogo sigue vacío", () => {
    const p = pantallaPrimerosPasos({ ...nuevo, venta_libre_elegida: true });
    expect(p.grandes[0]).toMatchObject({ hecho: true, cta: "Cargar productos" });
    expect(p.grandes[1].bloqueado).toBeNull();
  });

  it("las chicas son opcionales: tienda online, datos del negocio y equipo", () => {
    const p = pantallaPrimerosPasos({ ...nuevo, catalogo_publicado: true });
    expect(p.chicas.map((t) => [t.clave, t.opcional, t.hecho])).toEqual([
      ["catalogo_publicado", true, true],
      ["marca", true, false],
      ["empleados", true, false],
    ]);
  });
});
