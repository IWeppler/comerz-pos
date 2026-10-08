import { expect, it } from "vitest";
import { pasoWizardInicio } from "./wizard-inicio";
import { caminosInicio } from "./caminos-inicio";
const base = {
  cajaAbierta: false,
  ventaLibreAbierta: false,
  ticketConLineas: false,
  primeraVenta: false,
  ruta: "/pos",
};
it("avanza por acciones reales", () => {
  expect(pasoWizardInicio({ ...base, cajaAbierta: null })).toBeNull();
  expect(pasoWizardInicio(base)).toBe("caja");
  expect(pasoWizardInicio({ ...base, cajaAbierta: true })).toBe("venta-libre");
  expect(
    pasoWizardInicio({ ...base, cajaAbierta: true, ventaLibreAbierta: true }),
  ).toBeNull();
  expect(
    pasoWizardInicio({ ...base, cajaAbierta: true, ticketConLineas: true }),
  ).toBe("cobrar");
  expect(pasoWizardInicio({ ...base, primeraVenta: true })).toBeNull();
  expect(pasoWizardInicio({ ...base, ruta: "/stock" })).toBeNull();
});
it("ofrece escaneo solo donde aplica y conserva el orden", () => {
  expect(caminosInicio("indumentaria").map((c) => c.hito)).toEqual([
    "CAMINO_VENTA_LIBRE",
    "CAMINO_IMPORTACION",
    "CAMINO_CARGA_MANUAL",
  ]);
  expect(caminosInicio("electro").map((c) => c.hito)).toEqual([
    "CAMINO_VENTA_LIBRE",
    "CAMINO_IMPORTACION",
    "CAMINO_CARGA_RAPIDA",
    "CAMINO_CARGA_MANUAL",
  ]);
  expect(caminosInicio("desconocido")).toHaveLength(3);
});
