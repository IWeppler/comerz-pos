import { normalizarImei } from "@/entities/ventas/imei";
import { cantidadEfectiva, entraAlStock } from "./recepcion";

/**
 * IMEI de un remito en la conciliación: los que vinieron en el Excel
 * (`raw_imei`, uno por renglón) más los que se completan en pantalla
 * (`imeis_completados`). Un renglón "Samsung A17 x3" sin IMEI pide tres.
 *
 * Qué renglones llevan IMEI lo decide la base (`productos_llevan_serie` /
 * `categorias_llevan_serie`, 20261007120000); acá llega como predicado. Los
 * guards de `aprobar_orden_compra` (`REMITO_IMEIS_DE_MAS`,
 * `REMITO_IMEI_REPETIDO`) son los que cuentan; esto los adelanta en pantalla
 * con los nombres puestos.
 */

/** Qué lleva IMEI en este comercio, tal como lo contesta la base para la
 * conciliación: productos (por ellos o su categoría) y categorías. */
export type SerieConciliacion = { productos: string[]; categorias: string[] };

export interface LineaConImei {
  id?: string;
  raw_nombre: string;
  raw_variante?: string | null;
  raw_imei?: string | null;
  imeis_completados?: string[] | null;
  cantidad: number;
  cantidad_recibida?: number | null;
}

/** Todos los IMEI del renglón, normalizados y sin vacíos. Sin deduplicar: un
 * número repetido es un error que se tiene que ver. Mismo criterio que
 * `imeis_linea_remito` en SQL. */
export function imeisDeLinea(linea: LineaConImei): string[] {
  return [linea.raw_imei, ...(linea.imeis_completados ?? [])]
    .map((imei) => normalizarImei(imei))
    .filter(Boolean);
}

/** Aparatos del renglón que entran sin número. Solo cuenta lo que entra al
 * stock: un renglón "no vino" no pide nada. */
export function aparatosSinImei(linea: LineaConImei): number {
  if (!entraAlStock(linea)) return 0;
  return Math.max(
    0,
    Math.floor(cantidadEfectiva(linea)) - imeisDeLinea(linea).length,
  );
}

export interface FaltanteImei {
  itemId: string | undefined;
  nombre: string;
  variante: string;
  faltan: number;
}

/** Renglones de productos que llevan IMEI y entran con aparatos sin número.
 * Es la lista de la alerta al aprobar. */
export function faltantesImei<T extends LineaConImei>(
  lineas: T[],
  llevaSerie: (linea: T) => boolean,
): FaltanteImei[] {
  return lineas
    .filter(llevaSerie)
    .map((linea) => ({
      itemId: linea.id,
      nombre: linea.raw_nombre,
      variante: linea.raw_variante || "Unico",
      faltan: aparatosSinImei(linea),
    }))
    .filter((f) => f.faltan > 0);
}

/** Total de aparatos sin número, para el título de la alerta. */
export function totalFaltantes(faltantes: FaltanteImei[]): number {
  return faltantes.reduce((total, f) => total + f.faltan, 0);
}

/**
 * Lo que la aprobación va a rechazar: más IMEI que unidades en un renglón, o
 * el mismo IMEI dos veces en el remito. Mensajes listos para mostrar; vacío =
 * nada que corregir. Los IMEI ya cargados en el comercio los frena la base.
 */
export function problemasImeis(lineas: LineaConImei[]): string[] {
  const problemas: string[] = [];
  const vistos = new Map<string, string>();
  const repetidos = new Set<string>();

  for (const linea of lineas) {
    if (!entraAlStock(linea)) continue;
    const imeis = imeisDeLinea(linea);
    const unidades = Math.floor(cantidadEfectiva(linea));
    if (imeis.length > unidades) {
      problemas.push(
        `${linea.raw_nombre}: ${imeis.length} IMEI para ${unidades} ${unidades === 1 ? "unidad" : "unidades"}.`,
      );
    }
    for (const imei of imeis) {
      if (vistos.has(imei)) repetidos.add(imei);
      else vistos.set(imei, linea.raw_nombre);
    }
  }

  for (const imei of repetidos) {
    problemas.push(`El IMEI ${imei} está dos veces en el remito.`);
  }
  return problemas;
}
