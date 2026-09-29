import type { Rubro } from "@/entities/config/types";

/**
 * Qué columnas lleva la planilla de mercadería de cada rubro.
 *
 * Es el módulo que hace que la importación deje de ser "la de indumentaria con
 * ejemplos distintos". Hasta acá las columnas eran nueve fijas para todos, así
 * que una carnicería tenía que llenar `memoria` y no tenía dónde poner el peso.
 *
 * Tres decisiones que sostienen el resto:
 *
 * 1. Las columnas BASE son iguales en todos los rubros. Categoría, producto,
 *    stock y precios son lo que hace a un producto vendible, y no dependen de
 *    qué se vende. Cambiar sus nombres por rubro obligaría a que el parser
 *    tuviera un diccionario por rubro, y a que el POS supiera cuál mirar.
 * 2. Lo específico se AGREGA, nunca reemplaza. Así una planilla de un rubro
 *    entra en otro (perdiendo las columnas que no le corresponden) en vez de
 *    fallar entera: el comercio que se equivoca de plantilla igual puede
 *    importar y corregir después.
 * 3. Cada columna dice si es identificadora de la VARIANTE. Talle y color
 *    parten un producto en varias variantes; peso o vencimiento no. Esa marca
 *    es lo que le permite a la conciliación decidir si dos filas son el mismo
 *    producto o dos distintos, que es la pregunta que se hace con 300+
 *    productos cargados.
 */

export interface ColumnaPlantilla {
  /** Nombre exacto de la columna en el archivo. */
  clave: string;
  /** Qué es, para la ayuda de la plantilla. */
  descripcion: string;
  /** Distingue variantes de un mismo producto (talle, color, memoria). Lo usa
   * la conciliación para agrupar filas del mismo producto. */
  esVariante?: boolean;
}

/** Comunes a todos los rubros. Sin estas cinco no hay producto vendible. */
export const COLUMNAS_BASE: ColumnaPlantilla[] = [
  { clave: "categoria", descripcion: "Rubro o familia del producto" },
  { clave: "producto", descripcion: "Nombre como lo vas a buscar en el POS" },
  { clave: "stock", descripcion: "Unidades que entran" },
  { clave: "precio_costo", descripcion: "Lo que te costó" },
  { clave: "precio_venta", descripcion: "Lo que le cobrás al cliente" },
];

/** El código de barras es de casi todos, pero NO de indumentaria: la ropa de
 * proveedor local rara vez lo trae, y una columna que siempre va vacía enseña
 * a ignorar columnas. */
const CODIGO_BARRAS: ColumnaPlantilla = {
  clave: "codigo_barras",
  descripcion: "EAN del envase, si lo tiene",
};

const ESPECIFICAS: Record<Rubro, ColumnaPlantilla[]> = {
  indumentaria: [
    // El género NO parte variantes: es la categoría de arriba del árbol
    // (Hombre > Camperas, Nena > Remeras). Marcarlo `esVariante` duplicaría
    // cada prenda por audiencia en vez de colgarla del padre correcto.
    {
      clave: "genero",
      descripcion: "Hombre, Mujer, Nena, Niño, Bebé — define la categoría",
    },
    { clave: "talle", descripcion: "S, M, L, 38, 40…", esVariante: true },
    { clave: "color", descripcion: "Color de esta fila", esVariante: true },
  ],
  electro: [
    CODIGO_BARRAS,
    { clave: "modelo", descripcion: "Modelo del fabricante" },
    { clave: "color", descripcion: "Color del aparato", esVariante: true },
    { clave: "memoria", descripcion: "128GB, 8GB RAM…", esVariante: true },
    {
      clave: "imei",
      // La regla que nadie adivina sola y por la que la plantilla existe.
      descripcion: "Uno por fila: dos aparatos iguales son dos filas",
    },
  ],
  // OJO con lo que NO está acá: `vencimiento` y `lote`. Los dos rubros los
  // necesitan de verdad, pero no hay dónde guardarlos — el vencimiento es del
  // LOTE, no del producto ni de la variante, y eso es una tabla que todavía no
  // existe. Ofrecer la columna en la plantilla y tirar el dato al importar es
  // peor que no ofrecerla: el comercio cree que quedó cargada.
  alimentos: [
    CODIGO_BARRAS,
    { clave: "marca", descripcion: "Marca del fabricante" },
    { clave: "peso", descripcion: "500g, 1L, 1kg…", esVariante: true },
    { clave: "unidad_medida", descripcion: "Unidad, Kilogramo, Litro…" },
  ],
  farmacia: [
    CODIGO_BARRAS,
    { clave: "marca", descripcion: "Laboratorio" },
    {
      clave: "presentacion",
      descripcion: "Caja x30, jarabe 120ml…",
      esVariante: true,
    },
  ],
  ferreteria: [
    CODIGO_BARRAS,
    { clave: "marca", descripcion: "Marca del fabricante" },
    { clave: "medida", descripcion: '1/2", 10mm, 3 metros…', esVariante: true },
    { clave: "material", descripcion: "Acero, bronce, PVC…", esVariante: true },
  ],
  // El peso está acá aunque un kiosco venda casi todo por unidad: también hay
  // golosinas en bolsita, fiambre al corte y frutos secos sueltos. Una columna
  // de más que se deja vacía cuesta mucho menos que no tener dónde poner el
  // dato — y el criterio de que UN comercio vende por unidad Y por peso a la
  // vez es justo el que hace que "vender por peso" sea del PRODUCTO y no del
  // rubro (ver AGENTS.md, "Venta por peso").
  quioscos: [
    CODIGO_BARRAS,
    { clave: "marca", descripcion: "Marca del fabricante" },
    { clave: "peso", descripcion: "100g, 500g, 1kg… si se vende suelto", esVariante: true },
    { clave: "unidad_medida", descripcion: "Unidad, Paquete, Caja…" },
  ],
  // COTILLÓN. Lo que lo separa de un kiosco es el COLOR: los globos, las
  // servilletas y los platos son el mismo artículo en ocho colores, y la
  // clienta pide "doce globos rojos". Sin `color` como columna de variante,
  // cada color sería un producto suelto y el catálogo se vuelve inmanejable.
  //
  // Lleva `unidad_medida` y `peso` por el otro lado del mostrador: las
  // golosinas sueltas —confites, gomitas, chupetines por bolsa— se venden por
  // kilo, y en la misma venta se cobra una piñata por unidad. Eso lo resuelve
  // `productos.unidad_medida` producto por producto (ver `unidad-venta.ts`),
  // y esta columna es donde se declara al ingresar la mercadería.
  cotillon: [
    CODIGO_BARRAS,
    { clave: "marca", descripcion: "Marca del fabricante" },
    { clave: "color", descripcion: "Color del artículo", esVariante: true },
    { clave: "peso", descripcion: "100g, 500g, 1kg… si se vende suelto", esVariante: true },
    { clave: "unidad_medida", descripcion: "Unidad, Kilogramo, Paquete…" },
  ],
  // "Otros" no inventa columnas: no se sabe qué vende. Se queda con la base y
  // el código de barras, que es lo que sirve en cualquier mostrador.
  otros: [CODIGO_BARRAS],
};

export function columnasDeRubro(rubro: Rubro): ColumnaPlantilla[] {
  return [...COLUMNAS_BASE, ...(ESPECIFICAS[rubro] ?? ESPECIFICAS.otros)];
}

/** Las columnas que parten un producto en variantes. La conciliación las usa
 * para saber si dos filas del archivo son el mismo producto en dos versiones o
 * dos productos distintos. */
export function columnasDeVariante(rubro: Rubro): string[] {
  return columnasDeRubro(rubro)
    .filter((c) => c.esVariante)
    .map((c) => c.clave);
}

/**
 * TODAS las columnas que el sistema entiende, de cualquier rubro.
 *
 * El parser la usa para no descartar una columna válida solo porque el
 * comercio bajó la plantilla de otro rubro, o porque cambió de rubro después
 * de armar el archivo. Una planilla de más nunca es un error.
 */
export function todasLasColumnasConocidas(): string[] {
  const claves = new Set(COLUMNAS_BASE.map((c) => c.clave));
  for (const columnas of Object.values(ESPECIFICAS)) {
    for (const columna of columnas) claves.add(columna.clave);
  }
  return [...claves];
}

export const ETIQUETA_RUBRO: Record<Rubro, string> = {
  indumentaria: "Indumentaria",
  electro: "Electro y tecnología",
  alimentos: "Alimentos y bebidas",
  farmacia: "Farmacia y perfumería",
  ferreteria: "Ferretería y construcción",
  quioscos: "Kiosco y autoservicio",
  cotillon: "Cotillón y fiestas",
  otros: "Otro rubro",
};
