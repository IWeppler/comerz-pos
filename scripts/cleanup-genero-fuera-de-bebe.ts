import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// .env.local primero — mismo criterio que scripts/backfill-image-thumbnails.ts:
// este script apunta a UN proyecto puntual (hoy estilobonito), independiente
// de a qué esté apuntado .env por defecto para desarrollo. Si .env.local no
// gana acá, se corre contra el proyecto equivocado en silencio.
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (.env.local / .env).",
  );
  process.exit(1);
}

console.error(`>>> Proyecto destino: ${SUPABASE_URL}`);
console.error(
  ">>> Confirmá que es el correcto ANTES de seguir — este script escribe en producto_variantes y producto_variante_valores.\n",
);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const COMMIT = process.argv.includes("--commit");

// Decisión 2026-07-26 (ver AGENTS.md, "El GÉNERO no es un atributo de variante"): Género deja de ser
// atributo combinable para estas 4 audiencias — la categoría padre ya lo
// implica. Ropa Bebé es la ÚNICA excepción (Beba/Bebe/Unisex): nunca se toca.
const AUDIENCIAS_A_LIMPIAR = new Set([
  "Ropa Mujer",
  "Ropa Hombre",
  "Ropa Niña",
  "Ropa Niño",
]);
const NOMBRE_ATRIBUTO_GENERO = "Género";

type CategoriaRow = { id: string; nombre: string; parent_id: string | null };
type ProductoRow = { id: string; nombre: string; categoria_id: string | null };
type VarianteRow = {
  id: string;
  producto_id: string;
  nombre_display: string;
  atributos: Record<string, string> | null;
};

async function fetchAll<T>(
  table: string,
  select: string,
  pageSize = 1000,
): Promise<T[]> {
  let all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all = all.concat(data as T[]);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function resolverAudienciaTopLevel(
  categoriaId: string | null,
  catById: Map<string, CategoriaRow>,
): string | null {
  if (!categoriaId) return null;
  let cat = catById.get(categoriaId);
  if (!cat) return null;
  let guard = 0;
  while (cat.parent_id && guard++ < 5) {
    const padre = catById.get(cat.parent_id);
    if (!padre) break;
    cat = padre;
  }
  return cat.nombre;
}

async function main() {
  const [categorias, productos, variantes, atributos] = await Promise.all([
    fetchAll<CategoriaRow>("categorias", "id, nombre, parent_id"),
    fetchAll<ProductoRow>("productos", "id, nombre, categoria_id"),
    fetchAll<VarianteRow>(
      "producto_variantes",
      "id, producto_id, nombre_display, atributos",
    ),
    fetchAll<{ id: string; nombre: string }>("atributos", "id, nombre"),
  ]);

  const generoAtributo = atributos.find((a) => a.nombre === NOMBRE_ATRIBUTO_GENERO);
  if (!generoAtributo) {
    console.error(`No existe el atributo "${NOMBRE_ATRIBUTO_GENERO}" en esta base — nada que limpiar.`);
    return;
  }

  const catById = new Map(categorias.map((c) => [c.id, c]));
  const productoById = new Map(productos.map((p) => [p.id, p]));

  const candidatas: VarianteRow[] = [];
  const enBebe: VarianteRow[] = [];
  const pendientesSinCategoria: VarianteRow[] = [];
  const otraAudiencia: VarianteRow[] = [];

  for (const v of variantes) {
    const atrs = v.atributos ?? {};
    if (!Object.prototype.hasOwnProperty.call(atrs, NOMBRE_ATRIBUTO_GENERO)) continue;

    const producto = productoById.get(v.producto_id);
    const top = producto
      ? resolverAudienciaTopLevel(producto.categoria_id, catById)
      : null;

    if (!producto?.categoria_id) {
      pendientesSinCategoria.push(v);
    } else if (top === "Ropa Bebe" || top === "Ropa Bebé") {
      enBebe.push(v);
    } else if (top && AUDIENCIAS_A_LIMPIAR.has(top)) {
      candidatas.push(v);
    } else {
      otraAudiencia.push(v);
    }
  }

  // Colisión: si dos variantes del MISMO producto quedarían con atributos
  // idénticos tras sacar Género, no se tocan — se reportan aparte para
  // resolución manual. Nunca se borra ni fusiona una variante acá.
  const restoPorProducto = new Map<string, Map<string, string[]>>();
  for (const v of candidatas) {
    const { [NOMBRE_ATRIBUTO_GENERO]: _genero, ...resto } = v.atributos ?? {};
    const key = JSON.stringify(
      Object.entries(resto).sort(([a], [b]) => a.localeCompare(b)),
    );
    if (!restoPorProducto.has(v.producto_id))
      restoPorProducto.set(v.producto_id, new Map());
    const mapa = restoPorProducto.get(v.producto_id)!;
    if (!mapa.has(key)) mapa.set(key, []);
    mapa.get(key)!.push(v.id);
  }

  const idsEnColision = new Set<string>();
  for (const mapa of restoPorProducto.values()) {
    for (const ids of mapa.values()) {
      if (ids.length > 1) ids.forEach((id) => idsEnColision.add(id));
    }
  }

  const aProcesar = candidatas.filter((v) => !idsEnColision.has(v.id));
  const enColision = candidatas.filter((v) => idsEnColision.has(v.id));

  console.log("=== DIAGNÓSTICO — limpieza de Género fuera de Ropa Bebé ===\n");
  console.log(`Total producto_variantes en la base: ${variantes.length}`);
  console.log(`Variantes con clave "${NOMBRE_ATRIBUTO_GENERO}": ${variantes.filter((v) => v.atributos && NOMBRE_ATRIBUTO_GENERO in v.atributos).length}`);
  console.log(`  - En Ropa Bebé (se mantiene, NO se toca): ${enBebe.length}`);
  console.log(
    `  - En Mujer/Hombre/Niña/Niño (a limpiar): ${candidatas.length} variantes, ${new Set(candidatas.map((v) => v.producto_id)).size} productos`,
  );
  console.log(
    `    - de las cuales en colisión (2+ variantes del mismo producto quedarían iguales): ${enColision.length} — se EXCLUYEN, requieren revisión manual`,
  );
  console.log(`    - a procesar: ${aProcesar.length}`);
  console.log(
    `  - En productos SIN categoria_id todavía (pendientes de reasignar, se SALTEAN): ${pendientesSinCategoria.length} variantes, ${new Set(pendientesSinCategoria.map((v) => v.producto_id)).size} productos`,
  );
  console.log(
    `  - En otra audiencia fuera de alcance (ej. Accesorios): ${otraAudiencia.length} variantes, ${new Set(otraAudiencia.map((v) => v.producto_id)).size} productos`,
  );

  if (enColision.length > 0) {
    console.log("\n--- Variantes en colisión (no se tocan) ---");
    for (const v of enColision) {
      console.log(`  ${v.id} (producto ${v.producto_id}): ${v.nombre_display}`);
    }
  }

  if (pendientesSinCategoria.length > 0) {
    const productosIds = [...new Set(pendientesSinCategoria.map((v) => v.producto_id))];
    console.log("\n--- Productos pendientes de categoría (no tocados) ---");
    for (const id of productosIds) {
      console.log(`  ${id}: ${productoById.get(id)?.nombre ?? "?"}`);
    }
  }

  if (!COMMIT) {
    console.log(
      `\n[DRY-RUN] No se escribió nada. Para aplicar: node --experimental-strip-types scripts/cleanup-genero-fuera-de-bebe.ts --commit`,
    );
    return;
  }

  console.log(`\n>>> COMMIT: modificando ${aProcesar.length} variantes...`);

  const totalVariantesAntes = variantes.length;
  const totalProductosAntes = productos.length;

  let ok = 0;
  let fallidas = 0;
  for (const v of aProcesar) {
    const { [NOMBRE_ATRIBUTO_GENERO]: _genero, ...resto } = v.atributos ?? {};

    const { error: errUpdate } = await supabase
      .from("producto_variantes")
      .update({ atributos: resto })
      .eq("id", v.id);

    if (errUpdate) {
      console.error(`  FALLÓ update atributos variante ${v.id}: ${errUpdate.message}`);
      fallidas++;
      continue;
    }

    const { error: errDelete } = await supabase
      .from("producto_variante_valores")
      .delete()
      .eq("variante_id", v.id)
      .eq("atributo_id", generoAtributo.id);

    if (errDelete) {
      console.error(`  FALLÓ delete producto_variante_valores variante ${v.id}: ${errDelete.message}`);
      fallidas++;
      continue;
    }

    ok++;
  }

  const { count: totalVariantesDespues } = await supabase
    .from("producto_variantes")
    .select("id", { count: "exact", head: true });
  const { count: totalProductosDespues } = await supabase
    .from("productos")
    .select("id", { count: "exact", head: true });

  console.log(`\nOK: ${ok}, fallidas: ${fallidas}`);
  console.log(
    `Conteo producto_variantes antes/después: ${totalVariantesAntes} / ${totalVariantesDespues} (debe ser IGUAL)`,
  );
  console.log(
    `Conteo productos antes/después: ${totalProductosAntes} / ${totalProductosDespues} (debe ser IGUAL)`,
  );
  if (totalVariantesDespues !== totalVariantesAntes || totalProductosDespues !== totalProductosAntes) {
    console.error(
      "\n¡ALERTA! Los conteos cambiaron — esto NO debería pasar (el script solo edita atributos, nunca borra filas de producto_variantes ni productos). Investigar antes de confiar en el resultado.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
