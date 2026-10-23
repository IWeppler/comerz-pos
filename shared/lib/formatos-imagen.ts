/**
 * Qué formatos de imagen se aceptan al subir.
 *
 * Existe como constante porque la lista estaba copiada en cuatro pantallas
 * (banner, portada de categoría, logo del comercio y fotos de producto) y ya
 * había divergido. Desde el 22/10/2026 (`20261022210000`) los buckets
 * `productos` y `logos` tienen `allowed_mime_types` con ESTOS cuatro tipos: un
 * formato nuevo acá necesita sumarse también al bucket, o la subida falla con
 * 415.
 *
 * AVIF entra porque es lo que exporta hoy cualquier herramienta de diseño y
 * cualquier celular moderno: dejarlo afuera no protege de nada, solo obliga a
 * convertir el archivo a mano antes de subirlo. El transformador de Supabase lo
 * lee sin problema, y el optimizador del navegador (`image-optimizer.ts`) lo
 * decodifica por canvas como cualquier otro formato que el browser sepa abrir.
 *
 * NO está `image/*`: un `accept` abierto deja elegir un HEIC o un TIFF que el
 * canvas no decodifica, y el error aparece recién después de esperar la subida.
 */
export const FORMATOS_IMAGEN_ACEPTADOS =
  "image/png, image/jpeg, image/webp, image/avif";
