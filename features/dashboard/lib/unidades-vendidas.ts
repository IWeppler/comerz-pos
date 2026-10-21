import {
  normalizarUnidadMedida,
  type UnidadMedida,
} from "@/shared/lib/fiscal-producto";
import { esFraccionable, formatearCantidad } from "@/shared/lib/unidad-venta";

/**
 * Las "unidades vendidas" del panel, separando piezas de peso/volumen/largo.
 *
 * Hasta el 15/9/2026 la KPI sumaba `ventas_items.cantidad` sin mirar la
 * unidad, y en Librería Colores mostró 1165,206: 1.165 piezas más 0,129 kg de
 * nueces y 0,077 kg de Rocklets. No es un número roto, es una suma que mezcla
 * magnitudes — y el día que un kiosco venda 40 kg de caramelos le va a sumar
 * 40 "unidades" que no existen.
 *
 * Regla: solo lo que se vende por PIEZA cuenta como unidad. Lo fraccionable
 * se acumula aparte, por su propia unidad, y la tarjeta lo dice al lado
 * ("+ 0,206 kg"). No se convierte gramos a kilos ni se suma entre unidades
 * distintas: 0,5 kg y 2 m no son "2,5" de nada.
 */
export type AcumuladorUnidades = {
  /** Piezas: solo renglones con unidad no fraccionable. */
  piezas: number;
  /** Lo fraccionable, por unidad. */
  fraccionado: Partial<Record<UnidadMedida, number>>;
};

export function nuevoAcumuladorUnidades(): AcumuladorUnidades {
  return { piezas: 0, fraccionado: {} };
}

export function acumularUnidad(
  acc: AcumuladorUnidades,
  cantidad: number,
  unidadMedida: unknown,
): void {
  if (!cantidad) return;
  if (!esFraccionable(unidadMedida)) {
    acc.piezas += cantidad;
    return;
  }
  const unidad = normalizarUnidadMedida(unidadMedida);
  acc.fraccionado[unidad] = (acc.fraccionado[unidad] ?? 0) + cantidad;
}

export type FraccionadoVendido = { unidad: UnidadMedida; cantidad: number };

/** Lo fraccionable como lista estable (por unidad, mayor primero). */
export function listarFraccionado(
  acc: Pick<AcumuladorUnidades, "fraccionado">,
): FraccionadoVendido[] {
  return (Object.entries(acc.fraccionado) as [UnidadMedida, number][])
    .filter(([, cantidad]) => cantidad > 0)
    .map(([unidad, cantidad]) => ({ unidad, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

/** "+ 0,206 kg · 3 m", o null si no hubo nada por peso/volumen/largo. */
export function etiquetaFraccionado(
  fraccionado: FraccionadoVendido[],
): string | null {
  if (fraccionado.length === 0) return null;
  return (
    "+ " +
    fraccionado.map((f) => formatearCantidad(f.cantidad, f.unidad)).join(" · ")
  );
}

/** Unidad de medida de un renglón: la relación `producto` puede llegar como
 * objeto o como lista de un elemento, según la consulta. */
function unidadDelRenglon(producto: unknown): unknown {
  const p = Array.isArray(producto) ? producto[0] : producto;
  return (p as { unidad_medida?: unknown } | null | undefined)?.unidad_medida ?? null;
}

/**
 * Cuántas PIEZAS tiene una venta, contando solo sus renglones por pieza.
 *
 * `ventas.cantidad` NO sirve para esto: es la suma de todos los renglones sin
 * mirar la unidad, así que un ticket con 2 kg de caramelos y 3 alfajores daba
 * 5. Medido en El Nono Cacho: las 314 ventas con algo por peso tienen esa suma
 * mezclada. Una venta sin renglones cargados cuenta 0: no se inventa un número.
 */
export function piezasDeVenta(
  items: readonly { cantidad?: unknown; producto?: unknown }[] | null | undefined,
): number {
  const acc = nuevoAcumuladorUnidades();
  for (const item of items ?? []) {
    acumularUnidad(acc, Number(item.cantidad ?? 0), unidadDelRenglon(item.producto));
  }
  return acc.piezas;
}
