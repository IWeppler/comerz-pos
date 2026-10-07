import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("el cupón del catálogo sobrevive a recargar el módulo desde localStorage", async () => {
  const valores = new Map<string, string>();
  const storage = {
    getItem: (clave: string) => valores.get(clave) ?? null,
    setItem: (clave: string, valor: string) => valores.set(clave, valor),
    removeItem: (clave: string) => valores.delete(clave),
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.resetModules();
  const { useCartStore } = await import("./cart-store");
  const cupon = { slug: "tienda-uno", codigo: "VERANO10", promocion: { id: "promo", nombre: "Verano", tipo_regla: null, tipo_descuento: "PORCENTAJE", valor_descuento: 10, monto_minimo: 0 } };
  useCartStore.getState().setCuponCatalogo(cupon);
  expect(JSON.parse(valores.get("vivero-tostado-storage")!).state.cuponCatalogo).toEqual(cupon);
  vi.resetModules();
  const recargado = await import("./cart-store");
  expect(recargado.useCartStore.getState().cuponCatalogo).toEqual(cupon);
});
