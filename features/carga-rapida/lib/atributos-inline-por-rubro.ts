import type { Rubro } from "@/entities/config/types";
import { columnasDeRubro } from "@/features/stock/lib/columnas-por-rubro";

/**
 * Qué atributos de variante se cargan INLINE en la fila de la Carga rápida.
 *
 * Hasta acá eran "Talle" y "Color" fijos para todos, o sea que un kiosco y
 * un almacén veían dos columnas de una tienda de ropa: no había dónde poner
 * el peso de las gomitas y sí había dónde poner el talle de una gaseosa. Un
 * campo que nunca aplica enseña a ignorar campos, y el que sí aplica no
 * estaba.
 *
 * Salen de `columnasDeRubro`, que es la ÚNICA lista de qué distingue una
 * variante de otra en cada rubro (`esVariante`): la planilla, la conciliación
 * y esta fila tienen que decir lo mismo, o un producto cargado por un camino
 * no se reconoce cuando entra por el otro. Se toman como mucho dos porque la
 * fila tiene dos celdas; lo que no entra va a la grilla de combinaciones.
 *
 * `clave` es el nombre de la columna de la planilla (minúscula, sin acento) y
 * es lo que viaja en la línea; `etiqueta` es el nombre del atributo tal como
 * se guarda en la variante ("Talle", "Peso"), que después canonicaliza
 * `crearProductoAction` igual que en el alta completa.
 */
export type AtributoInline = {
  clave: string;
  etiqueta: string;
  /** Ejemplo corto para el placeholder de la celda. */
  ejemplo: string;
};

/** Cómo se llama el atributo en la variante. La clave de planilla va sin
 * acento para que el parser la reconozca; el atributo se muestra bien
 * escrito. Una clave que no esté acá cae a la clave capitalizada. */
const ETIQUETA_POR_CLAVE: Record<string, string> = {
  talle: "Talle",
  color: "Color",
  memoria: "Memoria",
  peso: "Peso",
  presentacion: "Presentación",
  medida: "Medida",
  material: "Material",
};

const MAX_ATRIBUTOS_INLINE = 2;

export function etiquetaDeAtributoInline(clave: string): string {
  return (
    ETIQUETA_POR_CLAVE[clave] ?? clave.charAt(0).toUpperCase() + clave.slice(1)
  );
}

export function atributosInlineDeRubro(rubro: Rubro): AtributoInline[] {
  return columnasDeRubro(rubro)
    .filter((columna) => columna.esVariante)
    .slice(0, MAX_ATRIBUTOS_INLINE)
    .map((columna) => ({
      clave: columna.clave,
      etiqueta: etiquetaDeAtributoInline(columna.clave),
      ejemplo: columna.descripcion,
    }));
}
