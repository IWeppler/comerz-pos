/**
 * Las columnas del catálogo del panel: la unión de lo que pedían /pos y
 * /stock cuando eran dos consultas distintas.
 *
 * VIVE ACÁ Y NO EN LA ACTION por una razón mecánica: los archivos `"use
 * server"` solo pueden exportar funciones async. Y tiene que ser compartible
 * porque la usan DOS caminos que están obligados a coincidir:
 *
 *   `catalogo-panel.ts` ... el catálogo completo
 *   `catalogo-delta.ts` ... lo que cambió desde la última sincronización
 *
 * Si el delta trajera una forma distinta a la del completo, el merge dejaría
 * filas de dos formas conviviendo en la copia local del celular, y la pantalla
 * mostraría cosas distintas según cómo llegó cada producto. Es el tipo de bug
 * que aparece semanas después y en un solo producto.
 *
 * En UNA línea a propósito: los tipos generados de supabase-js parsean el
 * string del select en tiempo de compilación y un salto de línea adentro de la
 * interpolación les da ParserError. Mismo motivo que en columnas-publicas.ts.
 */
export const COLUMNAS_CATALOGO_PANEL =
  "id, negocio_id, nombre, slug, tipo, categoria_id, precio, precio_costo, unidad_medida, descripcion, marca, modelo, genero, atributos_globales, imagen_url, thumbnail_url, grid_url, publicado, creado_en, destacado_en, categoria:categorias(id, nombre, slug), producto_variantes(id, sku, nombre_display, precio, costo, stock, atributos), producto_presentaciones(id, variante_id, nombre, factor, regla_precio, precio, costo, sku, es_default, visible_catalogo, activa, orden)";
