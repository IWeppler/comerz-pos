import { ProductoPanel } from "@/entities/productos/types";
import { Venta } from "@/entities/ventas/types";
import { calcularUnidadesVendidasRecientes } from "./detectar-quiebres";

export type CategoriaRiesgoStock = {
  categoriaId: string;
  unidadesVendidas: number;
  stockRestante: number;
  diasCobertura: number;
};

// Piso de unidades vendidas en la ventana para considerar que una
// categoría "rota de verdad" — evita que 1-2 ventas sueltas disparen la
// alerta en una categoría chica.
const UNIDADES_MINIMAS_ALTA_ROTACION = 5;

// Si al ritmo de venta reciente el stock remanente se agota en menos de
// estos días, es urgente reponer. No existe un historial de niveles de
// stock (no hay tabla de snapshots), así que en vez de comparar contra un
// "stock pico" pasado, proyectamos directo: stock actual / velocidad
// diaria reciente.
const DIAS_COBERTURA_CRITICA = 7;

/**
 * Categorías con alta rotación reciente cuyo stock total remanente se
 * está por agotar al ritmo de venta actual — reemplaza (junto con
 * detectarStockCriticoRotacion) la vieja regla de "stock ≤3 global" del
 * motor de insights. Ordenado por días de cobertura ascendente (la más
 * urgente primero).
 */
export function detectarCategoriasEnRiesgo(
  ventasOperativas: Venta[],
  productos: ProductoPanel[],
  ventanaDias: number,
  ahora: Date,
): CategoriaRiesgoStock[] {
  const unidadesPorProducto = calcularUnidadesVendidasRecientes(
    ventasOperativas,
    ventanaDias,
    ahora,
  );

  if (unidadesPorProducto.size === 0) return [];

  const productosById = new Map(productos.map((p) => [p.id, p]));

  const unidadesPorCategoria = new Map<string, number>();
  for (const [productoId, unidades] of unidadesPorProducto) {
    const categoriaId = productosById.get(productoId)?.categoria_id;
    if (!categoriaId) continue;
    unidadesPorCategoria.set(
      categoriaId,
      (unidadesPorCategoria.get(categoriaId) ?? 0) + unidades,
    );
  }

  if (unidadesPorCategoria.size === 0) return [];

  const stockPorCategoria = new Map<string, number>();
  for (const producto of productos) {
    if (!producto.categoria_id) continue;
    const stockProducto = (producto.stock || []).reduce(
      (acc, s) => acc + Number(s.cantidad || 0),
      0,
    );
    stockPorCategoria.set(
      producto.categoria_id,
      (stockPorCategoria.get(producto.categoria_id) ?? 0) + stockProducto,
    );
  }

  const resultado: CategoriaRiesgoStock[] = [];
  for (const [categoriaId, unidadesVendidas] of unidadesPorCategoria) {
    if (unidadesVendidas < UNIDADES_MINIMAS_ALTA_ROTACION) continue;

    const stockRestante = stockPorCategoria.get(categoriaId) ?? 0;
    const velocidadDiaria = unidadesVendidas / ventanaDias;
    const diasCobertura =
      velocidadDiaria > 0 ? stockRestante / velocidadDiaria : Infinity;

    if (diasCobertura < DIAS_COBERTURA_CRITICA) {
      resultado.push({
        categoriaId,
        unidadesVendidas,
        stockRestante,
        diasCobertura,
      });
    }
  }

  return resultado.sort((a, b) => a.diasCobertura - b.diasCobertura);
}
