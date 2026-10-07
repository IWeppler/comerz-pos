import { traerTodo } from "@/shared/lib/traer-todo";

interface Pagina<T> { data: T[] | null; error: { message: string } | null; count?: number | null }

/** En precios nunca sirve una lectura parcial, tampoco al superar las 30 páginas. */
export async function leerCompleto<T>(etiqueta: string,
  pagina: (desde: number, hasta: number) => PromiseLike<Pagina<T>>) {
  let esperado: number | null = null;
  const res = await traerTodo(etiqueta, async (desde, hasta) => {
    const p = await pagina(desde, hasta);
    if (desde === 0) esperado = p.count ?? null;
    return p;
  });
  if (!res.error && (esperado === null || res.data.length !== esperado))
    return { ...res, data: [], error: "El catálogo cambió o supera el límite de lectura. Volvé a simular con un alcance menor." };
  return res;
}

export async function leerPorIds<T>(ids: string[],
  pagina: (lote: string[], desde: number, hasta: number) => PromiseLike<Pagina<T>>) {
  const data: T[] = [];
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 200) {
    const lote = unicos.slice(i, i + 200);
    const res = await leerCompleto("Ajustes por ids", (desde, hasta) => pagina(lote, desde, hasta));
    if (res.error) return { data: [], error: res.error };
    data.push(...res.data);
  }
  return { data, error: null };
}
