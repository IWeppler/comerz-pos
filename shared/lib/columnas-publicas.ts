/**
 * Qué columnas puede pedir el catálogo público.
 *
 * Con GRANT por columna para `anon` (20260811140000_rls_anon_catalogo_publico),
 * un `select("*")` de PostgREST pide TODAS las columnas y vuelve 403: la
 * tienda entera se cae, no se degrada. Así que las listas viven acá, en un
 * solo lugar, y son el espejo exacto de los GRANT de esa migración.
 *
 * Regla al tocar esto: agregar una columna acá sin agregarla al GRANT rompe la
 * tienda en producción; agregarla al GRANT sin pensarla la publica para los
 * cuatro negocios a la vez, porque la anon key es pública. Los dos lados se
 * cambian juntos o no se cambia ninguno.
 *
 * Van en UNA línea a propósito: los tipos generados de supabase-js parsean el
 * string del select en tiempo de compilación y un salto de línea dentro de una
 * interpolación le da ParserError.
 */

/** Ojo: sin `precio_costo` ni `tratamiento_iva`. Ni el margen ni la situación
 * fiscal salen al catálogo. `unidad_medida` SÍ sale (GRANT en
 * 20260819140000): sin ella, "$8.500" en una carnicería es un precio
 * equivocado, no uno incompleto. */
export const COLUMNAS_PRODUCTO_PUBLICO =
  "id, negocio_id, nombre, slug, tipo, categoria_id, precio, unidad_medida, descripcion, marca, modelo, genero, atributos_globales, imagen_url, thumbnail_url, grid_url, publicado, creado_en, destacado_en";

/**
 * Las de arriba menos lo que la LISTA no dibuja.
 *
 * El catálogo manda el array entero de productos al cliente (es prop de
 * `StoreCatalog`, que es un componente de cliente), así que cada columna de
 * más viaja multiplicada por la cantidad de productos publicados. Medido en el
 * build servido: la portada de Evens son 1.183 productos y 1,99 MB de HTML, de
 * los cuales 36 kB son HTML y el resto payload RSC.
 *
 * Qué se saca y por qué se puede:
 *
 * - `descripcion`: solo la dibuja la ficha del producto, que tiene su propia
 *   consulta (`getProductoBySlugAction`) y sigue usando
 *   `COLUMNAS_PRODUCTO_PUBLICO`. Ninguna vista de lista la lee.
 * - `thumbnail_url`: la grilla usa `grid_url` y la portada de categorías lo
 *   tiene como fallback del medio (`imagenDePortada`: grid → thumb → imagen).
 *   Verificado contra producción: de 1.804 productos publicados hay CERO cuya
 *   única imagen sea la miniatura, así que sacarlo no deja ninguna tarjeta sin
 *   foto. La ficha lo sigue recibiendo por su consulta.
 *
 * `imagen_url` SE QUEDA aunque parezca redundante: 268 publicados no tienen
 * `grid_url` y para 34 de ellos es la única imagen que hay.
 *
 * No hay que tocar los GRANT: esto pide MENOS columnas de las concedidas, y la
 * regla del comentario de arriba es sobre agregar, no sobre sacar.
 */
export const COLUMNAS_PRODUCTO_LISTA =
  "id, negocio_id, nombre, slug, tipo, categoria_id, precio, unidad_medida, marca, modelo, genero, atributos_globales, imagen_url, grid_url, publicado, creado_en, destacado_en";

/** Ojo: sin `costo` ni `stock_minimo`. */
export const COLUMNAS_VARIANTE_PUBLICA =
  "id, sku, nombre_display, precio, stock, atributos";

export const COLUMNAS_CATEGORIA_PUBLICA =
  "id, negocio_id, nombre, slug, descripcion, imagen_url, orden, parent_id, activa";

/** Branding y contacto. Sin identidad fiscal ni política de crédito. */
const COLUMNAS_CONFIG_PUBLICA_BASE =
  "id, negocio_id, posName, posLogo, rubro, catalogo_activo, mostrar_precios, mostrar_sin_stock, permitir_venta_sin_stock, banner_activo, banner_titulo, banner_subtitulo, banner_imagen, banner_imagen_desktop, banner_focal_x, banner_focal_y, banner_focal_desktop_x, banner_focal_desktop_y, banner_link, banner_boton_texto, marquee_activo, marquee_texto, whatsapp, pedidos_whatsapp, instagram, facebook, horario_texto, horario_visible, direccion, direccion_visible, localidad, localidad_negocio, provincia, envio_costo_local, envio_mensaje_lejos, entrega_minima_bloqueante";

export const COLUMNAS_PROMOCION_PUBLICA =
  "id, negocio_id, nombre, descripcion, activa, acumulable, tipo_descuento, valor_descuento, tipo_regla, monto_minimo, mostrar_en_catalogo, prioridad, fecha_inicio, fecha_fin";

/** GRANT en 20261007180000. Aplicar la migración antes de publicar este código. */
export const COLUMNAS_CONFIG_PUBLICA = `${COLUMNAS_CONFIG_PUBLICA_BASE}, envio_gratis_desde_monto, envio_gratis_desde_unidades, envio_gratis_alcance`;
