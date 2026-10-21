import * as d3 from "d3";

interface MetodosPagoDonutProps {
  /** Ordenados de mayor a menor. */
  data: { label: string; bruto: number }[];
  formatearMoneda: (valor: number) => string;
}

/** Hasta cinco porciones de la paleta fija (`--viz-1..5`), en ese orden. Del
 * sexto medio en adelante se junta en "Otros" (gris neutro), nunca un color nuevo. */
const MAX_PORCIONES = 5;
const COLORES = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
];
const COLOR_OTROS = "var(--muted-foreground)";

/**
 * Medios de pago como donut + leyenda. Parte de un todo y hay pocos medios,
 * así que la proporción se lee de un vistazo. La leyenda da nombre, monto y
 * porcentaje: el color no es el único canal de identidad.
 */
export function MetodosPagoDonut({
  data,
  formatearMoneda,
}: Readonly<MetodosPagoDonutProps>) {
  const total = data.reduce((acc, m) => acc + m.bruto, 0);
  if (total <= 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Sin datos registrados.
      </p>
    );
  }

  const visibles = data.slice(0, MAX_PORCIONES);
  const resto = data.slice(MAX_PORCIONES);
  const porciones = [
    ...visibles.map((m, i) => ({ label: m.label, valor: m.bruto, color: COLORES[i] })),
    ...(resto.length > 0
      ? [{ label: `Otros (${resto.length})`, valor: resto.reduce((a, m) => a + m.bruto, 0), color: COLOR_OTROS }]
      : []),
  ];

  const size = 168;
  const radio = size / 2;
  const arco = d3.arc().innerRadius(radio * 0.62).outerRadius(radio);
  type Porcion = (typeof porciones)[number];
  const angulos = d3.pie<Porcion>().value((d) => d.valor).sort(null)(porciones);

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`${-radio} ${-radio} ${size} ${size}`}
          role="img"
          aria-label={`Medios de pago, total ${formatearMoneda(total)}`}
        >
          {angulos.map((a) => (
            <path
              key={a.data.label}
              d={arco(a as unknown as d3.DefaultArcObject) ?? ""}
              fill={a.data.color}
              // Separación de 2px entre porciones: el fondo de la tarjeta la marca.
              stroke="var(--card)"
              strokeWidth={2}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted-foreground">Cobrado</span>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatearMoneda(total)}
          </span>
        </div>
      </div>

      <ul className="w-full space-y-2.5">
        {porciones.map((p) => {
          const porcentaje = Math.round((p.valor / total) * 100);
          return (
            <li key={p.label} className="flex items-center gap-2.5 text-sm">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: p.color }}
              />
              <span className="min-w-0 flex-1 break-words text-foreground">{p.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{porcentaje}%</span>
              <span className="shrink-0 tabular-nums font-semibold text-foreground">
                {formatearMoneda(p.valor)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
