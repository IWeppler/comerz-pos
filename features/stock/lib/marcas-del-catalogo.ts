export function normalizarMarca(texto: string | null | undefined): string | null {
  return texto?.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim() || null;
}

export interface MarcaCatalogo { clave: string; nombre: string; cantidad: number }

export function agruparMarcas(filas: { marca: string | null }[]): MarcaCatalogo[] {
  const grupos = new Map<string, { cantidad: number; escrituras: Map<string, number> }>();
  for (const { marca } of filas) {
    const clave = normalizarMarca(marca);
    if (!clave) continue;
    const grupo = grupos.get(clave) ?? { cantidad: 0, escrituras: new Map<string, number>() };
    const escritura = marca!.trim().replace(/\s+/g, " ");
    grupo.cantidad++;
    grupo.escrituras.set(escritura, (grupo.escrituras.get(escritura) ?? 0) + 1);
    grupos.set(clave, grupo);
  }
  return [...grupos].map(([clave, g]) => ({ clave, cantidad: g.cantidad,
    nombre: [...g.escrituras].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))[0][0],
  })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
