export interface ParComplementario {
  producto_a_id: string;
  producto_a: string;
  producto_b_id: string;
  producto_b: string;
  ventas_juntas: number;
  ventas_a: number;
  ventas_b: number;
  activo: boolean;
  publicables: boolean;
}
export interface AnalisisComplementos {
  dias: number;
  puede_editar: boolean;
  pares: ParComplementario[];
}

/** Compras juntas mínimas para que un par sea señal y no coincidencia. Medido
 * en Evens (180 días): 85 pares con 2 compras juntas, 12 con 3 o más. Con 2,
 * "se compran juntos" es ruido. */
export const MIN_VENTAS_JUNTAS = 3;

/** Qué parte de las ventas del producto MENOS vendido del par tiene al otro
 * también. Evita pares donde un producto de 200 ventas aparece 3 veces con uno
 * de 3 ventas: el 1,5% no es una asociación. Medido en Evens: con 3+ juntas, 10
 * de 12 pares pasan el 20%. */
export const MIN_CONFIANZA_ASOCIACION = 0.2;

/** Tope de asociaciones que muestra Intelligence. */
export const MAX_ASOCIACIONES = 5;

/** Fracción de las ventas del producto menos vendido que aparece junto al otro. */
export function confianzaDelPar(par: ParComplementario): number {
  const base = Math.min(par.ventas_a, par.ventas_b);
  return base > 0 ? par.ventas_juntas / base : 0;
}

/** Elige las asociaciones que se muestran. Las ACTIVADAS por el admin van
 * siempre primero (son decisiones, no sugerencias), aunque sean débiles. Las
 * sugeridas pasan por el mínimo de compras juntas y de confianza, y se ordenan
 * por compras juntas y después por confianza. Corta en `max`. */
export function seleccionarAsociaciones(
  pares: ParComplementario[],
  max: number = MAX_ASOCIACIONES,
): ParComplementario[] {
  const activas = pares
    .filter((p) => p.activo)
    .sort((x, y) => y.ventas_juntas - x.ventas_juntas);
  const sugeridas = pares
    .filter(
      (p) =>
        !p.activo &&
        p.publicables &&
        p.ventas_juntas >= MIN_VENTAS_JUNTAS &&
        confianzaDelPar(p) >= MIN_CONFIANZA_ASOCIACION,
    )
    .sort(
      (x, y) =>
        y.ventas_juntas - x.ventas_juntas ||
        confianzaDelPar(y) - confianzaDelPar(x),
    );
  return [...activas, ...sugeridas].slice(0, Math.max(0, max));
}
