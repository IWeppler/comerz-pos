import { parsearCantidadDeEntrada } from "@/shared/lib/unidad-venta";
import { parseNumeroLocal } from "@/features/stock/lib/parse-productos-csv";
import {
  clasificarColumnaIngreso,
  esColumnaDeTotal,
  type CampoIngreso,
} from "@/shared/lib/columnas-archivo-ingreso";
import type { RawOrderItem } from "../actions/create-purchase";
import type { Rubro } from "@/entities/config/types";
import { esColumnaCapacidad } from "@/shared/lib/alias-capacidad";

/**
 * El archivo del proveedor, convertido en renglones de remito.
 *
 * POR QUÉ ES UN MÓDULO Y NO CÓDIGO ADENTRO DEL MODAL. Vivía dentro del
 * componente React, sin exportar, así que no había forma de escribirle un
 * test — y por eso nadie vio lo que hacía con las planillas que no salen
 * perfectas. Probado el 8/9/2026 contra diez formas reales, fallaba en seis:
 *
 *   * Un membrete de tres celdas ("DISTRIBUIDORA X | REMITO N° 45 | FECHA")
 *     se tomaba como encabezado y el archivo salía "sin datos válidos".
 *   * Dos columnas "PRECIO" (costo y venta): la segunda pisaba a la primera,
 *     así que el costo entraba con el precio de venta. En silencio.
 *   * La fila "TOTAL | 100 | 8000" del pie entraba como un producto llamado
 *     TOTAL, con 100 unidades de stock.
 *   * Una columna de nombre llamada "DETALLE DEL PRODUCTO" no se reconocía y
 *     el archivo entero se rechazaba.
 *   * Una cantidad negativa (devolución) se convertía en 0 sin avisar.
 *
 * LAS DOS REGLAS QUE ORDENAN TODO ESTO:
 *
 * 1. El encabezado se ancla en la COLUMNA DE NOMBRE, no en "la primera fila
 *    con más de dos celdas de texto". Es el mismo criterio que
 *    `parseProductosSheet` usa para la planilla propia: sin nombre no hay
 *    producto, así que la fila que lo tiene es el encabezado. Un membrete
 *    queda arriba, donde corresponde.
 * 2. Lo que no se puede interpretar se INFORMA, no se descarta ni se adivina.
 *    Cada fila que no entra y cada columna que quedó sin usar salen en
 *    `avisos`, y el modal los muestra antes de crear la orden. La versión
 *    anterior se tragaba el archivo entero sin decir una palabra.
 */

export type CeldaExcel = string | number | boolean | Date | null | undefined;

export type TipoAviso =
  | "columna-duplicada"
  | "columna-ignorada"
  | "columna-total"
  | "fila-descartada"
  /** La fila entra igual, pero el dato se interpretó o falta: hay que mirarla. */
  | "dato-dudoso";

export interface AvisoRemito {
  tipo: TipoAviso;
  /** Texto listo para mostrar. Se arma acá para que el modal no repita lógica. */
  detalle: string;
}

export interface ResultadoParseRemito {
  filas: RawOrderItem[];
  /** Índice (base 1, como lo ve la persona en Excel) del encabezado. */
  filaEncabezado: number | null;
  /** Campo → nombre de la columna que lo aporta. */
  columnasUsadas: Partial<Record<CampoIngreso, string>>;
  /** Columnas que van a los atributos de la variante (talle, color, memoria…). */
  columnasComoAtributo: string[];
  avisos: AvisoRemito[];
  /** Mensaje para la persona cuando NO se puede seguir. */
  error: string | null;
}

const texto = (valor: CeldaExcel) => String(valor ?? "").trim();
const encabezado = (valor: CeldaExcel) => texto(valor).toUpperCase();

/** Celda que puede ser el nombre de una columna. */
function esCeldaDeEncabezado(valor: CeldaExcel): boolean {
  const t = texto(valor);
  return t.length > 0 && !/^__EMPTY/i.test(t);
}

function aNumero(valor: CeldaExcel): number {
  if (typeof valor === "number") return valor;
  const t = texto(valor);
  if (!t) return 0;
  return parseNumeroLocal(t) ?? 0;
}

/**
 * Palabras que delatan la fila de cierre del remito. Se comparan contra el
 * nombre completo, no como "contiene": un producto puede llamarse "Total Look"
 * y no es un total.
 */
const NOMBRES_DE_CIERRE = new Set([
  "TOTAL",
  "TOTALES",
  "SUBTOTAL",
  "SUB TOTAL",
  "TOTAL GENERAL",
  "IMPORTE TOTAL",
  "SON PESOS",
]);

/** Nombres que en realidad son el encabezado repetido en el medio del archivo. */
const NOMBRES_DE_ENCABEZADO = new Set([
  "PRODUCTO",
  "PRODUCTOS",
  "DESCRIPCIÓN",
  "DESCRIPCION",
  "ARTICULO",
  "ARTÍCULO",
  "DETALLE",
]);

/**
 * SEÑALES CRUDAS DE CATEGORÍA Y GÉNERO. La resolución real —matchear contra el
 * árbol de categorías, decidir si el género sobrevive como atributo— vive en el
 * servidor (`resolverCategoriaImport`, que sí tiene la tabla `categorias`).
 * Acá solo se canonicaliza el texto: nunca "la primera palabra pluralizada"
 * como categoría, ni asumir que toda fila lleva género.
 */
const GENERO_CANONICO: Record<string, string> = {
  hombre: "Hombre",
  mujer: "Mujer",
  niño: "Niño",
  nene: "Niño",
  niña: "Niña",
  nena: "Niña",
  unisex: "Unisex",
  bebe: "Bebé",
  bebé: "Bebé",
};

/**
 * Hay proveedores que usan la columna "Categoría" para poner el género, sin
 * columna de género aparte. Cuando el valor es uno de los del vocabulario, se
 * lo lee como género y NO como categoría.
 */
function resolverCategoriaYGenero(
  categoria: string,
  genero: string,
): { categoria: string | null; genero: string | null } {
  const generoDesdeCategoria =
    !genero && GENERO_CANONICO[categoria.toLowerCase().trim()];

  return {
    genero: genero
      ? (GENERO_CANONICO[genero.toLowerCase().trim()] ?? genero.trim())
      : generoDesdeCategoria || null,
    categoria: categoria && !generoDesdeCategoria ? categoria.trim() : null,
  };
}

/**
 * Hasta qué fila se busca el encabezado. Veinte cubre cualquier membrete real
 * y evita recorrer una planilla de 3.000 filas buscando algo que no está.
 */
const MAX_FILAS_PARA_ENCABEZADO = 20;

/* ─────────────────────────── MATRIZ DE TALLES ──────────────────────────────
 *
 * El formato más común de remito de ropa NO tiene columna "cantidad": tiene
 * una columna POR TALLE, con las unidades adentro.
 *
 *   ARTICULO      | COLOR | S | M | L | XL | PRECIO
 *   Remera lisa   | Negro | 2 | 5 | 3 | 1  | 6000
 *
 * Leído como columnas sueltas, eso es un producto con cantidad CERO y cuatro
 * atributos absurdos ("S: 2 / M: 5"). Once prendas entraban como ninguna.
 *
 * Acá se detecta ese bloque y cada fila se expande a una fila por talle con
 * su cantidad. La detección es deliberadamente exigente —dos falsos positivos
 * y el remito se vuelve ilegible— y SIEMPRE avisa, para que la persona lo vea
 * en la preview antes de crear nada.
 */

/** Talles por letra, del más chico al más grande. */
const TALLES_LETRA = new Set([
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL",
  "2XL", "3XL", "4XL", "T1", "T2", "T3", "T4", "T5", "T6",
]);

/** Talle numérico: 0 a 70 cubre de ropa de bebé (0-16) a pantalón (36-60). */
function esTalleNumerico(titulo: string): boolean {
  if (!/^\d{1,2}$/.test(titulo)) return false;
  const n = Number(titulo);
  return n >= 0 && n <= 70;
}

type VocabularioTalle = "letra" | "numero";

function vocabularioDe(titulo: string): VocabularioTalle | null {
  const limpio = titulo.replace(/^TALLE\s*/i, "").trim().toUpperCase();
  if (TALLES_LETRA.has(limpio)) return "letra";
  if (esTalleNumerico(limpio)) return "numero";
  return null;
}

export interface MatrizDeTalles {
  /** Índice de columna → talle que representa. */
  columnas: { indice: number; talle: string }[];
}

/**
 * Detecta el bloque de columnas-talle, o null si no hay.
 *
 * Cuatro condiciones, y las cuatro hacen falta:
 *   1. Al menos DOS columnas sin campo propio cuyo título sea un talle.
 *   2. Todas del MISMO vocabulario (no se mezcla "S, M, L" con "38, 40"): un
 *      remito con columnas "2" y "L" es más probable que sea otra cosa.
 *   3. Sus celdas son números o están vacías. Si hay texto, no son cantidades.
 *   4. Alguna fila tiene al menos una cantidad mayor a cero. Un bloque entero
 *      en blanco no es una matriz, es ruido.
 */
export function detectarMatrizDeTalles(
  encabezados: string[],
  filasDatos: CeldaExcel[][],
  indicesLibres: number[],
): MatrizDeTalles | null {
  const candidatas = indicesLibres
    .map((indice) => ({
      indice,
      titulo: encabezados[indice] ?? "",
      vocabulario: vocabularioDe(encabezados[indice] ?? ""),
    }))
    .filter((c) => c.vocabulario !== null);

  if (candidatas.length < 2) return null;

  const vocabulario = candidatas[0].vocabulario;
  if (!candidatas.every((c) => c.vocabulario === vocabulario)) return null;

  let hayCantidad = false;

  for (const fila of filasDatos) {
    for (const candidata of candidatas) {
      const celda = fila[candidata.indice];
      const limpio = texto(celda);
      if (!limpio) continue;
      // Una celda con texto descarta el bloque entero: son cantidades o no es
      // una matriz.
      if (parseNumeroLocal(limpio) === null) return null;
      if (aNumero(celda) > 0) hayCantidad = true;
    }
  }

  if (!hayCantidad) return null;

  return {
    columnas: candidatas.map((c) => ({
      indice: c.indice,
      talle: c.titulo.replace(/^TALLE\s*/i, "").trim(),
    })),
  };
}

function buscarFilaEncabezado(filas: CeldaExcel[][]): number {
  const tope = Math.min(filas.length, MAX_FILAS_PARA_ENCABEZADO);

  for (let i = 0; i < tope; i++) {
    const fila = filas[i] ?? [];
    const tieneNombre = fila.some(
      (celda) =>
        esCeldaDeEncabezado(celda) &&
        clasificarColumnaIngreso(encabezado(celda)) === "nombre",
    );
    if (tieneNombre) return i;
  }
  return -1;
}

export function parseRemitoProveedor(
  filasCrudas: CeldaExcel[][],
  rubro?: Rubro,
): ResultadoParseRemito {
  const vacio: ResultadoParseRemito = {
    filas: [],
    filaEncabezado: null,
    columnasUsadas: {},
    columnasComoAtributo: [],
    avisos: [],
    error: null,
  };

  if (!filasCrudas.length) {
    return { ...vacio, error: "El archivo está vacío." };
  }

  const indiceEncabezado = buscarFilaEncabezado(filasCrudas);

  if (indiceEncabezado === -1) {
    // Se listan los encabezados que SÍ se vieron: es lo único que le permite a
    // la persona darse cuenta de que su columna se llama distinto.
    const candidatos = (filasCrudas[0] ?? [])
      .filter(esCeldaDeEncabezado)
      .map(encabezado)
      .slice(0, 8);

    return {
      ...vacio,
      error:
        "No se encontró la columna con el nombre del producto. " +
        (candidatos.length
          ? `Las columnas del archivo son: ${candidatos.join(", ")}. Renombrá la del producto a "Producto" o "Descripción".`
          : "El archivo no parece tener una fila de encabezados."),
    };
  }

  const encabezados = (filasCrudas[indiceEncabezado] ?? []).map((c) =>
    esColumnaCapacidad(texto(c), rubro) ? "CAPACIDAD" : encabezado(c),
  );
  const avisos: AvisoRemito[] = [];

  // Qué columna aporta cada campo. La PRIMERA gana: cuando el remito trae dos
  // "PRECIO" (costo y venta), la segunda pisaba a la primera y el costo entraba
  // con el precio de vidriera.
  const campoPorColumna = new Map<number, CampoIngreso>();
  const columnasUsadas: Partial<Record<CampoIngreso, string>> = {};
  const columnasComoAtributo: string[] = [];

  encabezados.forEach((titulo, indice) => {
    if (!esCeldaDeEncabezado(titulo)) return;

    const campo = clasificarColumnaIngreso(titulo);

    if (!campo) {
      if (esColumnaDeTotal(titulo)) {
        avisos.push({
          tipo: "columna-total",
          detalle: `La columna "${titulo}" no se usó: parece el total del renglón, no el precio por unidad.`,
        });
        return;
      }
      columnasComoAtributo.push(titulo);
      return;
    }

    if (columnasUsadas[campo]) {
      avisos.push({
        tipo: "columna-duplicada",
        detalle: `Hay dos columnas para ${campo}: se usa "${columnasUsadas[campo]}" y se ignora "${titulo}".`,
      });
      return;
    }

    columnasUsadas[campo] = titulo;
    campoPorColumna.set(indice, campo);
  });

  // ── Matriz de talles ──────────────────────────────────────────────────────
  const filasDatos = filasCrudas.slice(indiceEncabezado + 1);
  const indicesLibres = encabezados
    .map((titulo, indice) => ({ titulo, indice }))
    .filter(({ titulo, indice }) => esCeldaDeEncabezado(titulo) && !campoPorColumna.has(indice))
    .map(({ indice }) => indice);

  const matriz = detectarMatrizDeTalles(encabezados, filasDatos, indicesLibres);

  if (matriz) {
    const talles = matriz.columnas.map((c) => c.talle);
    // Las columnas-talle dejan de ser atributos sueltos: pasan a ser el eje
    // que multiplica la fila.
    for (const columna of matriz.columnas) {
      const titulo = encabezados[columna.indice];
      const posicion = columnasComoAtributo.indexOf(titulo);
      if (posicion !== -1) columnasComoAtributo.splice(posicion, 1);
    }

    avisos.push({
      tipo: "dato-dudoso",
      detalle: `El remito trae una columna por talle (${talles.join(", ")}): cada renglón se abre en una fila por talle con su cantidad.`,
    });

    if (columnasUsadas.cantidad) {
      // Con matriz, la cantidad sale de cada celda. Una columna "CANTIDAD"
      // suelta suele ser el total del renglón, y usarla multiplicaría el
      // ingreso por la cantidad de talles.
      avisos.push({
        tipo: "columna-duplicada",
        detalle: `La columna "${columnasUsadas.cantidad}" no se usa: las cantidades salen de las columnas de talle.`,
      });
    }
  }

  const filas: RawOrderItem[] = [];

  for (let i = indiceEncabezado + 1; i < filasCrudas.length; i++) {
    const cruda = filasCrudas[i] ?? [];
    // Número de fila como lo ve la persona en Excel.
    const numeroFila = i + 1;

    let nombre = "";
    let cantidadCruda: CeldaExcel = 0;
    let costoCrudo: CeldaExcel = 0;
    let ventaCruda: CeldaExcel = "";
    let categoria = "";
    let genero = "";
    let sku = "";
    let marca = "";
    let imei = "";
    const atributos: string[] = [];

    encabezados.forEach((titulo, indice) => {
      if (!esCeldaDeEncabezado(titulo)) return;
      const valor = cruda[indice];
      const limpio = texto(valor);
      if (!limpio) return;

      const campo = campoPorColumna.get(indice);
      if (!campo) {
        if (columnasComoAtributo.includes(titulo)) {
          atributos.push(`${titulo}: ${limpio}`);
        }
        return;
      }

      switch (campo) {
        case "nombre": nombre = limpio; break;
        case "cantidad": cantidadCruda = valor; break;
        case "costo": costoCrudo = valor; break;
        case "venta": ventaCruda = valor; break;
        case "categoria": categoria = limpio; break;
        case "genero": genero = limpio; break;
        case "sku": sku = limpio; break;
        case "marca": marca = limpio; break;
        case "imei": imei = limpio; break;
      }
    });

    const filaVacia =
      !nombre && !texto(cantidadCruda) && !texto(costoCrudo) && atributos.length === 0;
    if (filaVacia) continue;

    if (!nombre) {
      avisos.push({
        tipo: "fila-descartada",
        detalle: `Fila ${numeroFila}: sin nombre de producto.`,
      });
      continue;
    }

    const nombreComparable = nombre.toUpperCase();

    if (NOMBRES_DE_ENCABEZADO.has(nombreComparable)) {
      // El encabezado repetido en el medio del archivo (pasa cuando el remito
      // viene paginado). No es un aviso: no hay nada que decidir.
      continue;
    }

    if (NOMBRES_DE_CIERRE.has(nombreComparable)) {
      avisos.push({
        tipo: "fila-descartada",
        detalle: `Fila ${numeroFila}: es el total del remito, no un producto.`,
      });
      continue;
    }

    const resueltoBase = resolverCategoriaYGenero(categoria, genero);
    const comunes = {
      raw_nombre: nombre,
      raw_categoria: resueltoBase.categoria,
      raw_genero: resueltoBase.genero,
      raw_sku: sku || null,
      raw_marca: marca || null,
      raw_imei: imei || null,
      precio_costo: Math.max(0, aNumero(costoCrudo)),
      // null (no 0) cuando la planilla no trae la columna: 0 querría decir
      // "vender a $0" y en la conciliación pisaría el precio del producto.
      precio_venta: texto(ventaCruda) ? Math.max(0, aNumero(ventaCruda)) : null,
    };

    // Con matriz de talles, la fila del archivo son VARIOS renglones: uno por
    // talle con cantidad. Las columnas con cero o vacío no generan renglón —
    // un talle que el proveedor no mandó no es mercadería que entra.
    if (matriz) {
      let renglones = 0;

      for (const columna of matriz.columnas) {
        const cantidadTalle = aNumero(cruda[columna.indice]);
        if (cantidadTalle <= 0) continue;

        const conTalle = [`TALLE: ${columna.talle}`, ...atributos];
        filas.push({
          ...comunes,
          raw_variante: conTalle.join(" / "),
          cantidad: cantidadTalle,
        });
        renglones++;
      }

      if (renglones === 0) {
        avisos.push({
          tipo: "fila-descartada",
          detalle: `Fila ${numeroFila} ("${nombre}"): sin cantidad en ningún talle.`,
        });
      }
      continue;
    }

    const cantidadNumerica = aNumero(cantidadCruda);

    if (cantidadNumerica < 0) {
      // Una cantidad negativa es una devolución o una nota de crédito, no un
      // ingreso. Antes entraba como 0: una fila que no hacía nada y que nadie
      // veía.
      avisos.push({
        tipo: "fila-descartada",
        detalle: `Fila ${numeroFila} ("${nombre}"): cantidad negativa (${cantidadNumerica}). Un remito no ingresa mercadería en negativo.`,
      });
      continue;
    }

    let cantidad = Math.max(0, parsearCantidadDeEntrada(cantidadCruda));

    // "12 u", "x6", "3 pares": `parsearCantidadDeEntrada` es estricto y
    // devuelve 0 porque el texto no es un número — con razón, es el mismo
    // parser que valida lo que se tipea en el mostrador. Acá el dato viene de
    // un proveedor que escribe como quiere, así que se rescata el número y se
    // DICE que se rescató: perder doce unidades en silencio es peor que
    // interpretar de más a la vista de todos.
    if (cantidad === 0 && cantidadNumerica > 0) {
      cantidad = cantidadNumerica;
      avisos.push({
        tipo: "dato-dudoso",
        detalle: `Fila ${numeroFila} ("${nombre}"): la cantidad decía "${texto(cantidadCruda)}", se tomó ${cantidadNumerica}.`,
      });
    }

    if (cantidad === 0) {
      avisos.push({
        tipo: "dato-dudoso",
        detalle: `Fila ${numeroFila} ("${nombre}"): sin cantidad. Entra igual, pero no suma stock.`,
      });
    }

    filas.push({
      ...comunes,
      // El género NO viaja acá: el servidor decide si sobrevive como atributo
      // (solo Ropa Bebé) o se descarta.
      raw_variante: atributos.length > 0 ? atributos.join(" / ") : "Unico",
      cantidad,
    });
  }

  for (const columna of columnasComoAtributo) {
    avisos.push({
      tipo: "columna-ignorada",
      detalle: `La columna "${columna}" se guarda como atributo de la variante.`,
    });
  }

  if (filas.length === 0) {
    return {
      filas: [],
      filaEncabezado: indiceEncabezado + 1,
      columnasUsadas,
      columnasComoAtributo,
      avisos,
      error:
        "El archivo no tiene ningún renglón con producto. Revisá que las filas estén debajo de los encabezados.",
    };
  }

  return {
    filas,
    filaEncabezado: indiceEncabezado + 1,
    columnasUsadas,
    columnasComoAtributo,
    avisos,
    error: null,
  };
}
