/**
 * Parseo de la planilla de importación de productos (CSV / XLSX).
 *
 * Puro a propósito (sin Supabase, sin `File`): recibe una matriz de celdas
 * ya leída y devuelve filas tipadas. Así la detección de headers, el
 * criterio de IMEI y el parseo de números se testean sin auth ni base,
 * mismo patrón que parse-clientes-csv.ts.
 *
 * TODAS las columnas son opcionales salvo `producto`. Esa es la razón de
 * ser del módulo: una planilla de indumentaria (Evens, Estilo Bonito) trae
 * categoría/producto/color/stock y ninguna columna de electro, y tiene que
 * importar igual. Una columna ausente NO es un error — es una columna que
 * no aplica a ese rubro.
 */

import { redondearCantidad } from "@/shared/lib/unidad-venta";
import { ALIAS_COLUMNA_GENERO } from "@/shared/lib/alias-columna-genero";
import type { Rubro } from "@/entities/config/types";
import { esColumnaCapacidad } from "@/shared/lib/alias-capacidad";

/** Headers reconocidos por columna. El primero es el nombre "oficial". */
const ALIASES = {
  capacidad: ["litros", "lts"],
  acabado: ["acabado", "terminacion", "terminación"],
  // "subcategoria" es la MISMA columna: en un catálogo por audiencia
  // (Hombre > Camperas) lo que el comercio escribe en su planilla es el hijo,
  // y llamarlo "categoría" en la plantilla lo hace dudar de si va el padre.
  categoria: [
    "categoria",
    "categoría",
    "subcategoria",
    "subcategoría",
    "rubro",
  ],
  codigoBarras: ["codigo_barras", "codigo de barras", "codigobarras", "ean", "ean13", "codigo", "código"],
  producto: ["producto", "nombre", "descripcion", "descripción", "articulo", "artículo"],
  color: ["color", "colores"],
  memoria: ["memoria", "almacenamiento", "capacidad"],
  // Columnas de los otros rubros (ver columnas-por-rubro.ts). Se reconocen
  // TODAS acá y no según el rubro del comercio a propósito: una planilla
  // armada con la plantilla de otro rubro, o antes de cambiar de rubro, tiene
  // que entrar igual. Una columna de más nunca es un error.
  talle: ["talle", "talles", "tamaño", "tamano", "size"],
  medida: ["medida", "medidas", "dimension", "dimensión"],
  material: ["material", "materiales"],
  peso: ["peso", "volumen", "contenido", "gramaje"],
  presentacion: ["presentacion", "presentación", "formato"],
  marca: ["marca", "fabricante", "laboratorio"],
  modelo: ["modelo"],
  // El género NO es un atributo de variante: es a QUIÉN está destinada la
  // prenda, y en un catálogo de indumentaria eso es el nivel de arriba del
  // árbol de categorías (Hombre > Camperas, Nena > Remeras). Por eso viaja
  // como `raw_genero` hasta `resolverCategoriaImport`, que cruza género
  // (padre) con el tipo de prenda (hijo) — y no a `atributos`, donde
  // partiría cada producto en una variante por género.
  // La lista vive en shared: el importador de remitos tiene que reconocer las
  // MISMAS formas, y cuando eran dos listas separadas la columna "SEXO"
  // entraba por el remito como atributo libre (ver `alias-columna-genero.ts`).
  genero: ALIAS_COLUMNA_GENERO,
  unidadMedida: ["unidad_medida", "unidad", "unidad de medida"],
  stock: ["stock", "cantidad", "cant", "unidades"],
  imei: ["imei", "serie", "numero_serie", "nro_serie", "n_serie", "serial"],
  precioCosto: ["precio_costo", "preciocosto", "costo", "precio de costo", "precio compra", "precio_compra"],
  precioVenta: ["precio_venta", "precioventa", "precio de venta", "precio", "venta", "pvp"],
} as const;

type Columna = keyof typeof ALIASES;

/**
 * Normaliza un header para comparar: trim + lowercase + saca tildes +
 * colapsa espacios, guiones y guiones bajos. Así "Precio Venta",
 * "precio_venta" y "PRECIO-VENTA" matchean igual sin importar cómo haya
 * exportado la planilla de origen. Mismo criterio que parse-clientes-csv.
 */
function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/[\s\-_]+/g, "");
}

const ALIASES_NORMALIZADOS: Record<Columna, string[]> = Object.fromEntries(
  Object.entries(ALIASES).map(([k, v]) => [k, v.map(normalizeHeader)]),
) as Record<Columna, string[]>;

/**
 * Qué columnas de la planilla se convierten en atributos de variante. El
 * orden importa: define el orden de `nombre_display` ("Negro / 128GB").
 * Los nombres son los que van a `atributos` / `atributo_valores`; la
 * canonicalización final (casing contra lo que ya existe en la base) la
 * hace normalizarAtributoKeyValor del lado del server.
 */
export const COLUMNAS_ATRIBUTO: { columna: Columna; nombreAtributo: string }[] = [
  { columna: "capacidad", nombreAtributo: "Capacidad" },
  { columna: "acabado", nombreAtributo: "Acabado" },
  // El orden es el de lectura de una etiqueta: primero cómo se ve, después
  // cuánto mide, después de qué está hecho.
  { columna: "talle", nombreAtributo: "Talle" },
  { columna: "color", nombreAtributo: "Color" },
  { columna: "memoria", nombreAtributo: "Memoria" },
  { columna: "medida", nombreAtributo: "Medida" },
  { columna: "peso", nombreAtributo: "Peso" },
  { columna: "presentacion", nombreAtributo: "Presentación" },
  { columna: "material", nombreAtributo: "Material" },
];

export interface FilaImport {
  /** Número de fila en la planilla tal como lo ve el usuario en Excel (1-based, contando el header). */
  fila: number;
  categoria: string | null;
  codigoBarras: string | null;
  producto: string;
  /** {"Color": "Negro", "Memoria": "128GB"} — solo las columnas que vinieron con valor. */
  atributos: Record<string, string>;
  stock: number;
  imei: string | null;
  /** Datos que describen el producto sin partirlo en variantes. */
  marca: string | null;
  modelo: string | null;
  /** A quién va destinada la prenda (Hombre, Mujer, Nena, Niño, Bebé). No es
   * atributo de variante: resuelve la categoría PADRE. */
  genero: string | null;
  unidadMedida: string | null;
  precioCosto: number | null;
  precioVenta: number | null;
}

export interface FilaInvalida {
  fila: number;
  motivo: string;
}

export interface ParseProductosResult {
  /** Error global: no se pudo ni empezar a parsear (sin header, sin filas). */
  error: string | null;
  filas: FilaImport[];
  invalidas: FilaInvalida[];
  /** Columnas reconocidas, para que la UI muestre qué se va a importar y qué se ignoró. */
  columnasDetectadas: Columna[];
  columnasIgnoradas: string[];
}

function limpiarCelda(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().replace(/^["']|["']$/g, "");
}

/**
 * Parsea un número escrito por una persona en es-AR. Tolera "$", espacios,
 * separador de miles y coma decimal:
 *
 *   "$ 1.234,50" -> 1234.5      "1234.50" -> 1234.5
 *   "1,234.50"   -> 1234.5      "1.234"   -> 1234
 *
 * Regla: si aparecen los dos separadores, el ÚLTIMO es el decimal. Si
 * aparece uno solo y deja exactamente 3 dígitos a la derecha, se asume
 * miles ("1.234" es mil doscientos treinta y cuatro, no 1,234). Devuelve
 * null si no queda ningún dígito — nunca 0, para poder distinguir "celda
 * vacía" de "precio cero".
 */
export function parseNumeroLocal(raw: string): number | null {
  const limpio = raw.replace(/[^\d.,-]/g, "").trim();
  if (!limpio || !/\d/.test(limpio)) return null;

  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");

  let normalizado: string;
  if (ultimaComa !== -1 && ultimoPunto !== -1) {
    const decimal = ultimaComa > ultimoPunto ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    normalizado = limpio.split(miles).join("").replace(decimal, ".");
  } else if (ultimaComa !== -1 || ultimoPunto !== -1) {
    const sep = ultimaComa !== -1 ? "," : ".";
    const idx = ultimaComa !== -1 ? ultimaComa : ultimoPunto;
    const decimales = limpio.length - idx - 1;
    normalizado =
      decimales === 3
        ? limpio.split(sep).join("")
        : limpio.replace(sep, ".");
  } else {
    normalizado = limpio;
  }

  const n = Number.parseFloat(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parsea una matriz de celdas (ya venga de un CSV separado o de una hoja
 * de Excel) a filas de importación.
 *
 * El header se busca en las primeras filas y no necesariamente en la
 * primera: las planillas reales suelen traer un título o una fila en
 * blanco arriba. El ancla es la columna `producto`, que es la única
 * obligatoria.
 */
export function parseProductosSheet(rows: string[][], rubro?: Rubro): ParseProductosResult {
  const vacio = (r: ParseProductosResult) => r;

  if (!rows.length) {
    return vacio({
      error: "El archivo está vacío.",
      filas: [],
      invalidas: [],
      columnasDetectadas: [],
      columnasIgnoradas: [],
    });
  }

  // Buscar la fila de header: la primera (mirando hasta 20, por si hay
  // títulos arriba) que contenga un alias de `producto`.
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const celdas = rows[i].map((c) => normalizeHeader(limpiarCelda(c)));
    if (celdas.some((c) => ALIASES_NORMALIZADOS.producto.includes(c))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    return vacio({
      error:
        "No se encontró la columna 'producto' (o 'nombre') en el archivo. Es la única columna obligatoria.",
      filas: [],
      invalidas: [],
      columnasDetectadas: [],
      columnasIgnoradas: [],
    });
  }

  const headers = rows[headerIdx].map((c) =>
    esColumnaCapacidad(limpiarCelda(c), rubro) ? "litros" : normalizeHeader(limpiarCelda(c)),
  );

  // Índice de cada columna reconocida. -1 = no vino en la planilla, que es
  // un estado normal y no un error.
  const idx = {} as Record<Columna, number>;
  for (const columna of Object.keys(ALIASES) as Columna[]) {
    idx[columna] = headers.findIndex((h) =>
      ALIASES_NORMALIZADOS[columna].includes(h),
    );
  }

  // `codigo` es alias de codigoBarras y `precio` de precioVenta. Si la
  // planilla trae ambas columnas específicas y además la genérica, la
  // específica ya ganó por estar antes en la lista de aliases; no hace
  // falta desempatar acá.
  const columnasDetectadas = (Object.keys(ALIASES) as Columna[]).filter(
    (c) => idx[c] !== -1,
  );
  const indicesUsados = new Set(columnasDetectadas.map((c) => idx[c]));
  const columnasIgnoradas = rows[headerIdx]
    .map((c) => limpiarCelda(c))
    .filter((nombre, i) => nombre !== "" && !indicesUsados.has(i));

  const filas: FilaImport[] = [];
  const invalidas: FilaInvalida[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    // +1 porque el usuario ve la planilla 1-based en Excel.
    const numeroFila = i + 1;

    if (!row || row.every((c) => limpiarCelda(c) === "")) continue;

    const leer = (columna: Columna): string =>
      idx[columna] === -1 ? "" : limpiarCelda(row[idx[columna]]);

    const producto = leer("producto");
    if (!producto) {
      invalidas.push({
        fila: numeroFila,
        motivo: "Fila sin nombre de producto.",
      });
      continue;
    }

    const atributos: Record<string, string> = {};
    for (const { columna, nombreAtributo } of COLUMNAS_ATRIBUTO) {
      const valor = leer(columna);
      if (valor) atributos[nombreAtributo] = valor;
    }

    const imei = leer("imei") || null;
    const stockRaw = leer("stock");
    const stockParseado = stockRaw ? parseNumeroLocal(stockRaw) : null;

    // Un IMEI identifica UN aparato físico: la fila vale exactamente 1
    // unidad y la columna stock se ignora. Cargar 5 equipos son 5 filas,
    // una por IMEI. Se decide acá (y no en el server) para que el preview
    // muestre el mismo número que después se escribe.
    let stock: number;
    if (imei) {
      stock = 1;
    } else if (stockParseado === null) {
      // Sin columna stock o celda vacía: 1 es el default útil (planilla de
      // catálogo donde cada fila es un artículo), no 0, que dejaría todo el
      // import sin nada vendible.
      stock = 1;
    } else {
      // Era `Math.trunc`, que convertía "12,5 kg" en 12 sin decir nada. Ahora
      // se redondea al gramo, que es la resolución que guarda la base.
      stock = redondearCantidad(stockParseado);
    }

    if (!imei && stock < 0) {
      invalidas.push({
        fila: numeroFila,
        motivo: `Stock negativo (${stockRaw}).`,
      });
      continue;
    }

    const precioCostoRaw = leer("precioCosto");
    const precioVentaRaw = leer("precioVenta");

    filas.push({
      fila: numeroFila,
      categoria: leer("categoria") || null,
      codigoBarras: leer("codigoBarras") || null,
      producto,
      atributos,
      stock,
      imei,
      // Datos del PRODUCTO, no de la variante: no parten el producto en dos,
      // lo describen. Por eso no van a `atributos`.
      marca: leer("marca") || null,
      modelo: leer("modelo") || null,
      genero: leer("genero") || null,
      unidadMedida: leer("unidadMedida") || null,
      precioCosto: precioCostoRaw ? parseNumeroLocal(precioCostoRaw) : null,
      precioVenta: precioVentaRaw ? parseNumeroLocal(precioVentaRaw) : null,
    });
  }

  return {
    error: null,
    filas,
    invalidas,
    columnasDetectadas,
    columnasIgnoradas,
  };
}

/**
 * Detecta el separador de un CSV mirando la línea de header: tab (pegado
 * desde Excel/Sheets), punto y coma (export es-AR) o coma.
 */
export function detectarSeparador(linea: string): string {
  if (linea.includes("\t")) return "\t";
  if (linea.includes(";")) return ";";
  return ",";
}

/**
 * Convierte el texto crudo de un CSV a matriz de celdas, respetando
 * comillas dobles (un nombre de producto con coma adentro es común:
 * "Smart TV 50\", 4K").
 */
export function csvARows(texto: string): string[][] {
  const limpio = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const lineas = limpio.split(/\r?\n/);
  const primeraConDatos = lineas.find((l) => l.trim() !== "") ?? "";
  const separador = detectarSeparador(primeraConDatos);

  const rows: string[][] = [];
  let campos: string[] = [];
  let actual = "";
  let enComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];

    if (enComillas) {
      if (c === '"') {
        // Comilla escapada dentro de campo entrecomillado.
        if (limpio[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          enComillas = false;
        }
      } else {
        actual += c;
      }
      continue;
    }

    if (c === '"') {
      enComillas = true;
    } else if (c === separador) {
      campos.push(actual);
      actual = "";
    } else if (c === "\n") {
      campos.push(actual);
      rows.push(campos);
      campos = [];
      actual = "";
    } else if (c !== "\r") {
      actual += c;
    }
  }

  if (actual !== "" || campos.length > 0) {
    campos.push(actual);
    rows.push(campos);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
