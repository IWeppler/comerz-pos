/**
 * El nombre visible de una variante corregida, en el MISMO formato que tenía.
 *
 * Conviven dos formatos según por dónde entró la variante: la grilla escribe
 * solo los valores ("Rosado / 12/256") y el remito escribe propiedad y valor
 * ("Color: Rosado / Memoria: 12/256"). Corregir un valor no tiene por qué
 * cambiarle el formato al nombre: el POS y el ticket lo muestran tal cual.
 */
export function nombreDeVarianteCorregida(
  atributos: Record<string, string>,
  nombreAnterior: string,
): string {
  const entradas = Object.entries(atributos);
  const conPropiedad = entradas.some(([propiedad]) =>
    nombreAnterior.toLowerCase().includes(`${propiedad.toLowerCase()}:`),
  );
  return entradas
    .map(([propiedad, valor]) => (conPropiedad ? `${propiedad}: ${valor}` : valor))
    .join(" / ");
}
