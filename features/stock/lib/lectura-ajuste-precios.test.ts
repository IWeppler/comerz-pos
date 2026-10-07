import { expect, it } from "vitest";
import { leerCompleto, leerPorIds } from "./lectura-ajuste-precios";

it("lee los 1.542 productos antes de calcular", async () => {
  const filas = Array.from({ length: 1542 }, (_, id) => ({ id }));
  const res = await leerCompleto("prueba", async (desde, hasta) => ({ data: filas.slice(desde, hasta + 1), count: filas.length, error: null }));
  expect(res.error).toBeNull();
  expect(res.data).toEqual(filas);
});
it("no devuelve una simulación parcial si falla una página", async () => {
  const res = await leerCompleto("prueba", async (desde) => desde === 0
    ? { data: Array.from({ length: 1000 }, (_, id) => id), count: 1542, error: null }
    : { data: null, error: { message: "Falló la página" } });
  expect(res.data).toEqual([]);
  expect(res.error).toBe("Falló la página");
});
it("rechaza el truncamiento del guard de 30 páginas", async () => {
  const res = await leerCompleto("prueba", async () => ({ data: Array.from({ length: 1000 }, (_, id) => id), count: 31000, error: null }));
  expect(res.error).not.toBeNull();
  expect(res.data).toEqual([]);
});
it("parte ids en 200 y pagina también las variantes de cada lote", async () => {
  const ids = Array.from({ length: 501 }, (_, i) => String(i));
  const tamanos: number[] = [];
  const res = await leerPorIds(ids, async (lote, desde, hasta) => {
    tamanos.push(lote.length);
    const filas = lote.flatMap((id) => Array.from({ length: 7 }, (_, n) => `${id}:${n}`));
    return { data: filas.slice(desde, hasta + 1), count: filas.length, error: null };
  });
  expect(res.error).toBeNull();
  expect(Math.max(...tamanos)).toBe(200);
  expect(res.data).toHaveLength(3507);
});
