import { ALIAS_COLUMNA_GENERO } from "./alias-columna-genero";

/**
 * Cómo se llama cada columna de un archivo de ingreso de mercadería, venga de
 * la planilla propia o del remito de un proveedor.
 *
 * POR QUÉ EXISTE. Los dos caminos terminan en la misma conciliación, pero
 * reconocían columnas distintas: `planilla-a-remito.ts` mapea el código de
 * barras a `raw_sku` y el IMEI a `raw_imei`, y el parser del remito no conocía
 * ninguno de los dos. Todo header desconocido cae en los atributos de la
 * variante, así que lo que en un camino era un identificador, en el otro se
 * volvía parte de la IDENTIDAD del producto.
 *
 * No es teórico. El único remito de proveedor de ClickTostado (11 líneas,
 * agosto 2026) quedó así, línea por línea:
 *
 *   raw_nombre:   REDMI NOTE 14
 *   raw_variante: CODIGO_BARRAS: 6932554407650 / COLOR: NEGRO / MEMORIA: 6/128 GB /
 *                 PRECIO_COSTO: 270000 / PRECIO_VENTA: 450000 / IMEI: 863954073589560
 *   precio_costo: 0     raw_imei: null     raw_sku: null
 *
 * El costo real quedó de adorno adentro del nombre de la variante, el aparato
 * entró con costo 0 y el IMEI no llegó a `unidades_serie`. Y como el IMEI es
 * único por unidad, cada teléfono habría sido su propia variante.
 *
 * Es el mismo problema que ya había tenido el género, y que
 * `alias-columna-genero.ts` resolvió con una sola lista compartida: un dato
 * con una regla y dos listas es la regla aplicada a medias.
 *
 * QUÉ NO ESTÁ ACÁ, y es a propósito: `modelo`, `memoria`, `talle`, `color`,
 * `peso`, `medida`, `material`, `presentacion`, `capacidad` y `acabado`. Esas columnas no tienen campo
 * propio en `ordenes_items`, así que su lugar correcto sigue siendo el texto
 * de la variante — que es donde la conciliación las lee. La lista de abajo es
 * la de las columnas que tienen OTRO destino, y por lo tanto no deben terminar
 * pegadas a la identidad de la variante.
 */
export type CampoIngreso =
  | "nombre"
  | "cantidad"
  | "costo"
  | "venta"
  | "categoria"
  | "genero"
  | "sku"
  | "marca"
  | "imei";

/**
 * Alias por campo. Se comparan NORMALIZADOS (mayúsculas, sin tildes y sin
 * espacios, guiones ni guiones bajos), así que alcanza con listar una forma de
 * cada palabra: "precio_venta", "Precio Venta" y "PRECIO-VENTA" son la misma.
 *
 * EL ORDEN DE LAS CLAVES IMPORTA y por eso el objeto se recorre en orden de
 * declaración: `venta` va antes que `costo` porque "PRECIO VENTA" no puede
 * caer en el genérico "PRECIO" y entrar como costo. Y `sku` va antes que nada
 * que pueda comerse "CODIGO DE BARRAS".
 */
export const ALIAS_COLUMNAS_INGRESO: Record<CampoIngreso, readonly string[]> = {
  // Las formas largas están por lo mismo que el resto de la lista: un remito
  // que dice "DETALLE DEL PRODUCTO" en vez de "DESCRIPCIÓN" se rechazaba
  // entero, porque sin columna de nombre no hay ni una fila válida.
  nombre: [
    "descripcion",
    "descripción",
    "descripcion del articulo",
    "descripcion del producto",
    "detalle",
    "detalle del producto",
    "producto",
    "productos",
    "nombre",
    "articulo",
    "artículo",
    "mercaderia",
    "mercadería",
  ],
  cantidad: ["cantidad", "cant", "ctd", "cdad", "stock", "unidades", "unid"],
  // "PRECIO" a secas es COSTO: en un remito, el precio que manda el proveedor
  // es lo que le cobra al comercio. El precio al público solo se toma cuando
  // la columna lo dice.
  venta: [
    "precio venta",
    "precio de venta",
    "venta",
    "pvp",
    "precio publico",
    "precio al publico",
    "precio sugerido",
  ],
  costo: [
    "precio unitario",
    "p unitario",
    "unitario",
    "costo",
    "costo unitario",
    "precio",
    "precio costo",
    "precio compra",
  ],
  categoria: ["categoria", "categoría", "rubro", "tipo"],
  genero: ALIAS_COLUMNA_GENERO,
  // El EAN y el SKU comparten destino: `producto_variantes.sku` es la misma
  // columna con otro label según el rubro (ver identidad-por-rubro.ts).
  sku: [
    "sku",
    "codigo",
    "código",
    "cod",
    "codigo de barras",
    "codigo barras",
    "ean",
  ],
  marca: ["marca"],
  // Uno por fila: dos aparatos iguales son dos filas. Va a `unidades_serie`,
  // NO a los atributos de la variante.
  imei: ["imei", "numero de serie", "nro de serie", "serie", "n serie"],
};

/**
 * Clave de comparación: mayúsculas, sin tildes y sin nada que no sea letra o
 * número. Se usa SOLO para comparar contra las listas de arriba; el header
 * original se conserva como nombre del atributo, porque acá "TALLE DE PRENDA"
 * se volvería "TALLEDEPRENDA".
 *
 * Se borran TODOS los signos, no solo espacios y guiones: los remitos vienen
 * con "N° SERIE", "COD.", "PRECIO ($)" y cosas así, y un símbolo suelto no
 * puede ser la diferencia entre reconocer una columna y pegarla al nombre de
 * la variante.
 */
export function normalizarClaveColumna(header: string): string {
  return header
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * Columnas que NO se pueden usar como precio aunque lo parezcan: son el TOTAL
 * de la línea (cantidad × unitario), no el unitario.
 *
 * No entran en `ALIAS_COLUMNAS_INGRESO` a propósito. Mapear "IMPORTE" a costo
 * sería peor que ignorarlo: un remito de 12 unidades a $500 entraría con costo
 * $6.000 por unidad, y ese número se congela en el producto y en el margen de
 * todo lo que se venda después. Se reconocen solo para poder AVISAR que esa
 * columna quedó sin usar, que es lo que permite a la persona darse cuenta.
 */
export const COLUMNAS_DE_TOTAL = [
  "importe",
  "total",
  "subtotal",
  "total linea",
  "importe total",
  "monto",
] as const;

export function esColumnaDeTotal(header: string): boolean {
  const clave = normalizarClaveColumna(header);
  return COLUMNAS_DE_TOTAL.some((c) => normalizarClaveColumna(c) === clave);
}

const CAMPOS_EN_ORDEN = Object.keys(ALIAS_COLUMNAS_INGRESO) as CampoIngreso[];

/**
 * A qué campo corresponde una columna del archivo, o `null` si es un atributo
 * de la variante (talle, color, memoria…) o algo que el sistema no conoce.
 */
export function clasificarColumnaIngreso(header: string): CampoIngreso | null {
  const clave = normalizarClaveColumna(header);
  if (!clave) return null;

  for (const campo of CAMPOS_EN_ORDEN) {
    const alias = ALIAS_COLUMNAS_INGRESO[campo];
    if (alias.some((a) => normalizarClaveColumna(a) === clave)) return campo;
  }
  return null;
}
