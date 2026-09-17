import { describe, expect, it } from "vitest";
import {
  resumirMetricasGlobales,
  type MetricasGlobalesCrudas,
  type NegocioGlobal,
} from "./metricas-globales";

const negocio = (
  extra: Partial<NegocioGlobal> & { id: string },
): NegocioGlobal => ({
  nombre: extra.id,
  estado: "activo",
  created_at: "2026-07-01T00:00:00Z",
  plan_id: "gestion",
  plan_nombre: "Gestión",
  plan_precio: 50000,
  rubro: "indumentaria",
  usuarios: 2,
  productos: 100,
  ventas: 10,
  facturado: 100000,
  ventas_30d: 5,
  facturado_30d: 50000,
  ultima_venta: "2026-09-10T00:00:00Z",
  ...extra,
});

const crudas: MetricasGlobalesCrudas = {
  negocios: [
    negocio({ id: "evens", plan_id: "gestion" }),
    negocio({ id: "bonito", plan_id: "gestion", rubro: "indumentaria" }),
    negocio({
      id: "click",
      plan_id: "emprendedor",
      plan_nombre: "Emprendedor",
      plan_precio: 30000,
      rubro: "electronica",
    }),
    negocio({
      id: "nono",
      estado: "prueba",
      plan_id: "prueba",
      plan_precio: 0,
      rubro: "cotillon",
      ventas: 0,
      facturado: 0,
      ventas_30d: 0,
      facturado_30d: 0,
      ultima_venta: null,
    }),
    negocio({ id: "kiosco-demo", estado: "demo", rubro: "quioscos", ventas: 999, facturado: 9e6 }),
    negocio({
      id: "viejo",
      estado: "cancelado",
      plan_id: null,
      plan_nombre: null,
      plan_precio: 0,
      ventas_30d: 0,
      facturado_30d: 0,
    }),
  ],
  planes: [
    { id: "prueba", nombre: "Prueba", precio_mensual: 0 },
    { id: "emprendedor", nombre: "Emprendedor", precio_mensual: 30000 },
    { id: "gestion", nombre: "Gestión", precio_mensual: 50000 },
    { id: "empresa", nombre: "Empresa", precio_mensual: 70000 },
  ],
  usuarios: { total: 20, activos_7d: 8, activos_30d: 15, por_rol: { ADMIN: 10, VENDEDOR: 10 } },
  catalogo: { productos: 500, variantes: 2000, clientes: 300, deuda_cc_viva: 123456 },
  ventas_por_mes: [{ mes: "2026-09", ventas: 40, facturado: 400000 }],
  generado_en: "2026-09-17T00:00:00Z",
};

describe("resumirMetricasGlobales", () => {
  const r = resumirMetricasGlobales(crudas);

  it("cuenta locales por estado; cliente = activo o prueba, sin demo ni cancelados", () => {
    expect(r.locales).toEqual({
      total: 6,
      activos: 3,
      enPrueba: 1,
      demos: 1,
      inactivos: 1,
      clientes: 4,
    });
  });

  it("reparte planes sobre los clientes, con los planes vacíos y 'Sin plan'", () => {
    const porEtiqueta = Object.fromEntries(
      r.planes.map((p) => [p.etiqueta, [p.cantidad, p.porcentaje]]),
    );
    // El cancelado sin plan no entra: no hay fila "Sin plan".
    expect(porEtiqueta).toEqual({
      Gestión: [2, 50],
      Emprendedor: [1, 25],
      Prueba: [1, 25],
      Empresa: [0, 0],
    });
  });

  it("MRR solo de los activos, a precio de lista", () => {
    expect(r.mrr).toBe(50000 + 50000 + 30000);
  });

  it("rubros comerciales de los clientes, sin demo ni cancelados", () => {
    expect(r.rubros.map((x) => [x.etiqueta, x.cantidad])).toEqual([
      ["Indumentaria y textil", 2],
      ["Cotillón y fiestas", 1],
      ["Electrónica y tecnología", 1],
    ]);
  });

  it("ventas totales sin el demo, con ticket promedio y quién no vende", () => {
    // Sin las 10 ventas del cancelado.
    expect(r.ventas.cantidad).toBe(30);
    expect(r.ventas.monto).toBe(300000);
    expect(r.ventas.ticketPromedio).toBe(10000);
    expect(r.ventas.negociosVendiendo30d).toBe(3);
    // El cancelado no vende, pero tampoco se lo espera: solo los habilitados.
    expect(r.ventas.negociosSinVender30d.map((n) => n.id)).toEqual(["nono"]);
  });

  it("usuarios: porcentaje activo y catálogo promedio", () => {
    expect(r.usuarios.porcentajeActivos30d).toBe(75);
    expect(r.catalogo.productosPorNegocio).toBe(125);
  });

  it("ranking por facturado sin el demo", () => {
    expect(r.ranking.map((n) => n.id)).not.toContain("kiosco-demo");
    expect(r.ranking.map((n) => n.id)).not.toContain("viejo");
    expect(r.ranking.length).toBe(4);
  });

  it("con cero negocios no divide por cero", () => {
    const vacio = resumirMetricasGlobales({
      ...crudas,
      negocios: [],
      usuarios: { total: 0, activos_7d: 0, activos_30d: 0, por_rol: {} },
      catalogo: { productos: 0, variantes: 0, clientes: 0, deuda_cc_viva: 0 },
    });
    expect(vacio.ventas.ticketPromedio).toBeNull();
    expect(vacio.catalogo.productosPorNegocio).toBeNull();
    expect(vacio.usuarios.porcentajeActivos30d).toBe(0);
    expect(vacio.planes.every((p) => p.porcentaje === 0)).toBe(true);
  });
});
