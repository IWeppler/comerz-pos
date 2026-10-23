/**
 * Las categorías de gasto de Comerz.
 *
 * Viven en su propio módulo y no junto a la server action porque un archivo
 * `"use server"` solo puede exportar funciones async: exportar este array
 * desde ahí rompe el build con "A 'use server' file can only export async
 * functions, found object". Los tipos sí pueden viajar con la action —se
 * borran en compilación— pero un valor en runtime no.
 *
 * Los valores crudos son los del CHECK de `gastos_comerz.categoria`: si se
 * agrega uno acá, va también en la migración, o la base lo rechaza.
 */
export const CATEGORIAS_GASTO = [
  { valor: "infra", etiqueta: "Infraestructura" },
  { valor: "sueldo", etiqueta: "Sueldos" },
  { valor: "comision", etiqueta: "Comisión por cliente" },
  { valor: "marketing", etiqueta: "Marketing" },
  { valor: "impuestos", etiqueta: "Impuestos" },
  { valor: "servicios", etiqueta: "Servicios" },
  { valor: "otro", etiqueta: "Otro" },
] as const;

export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]["valor"];
export type TipoGasto = "FIJO" | "UNICO";

/** Nombre corto, para las listas donde el espacio manda. */
export const ETIQUETA_CATEGORIA: Record<string, string> = {
  infra: "Infra",
  sueldo: "Sueldos",
  comision: "Comisión",
  marketing: "Marketing",
  impuestos: "Impuestos",
  servicios: "Servicios",
  otro: "Otro",
};
