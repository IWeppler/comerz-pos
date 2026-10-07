/**
 * Parte cada renglón con aparatos (IMEI / número de serie) en un renglón por
 * aparato.
 *
 * El ticket, el historial y la devolución leen el IMEI de
 * `ventas_items.unidad_serie_id`, que es UNO por fila. Hasta el 1/10/2026 eso
 * hacía imposible vender dos A56 iguales en un ticket: el carrito los junta en
 * una línea de cantidad 2 y create-sale la rechazaba.
 *
 * Partir es exacto porque descuento y precio final ya son POR UNIDAD: dos filas
 * de cantidad 1 suman lo mismo que una de cantidad 2. Stock, totales y factura
 * siguen trabajando con la línea entera; esto es solo la forma en que se graba.
 *
 * Lo que no tiene IMEI (se venden 3 y solo 2 tienen número) queda en un renglón
 * aparte, sin unidad. SALVO en los productos que llevan IMEI (`partirSinUnidad`,
 * por índice): ahí cada aparato sin número va en su propio renglón de cantidad
 * 1, para que el historial pueda completarle el IMEI después
 * (`completar_imei_venta_item` ata un número a un renglón de UN aparato). Antes
 * dos Redmi vendidos sin IMEI quedaban en un renglón de cantidad 2 y ninguno se
 * podía completar (7/10/2026).
 */
export function renglonesPorAparato<T extends { cantidad: number }>(
  items: T[],
  unidadesPorRenglon: ReadonlyMap<number, string[]>,
  partirSinUnidad: ReadonlySet<number> = new Set(),
): { item: T; cantidad: number; unidadSerieId: string | null }[] {
  return items.flatMap((item, indice) => {
    const unidades = unidadesPorRenglon.get(indice) ?? [];
    if (unidades.length > item.cantidad) {
      // Nunca debería pasar: create-sale toma como mucho `cantidad`. Si pasa,
      // grabar más aparatos que unidades vendidas es inventar mercadería.
      throw new Error(
        `Renglón ${indice}: ${unidades.length} aparatos para ${item.cantidad} unidades`,
      );
    }
    const sinUnidad = item.cantidad - unidades.length;
    // Solo con cantidad entera: con 1,5 no hay aparatos que contar.
    const partir =
      partirSinUnidad.has(indice) && Number.isInteger(sinUnidad) && sinUnidad > 1;
    const restoSinUnidad =
      sinUnidad <= 0
        ? []
        : partir
          ? Array.from({ length: sinUnidad }, () => ({
              item,
              cantidad: 1,
              unidadSerieId: null,
            }))
          : [{ item, cantidad: sinUnidad, unidadSerieId: null }];

    return [
      ...unidades.map((unidadSerieId) => ({ item, cantidad: 1, unidadSerieId })),
      ...restoSinUnidad,
    ];
  });
}
