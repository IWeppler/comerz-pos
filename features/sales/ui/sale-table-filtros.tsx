"use client";

/**
 * Los valores de los filtros del historial de ventas.
 *
 * Viven en su propio archivo porque los comparten la tabla (que filtra) y el
 * header (que dibuja los selects), y porque el centinela "todos" tiene que ser
 * EL MISMO string en los dos lados: el `Select` de shadcn no acepta `""` como
 * valor de un item, así que "sin filtro" necesita un valor explícito. Con dos
 * constantes distintas el filtro quedaría siempre activo y no se filtraría
 * nada — o peor, nada coincidiría.
 */
export const ESTADO_TODOS = "todos";
export const METODO_TODOS = "todos";

/**
 * Los tres estados que ya distingue la tabla, con las mismas etiquetas que
 * muestra la columna Estado. Salen de ahí a propósito: un filtro que ofrece
 * categorías que no coinciden con lo que se lee en la fila obliga a adivinar
 * la traducción.
 */
export const ESTADOS_VENTA = [
  { value: ESTADO_TODOS, label: "Todos los estados" },
  { value: "pagada", label: "Pagado" },
  { value: "fiado", label: "Fiado" },
  { value: "anulada", label: "Anulada" },
] as const;

export type EstadoVentaFiltro = (typeof ESTADOS_VENTA)[number]["value"];

/**
 * Factura o ticket interno. El select se ofrece SOLO cuando el historial
 * tiene al menos una venta facturada: para un comercio de ticket interno es
 * un filtro que nunca cambia nada.
 */
export const COMPROBANTE_TODOS = "todos";

export const COMPROBANTES_FILTRO = [
  { value: COMPROBANTE_TODOS, label: "Factura o ticket" },
  { value: "facturadas", label: "Facturadas" },
  { value: "sin_facturar", label: "Sin facturar" },
] as const;

export type ComprobanteFiltro = (typeof COMPROBANTES_FILTRO)[number]["value"];
