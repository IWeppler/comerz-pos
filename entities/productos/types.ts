export interface ProductoStock {
  id: string;
  producto_id?: string;
  variante: string;
  cantidad: number;
}

export interface ProductoVariante {
  id: string;
  /** No lo trae get-product.ts (ni index ni detalle) — nada lo lee, siempre se conoce por el producto padre. */
  producto_id?: string;
  /** No lo trae la query "índice" de stock (features/stock/actions/get-product.ts) — solo el detalle de página. */
  sku?: string | null;
  nombre_display: string;
  precio: number | null;
  /** NO lo trae el catálogo público: anon no tiene `costo` concedido en la base (20260811140000). Solo viene por los caminos autenticados (POS, stock). */
  costo?: number | null;
  stock: number;
  /** stock físico neto de reservas ACTIVAS. Solo lo calculan las actions que ya consultan `reservas`; si no viene, tratar como igual a `stock`. */
  stock_disponible?: number;
  /** No lo trae get-product.ts — sin uso en ningún lado de la app hoy. */
  stock_minimo?: number;
  /** No lo trae get-product.ts — sin uso en ningún lado de la app hoy (ni siquiera se filtra por esto en esa query). */
  activa?: boolean;
  atributos?: Record<string, string>;
  producto_variante_valores?: {
    atributo?: {
      nombre?: string | null;
    } | null;
    atributo_valor?: {
      valor?: string | null;
    } | null;
  }[];
}

/**
 * Estados de una unidad serializada. El CHECK de la tabla es fail-closed:
 * agregar un estado acá sin migración no lo hace válido en la base.
 */
export type EstadoUnidadSerie = "disponible" | "vendido";

/**
 * Una unidad física con IMEI / número de serie (rubro electro). A diferencia
 * de `ProductoVariante.stock`, que es un contador de unidades intercambiables,
 * acá cada fila es UN aparato: es lo que permite garantía y trazabilidad por
 * equipo.
 *
 * Todavía nada del flujo de ventas lee ni escribe esta tabla: la fuente de
 * verdad del stock sigue siendo `producto_variantes.stock`.
 */
export interface UnidadSerie {
  id: string;
  /** Reservado para multi-tenant (ROADMAP TIER 2). Siempre null en el modelo por-proyecto actual. */
  negocio_id?: string | null;
  producto_variante_id: string;
  imei: string;
  estado: EstadoUnidadSerie;
  fecha_ingreso: string;
  /** La base garantiza el par: no-null si y solo si estado === 'vendido'. */
  fecha_venta: string | null;
  /** Sin FK en la base — puede apuntar a una venta que ya no existe, o ser null en una venta cargada a mano. */
  venta_id: string | null;
}

export interface CategoriaRelacion {
  id: string;
  nombre: string;
  slug: string;
}

export interface Producto {
  id: string;
  nombre: string;
  tipo: string;
  categoria_id?: string | null;
  categoria?: CategoriaRelacion | null;
  precio: number;
  /** NO lo trae el catálogo público: es el margen del comercio y anon no lo tiene concedido (20260811140000). Solo por caminos autenticados. */
  precio_costo?: number;
  imagen_url: string | null;
  /** Opcional porque la LISTA del catálogo público no lo trae: la grilla usa
   * `grid_url` y la miniatura solo hace falta en /stock y en la ficha, que la
   * piden con su propia consulta. Ver COLUMNAS_PRODUCTO_LISTA. */
  thumbnail_url?: string | null;
  grid_url: string | null;
  creado_en: string;
  /** Cuándo se marcó como destacado de la portada del catálogo público.
   * null = no destacado. La portada muestra los 8 con la marca más reciente.
   * Ver features/store/lib/portada-catalogo.ts. */
  destacado_en?: string | null;
  publicado: boolean;
  slug: string | null;
  descripcion?: string | null;
  marca?: string | null;
  /** Modelo oficial del fabricante (T4, rubro electro). Texto libre, mismo
   * patrón que `marca`. Nullable: en indumentaria no se usa. */
  modelo?: string | null;
  /** Segmento en indumentaria (Mujer, Hombre, Unisex). Texto libre. */
  genero?: string | null;
  /** Tratamiento frente al IVA. Un solo campo dice alícuota Y condición —
   * ver shared/lib/fiscal-producto.ts. Default en la base: GRAVADO_21. */
  tratamiento_iva?: string | null;
  /** Unidad semántica de venta. El código fiscal de ARCA se traduce desde
   * esto cuando se conecte la facturación. Default en la base: UNIDAD. */
  unidad_medida?: string | null;
  atributos_globales?: Record<string, string>;
  stock?: ProductoStock[];
  producto_variantes?: ProductoVariante[];
  /**
   * El precio que REALMENTE se cobra: el de las variantes cuando todas
   * coinciden, el de cabecera si no. `precio` y `precio_efectivo` son números
   * distintos en 30 productos de los cuatro negocios, y el que gana en la
   * venta es este (`variante.precio ?? producto.precio`).
   *
   * Solo lo traen las consultas que leen la vista `productos_precio_efectivo`
   * (hoy: la conciliación de remitos). Opcional a propósito: quien no lo pida
   * no puede leerlo por accidente creyendo que siempre está.
   */
  precio_efectivo?: number;
  /** El costo efectivo, por el mismo criterio que `precio_efectivo`. */
  costo_efectivo?: number;
  /**
   * Las variantes no se ponen de acuerdo entre ellas (o algunas tienen precio
   * propio y otras no): no hay UN precio del producto. Con esto en true,
   * `precio_efectivo` cae al de cabecera y no se puede prometer que sea el que
   * se cobra — hay que avisarlo, no promediarlo.
   */
  precios_dispares?: boolean;
}

/**
 * Forma liviana de un producto para /stock: lo que hace falta para buscar,
 * filtrar por categoría/variante, ordenar, paginar y RENDERIZAR la fila
 * (miniatura, link de compartir, estado publicado) 100% client-side sobre
 * el catálogo COMPLETO, sin re-fetch por tipeo/orden/página. Trae los tres
 * tiers de imagen (`imagen_url`/`thumbnail_url`/`grid_url`) porque cada
 * superficie necesita el suyo: la tabla usa el thumbnail (150px, fila
 * chica), la grilla usa `grid_url` (320px, celda de ~230-400px en
 * tablet — ver diagnóstico de borrosidad). Sigue sin traer `descripcion` ni
 * `creado_en` — esos solo hacen falta para el formulario de edición de UN
 * producto, que los trae con su propio fetch on-demand al abrir el sheet (ver
 * getStockDetalleProductoAction).
 *
 * Tampoco trae ya `producto_variante_valores` ni el espejo legacy `stock`, que
 * estaban de más: el primero solo se lee cuando `producto_variantes.atributos`
 * viene vacío (cero variantes en esa situación en los seis negocios) y el
 * segundo solo bajo `incluirStockLegacy`, que nadie pasa. Eran 664 kB de los
 * 2,54 MB del índice de Evens. Están fuera del tipo a propósito: si mañana
 * alguien los necesita, el compilador lo manda a agregarlos también al select
 * en vez de dejarlo leer `undefined` en silencio.
 *
 * `sku` de variante SÍ se trae desde T4: en rubro electro la fila de
 * inventario muestra el EAN, que se guarda en ese mismo campo. Es un texto
 * corto por variante y evita un segundo fetch por fila; en indumentaria
 * queda sin leer.
 */
export type ProductoIndice = Pick<
  Producto,
  | "id"
  | "nombre"
  | "tipo"
  | "precio"
  | "precio_costo"
  | "categoria_id"
  | "marca"
  | "modelo"
  | "imagen_url"
  | "thumbnail_url"
  | "grid_url"
  | "slug"
  | "publicado"
  // Sin esto la barra de selección no sabe cuántos destacados hay ya, y el
  // tope de 8 se descubriría recién al escribir.
  | "destacado_en"
  // Sin esto, Inventario muestra "12 u." de un producto que se vende por kilo.
  | "unidad_medida"
> & {
  categoria?: CategoriaRelacion | null;
  producto_variantes?: Pick<
    ProductoVariante,
    "id" | "sku" | "nombre_display" | "precio" | "costo" | "stock" | "atributos"
  >[];
};

/**
 * Forma del producto para las MÉTRICAS del panel (`/`): lo que leen
 * `getDashboardMetrics`, `detectarQuiebresRotacion`,
 * `detectarCategoriasEnRiesgo` y `detectarFinDeTemporada` /
 * `detectarProximaTemporada`, y nada más.
 *
 * Es la contraparte de `ProductoIndice` para otra pantalla. El panel traía el
 * catálogo entero por `getStockAction` —con variantes, fotos, slug y
 * descripción— para calcular stock valorizado, quiebres y temporada: 2,35 MB
 * en Evens, de los cuales estas funciones leen 0,77 MB. Ninguna mira
 * `producto_variantes`: el stock lo sacan del espejo legacy `stock`
 * (`productos_stock`), y eso NO se cambia acá — espejo y canónica difieren en
 * 20 productos y mover la fuente es su propio cambio con su propia
 * verificación (ver el encabezado de `getStockAction`).
 *
 * `stock` queda opcional, igual que en `Producto`, para que un `Producto[]`
 * completo siga entrando: `/reportes` le pasa a las mismas funciones el
 * catálogo de `getStockAction`, y los tests construyen `Producto`. Sin
 * `producto_variantes` en el tipo a propósito: si una regla nueva las
 * necesita, el compilador la manda a agregarlas también al select en vez de
 * dejarla leer `undefined`.
 */
export type ProductoPanel = Pick<
  Producto,
  | "id"
  | "nombre"
  | "tipo"
  | "precio"
  | "precio_costo"
  | "categoria_id"
  | "creado_en"
  | "unidad_medida"
  | "stock"
> & {
  categoria?: CategoriaRelacion | null;
};
