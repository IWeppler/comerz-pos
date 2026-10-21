interface RankingCategoriasProps {
  /** Ya ordenadas de mayor a menor. */
  data: { label: string; value: number; detalle?: string }[];
  /** Suma de TODAS las categorías (no solo las que se muestran), para el % real. */
  total: number;
  formatearValor: (valor: number) => string;
}

/**
 * Ranking de categorías: una fila por categoría con el nombre entero (en HTML
 * el texto se acomoda solo, no se corta como en un SVG), una barra de
 * proporción y el valor. En celular el nombre va arriba y la barra debajo;
 * desde sm, nombre | barra | valor en una línea.
 *
 * Un solo acento (--viz-1): la categoría se lee por el nombre, la barra solo
 * dice cuánto pesa cada una. Sin ejes ni leyenda que descifrar.
 */
export function RankingCategorias({
  data,
  total,
  formatearValor,
}: Readonly<RankingCategoriasProps>) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-sm text-muted-foreground">
        No hay datos registrados en este período.
      </div>
    );
  }

  const maximo = Math.max(...data.map((d) => d.value), 0);

  return (
    <ol className="flex flex-col gap-3">
      {data.map((fila, idx) => {
        const ancho = maximo > 0 ? (fila.value / maximo) * 100 : 0;
        const porcentaje = total > 0 ? Math.round((fila.value / total) * 100) : 0;
        return (
          <li
            key={`${fila.label}-${idx}`}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,14rem)_1fr_auto]"
          >
            <span className="min-w-0 break-words text-sm font-medium leading-snug text-foreground sm:truncate sm:break-normal">
              {fila.label}
              {fila.detalle ? (
                <span className="block text-xs font-normal text-muted-foreground">{fila.detalle}</span>
              ) : null}
            </span>
            <span className="text-right text-sm font-semibold tabular-nums text-foreground sm:order-last">
              {formatearValor(fila.value)}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {porcentaje}%
              </span>
            </span>
            <div
              role="img"
              aria-label={`${fila.label}: ${formatearValor(fila.value)}, ${porcentaje}% del total`}
              className="col-span-2 h-2.5 w-full overflow-hidden rounded-full bg-muted sm:col-span-1"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${ancho}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
