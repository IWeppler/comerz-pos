import { expect, it, vi } from "vitest";
import { detectarPrimeraVenta } from "./primera-venta";
it("festeja una vez y no vuelve a consultar", async () => {
  const datos = new Map<string, string>();
  const almacen = {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => {
      datos.set(k, v);
    },
  };
  const contar = vi.fn().mockResolvedValue(1);
  expect(await detectarPrimeraVenta("nuevo", almacen, contar)).toBe(true);
  expect(await detectarPrimeraVenta("nuevo", almacen, contar)).toBe(false);
  expect(contar).toHaveBeenCalledTimes(1);
});
it("no festeja negocios existentes ni mezcla negocios", async () => {
  expect(await detectarPrimeraVenta("viejo", null, async () => 40)).toBe(false);
  expect(await detectarPrimeraVenta("otro", null, async () => 1)).toBe(true);
});
it("un error no se convierte en una primera venta", async () => {
  expect(await detectarPrimeraVenta("error", null, async () => null)).toBe(
    false,
  );
  expect(await detectarPrimeraVenta("error", null, async () => 1)).toBe(true);
});
it("dos montajes simultáneos comparten la consulta (StrictMode)", async () => {
  const contar = vi.fn().mockResolvedValue(1);
  expect(
    await Promise.all([
      detectarPrimeraVenta("concurrente", null, contar),
      detectarPrimeraVenta("concurrente", null, contar),
    ]),
  ).toEqual([true, true]);
  expect(contar).toHaveBeenCalledTimes(1);
});
