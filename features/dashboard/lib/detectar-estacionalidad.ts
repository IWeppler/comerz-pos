import { ProductoPanel } from "@/entities/productos/types";
import { Venta } from "@/entities/ventas/types";
import type { CategoriaBase } from "@/shared/utils/category-tree";
import { calcularUnidadesVendidasRecientes } from "./detectar-quiebres";

/**
 * Calendario estacional de Argentina (hemisferio sur) — hardcodeado a
 * propósito, sin forecasting: son rangos de fecha conocidos, no algo que
 * haga falta predecir.
 *
 *   Invierno:     1 jun - 30 sep
 *   Verano:       1 dic - 31 mar
 *   Entretiempo:  abr-may, oct-nov (buffer entre temporadas — no dispara
 *                 ningún insight propio, es simplemente el período en el
 *                 que caen las ventanas de "se acerca X" de abajo)
 *   Fiestas:      1 nov - 31 dic
 */
export type Temporada = "invierno" | "verano" | "fiestas";

interface DefinicionTemporada {
  id: Temporada;
  inicioMes: number; // 1-12
  inicioDia: number;
  finMes: number;
  finDia: number;
  /** Keywords para matchear contra `categoria.slug` (ya normalizado por
   * generateSlug: sin tildes, minúsculas, guionado) — mapeo manual de
   * categoría→temporada, NUNCA nombres de producto. */
  keywordsCategoria: string[];
  /** Frase ya conjugada para el mensaje de "se acerca" (singular/plural
   * varían: "el invierno" vs "las fiestas" — más simple tenerla resuelta
   * acá que reconstruir gramática género/número en el motor de insights). */
  fraseSeAcerca: string;
  /** Solo invierno/verano tienen regla de liquidación de fin de temporada
   * (ver Prompt) — fiestas no la necesita, por eso es opcional y
   * `detectarFinDeTemporada` simplemente ignora las que no la tienen. */
  fraseFinDeTemporada?: string;
}

export const TEMPORADAS: DefinicionTemporada[] = [
  {
    id: "invierno",
    inicioMes: 6,
    inicioDia: 1,
    finMes: 9,
    finDia: 30,
    keywordsCategoria: [
      "campera",
      "chaleco",
      "tapado",
      "sueter",
      "abrigo",
      "buzo",
      "bota",
      "borcego",
    ],
    fraseSeAcerca: "Se acerca el invierno",
    fraseFinDeTemporada: "Se acerca el fin del invierno",
  },
  {
    id: "verano",
    inicioMes: 12,
    inicioDia: 1,
    finMes: 3,
    finDia: 31,
    keywordsCategoria: [
      "remera",
      "musculosa",
      "short",
      "bermuda",
      "sandalia",
      "malla",
      "camiseta",
    ],
    fraseSeAcerca: "Se acerca el verano",
    fraseFinDeTemporada: "Se acerca el fin del verano",
  },
  {
    id: "fiestas",
    inicioMes: 11,
    inicioDia: 1,
    finMes: 12,
    finDia: 31,
    keywordsCategoria: ["vestido", "conjunto", "salir"],
    fraseSeAcerca: "Se acercan las fiestas",
  },
];

// "Últimas 2-3 semanas de la temporada" (regla de liquidación).
export const DIAS_VENTANA_FIN_TEMPORADA = 21;
// "3-4 semanas antes de que arranque la temporada siguiente" (regla de reposición).
export const DIAS_VENTANA_PROXIMA_TEMPORADA = 28;

// Stock valorizado de la categoría estacional por encima de este % del
// valorizado total del inventario cuenta como "alto" — un piso relativo al
// tamaño real del catálogo, no un monto fijo que no escala entre comercios.
const PROPORCION_VALORIZADO_ALTO = 0.15;
// Unidades vendidas en la ventana de rotación / unidades en stock: por
// debajo de este ratio, la categoría "no se está moviendo" de verdad.
const TASA_ROTACION_BAJA = 0.05;
// Stock de la temporada próxima por debajo de este % del promedio de
// stock por categoría raíz cuenta como "poco" — mismo criterio de piso
// relativo, para no hardcodear una cantidad fija de unidades.
const PROPORCION_STOCK_BAJO = 0.4;

function sumaStockProducto(producto: ProductoPanel): number {
  return (producto.stock || []).reduce(
    (acc, s) => acc + Number(s.cantidad || 0),
    0,
  );
}

function categoriaRaiz(
  categoriaId: string,
  categoriasById: Map<string, CategoriaBase>,
): CategoriaBase | undefined {
  let actual = categoriasById.get(categoriaId);
  let profundidad = 0;
  while (actual?.parent_id && profundidad < 5) {
    actual = categoriasById.get(actual.parent_id);
    profundidad++;
  }
  return actual;
}

/** Matchea la categoría de un producto (o cualquiera de sus ancestros —
 * defensivo para cuando el árbol tenga más niveles) contra las keywords de
 * una temporada, comparando por `slug` (ya sin tildes/mayúsculas). */
function categoriaMatchesTemporada(
  categoriaId: string,
  categoriasById: Map<string, CategoriaBase>,
  keywords: string[],
): boolean {
  let actual = categoriasById.get(categoriaId);
  let profundidad = 0;
  while (actual && profundidad < 5) {
    if (keywords.some((kw) => actual!.slug.includes(kw))) return true;
    actual = actual.parent_id ? categoriasById.get(actual.parent_id) : undefined;
    profundidad++;
  }
  return false;
}

export type ResultadoFinDeTemporada = {
  temporada: Temporada;
  frase: string;
  valorizado: number;
  unidadesVendidasRecientes: number;
};

/**
 * Fin de temporada + stock remanente sin rotación → liquidación. Solo
 * dispara en las últimas `DIAS_VENTANA_FIN_TEMPORADA` de invierno o
 * verano, y solo si la categoría estacional tiene stock valorizado alto
 * (relativo al total) Y venía vendiendo poco en la ventana de rotación
 * reciente — evita avisar de "liquidá" algo que ya se está vendiendo bien.
 */
export function detectarFinDeTemporada(
  ventasOperativas: Venta[],
  productos: ProductoPanel[],
  categoriasFlat: CategoriaBase[],
  stockValorizadoCostoTotal: number,
  ventanaRotacionDias: number,
  ahora: Date,
): ResultadoFinDeTemporada | null {
  const categoriasById = new Map(categoriasFlat.map((c) => [c.id, c]));
  const unidadesPorProducto = calcularUnidadesVendidasRecientes(
    ventasOperativas,
    ventanaRotacionDias,
    ahora,
  );

  for (const temporada of TEMPORADAS) {
    if (!temporada.fraseFinDeTemporada) continue;

    const finDate = new Date(
      ahora.getFullYear(),
      temporada.finMes - 1,
      temporada.finDia,
    );
    const inicioVentana = new Date(finDate);
    inicioVentana.setDate(inicioVentana.getDate() - DIAS_VENTANA_FIN_TEMPORADA);
    if (ahora < inicioVentana || ahora > finDate) continue;

    let valorizado = 0;
    let stockUnidades = 0;
    let unidadesVendidasRecientes = 0;

    for (const producto of productos) {
      if (!producto.categoria_id) continue;
      if (
        !categoriaMatchesTemporada(
          producto.categoria_id,
          categoriasById,
          temporada.keywordsCategoria,
        )
      )
        continue;

      const stockProducto = sumaStockProducto(producto);
      valorizado += stockProducto * Number(producto.precio_costo || 0);
      stockUnidades += stockProducto;
      unidadesVendidasRecientes += unidadesPorProducto.get(producto.id) ?? 0;
    }

    if (stockUnidades === 0) continue;

    const valorizadoAlto =
      stockValorizadoCostoTotal > 0 &&
      valorizado / stockValorizadoCostoTotal > PROPORCION_VALORIZADO_ALTO;
    const tasaRotacion = unidadesVendidasRecientes / stockUnidades;

    if (valorizadoAlto && tasaRotacion < TASA_ROTACION_BAJA) {
      return {
        temporada: temporada.id,
        frase: temporada.fraseFinDeTemporada,
        valorizado,
        unidadesVendidasRecientes,
      };
    }
  }

  return null;
}

export type ResultadoProximaTemporada = {
  temporada: Temporada;
  frase: string;
  stockUnidades: number;
};

/**
 * Se acerca una temporada (incluidas las fiestas) y el stock de sus
 * categorías típicas está bajo → reposición. "Bajo" es relativo al
 * promedio de stock por categoría raíz del catálogo actual — así se
 * autoajusta al tamaño real del comercio en vez de un piso fijo de
 * unidades que no escala entre clientes.
 */
export function detectarProximaTemporada(
  productos: ProductoPanel[],
  categoriasFlat: CategoriaBase[],
  ahora: Date,
): ResultadoProximaTemporada | null {
  const categoriasById = new Map(categoriasFlat.map((c) => [c.id, c]));

  const stockPorCategoriaRaiz = new Map<string, number>();
  for (const producto of productos) {
    if (!producto.categoria_id) continue;
    const raiz = categoriaRaiz(producto.categoria_id, categoriasById);
    if (!raiz) continue;
    stockPorCategoriaRaiz.set(
      raiz.id,
      (stockPorCategoriaRaiz.get(raiz.id) ?? 0) + sumaStockProducto(producto),
    );
  }

  const valoresRaiz = Array.from(stockPorCategoriaRaiz.values());
  const promedioStockPorCategoria =
    valoresRaiz.length > 0
      ? valoresRaiz.reduce((a, b) => a + b, 0) / valoresRaiz.length
      : 0;

  if (promedioStockPorCategoria === 0) return null;

  for (const temporada of TEMPORADAS) {
    const inicioDate = new Date(
      ahora.getFullYear(),
      temporada.inicioMes - 1,
      temporada.inicioDia,
    );
    const inicioVentana = new Date(inicioDate);
    inicioVentana.setDate(
      inicioVentana.getDate() - DIAS_VENTANA_PROXIMA_TEMPORADA,
    );
    if (ahora < inicioVentana || ahora >= inicioDate) continue;

    let stockUnidades = 0;
    for (const producto of productos) {
      if (!producto.categoria_id) continue;
      if (
        !categoriaMatchesTemporada(
          producto.categoria_id,
          categoriasById,
          temporada.keywordsCategoria,
        )
      )
        continue;
      stockUnidades += sumaStockProducto(producto);
    }

    if (stockUnidades < promedioStockPorCategoria * PROPORCION_STOCK_BAJO) {
      return {
        temporada: temporada.id,
        frase: temporada.fraseSeAcerca,
        stockUnidades,
      };
    }
  }

  return null;
}
