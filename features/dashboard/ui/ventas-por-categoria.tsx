"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatearMoneda } from "@/shared/utils/formatters";

type CategoriaVenta = { label: string; ingresos: number };

interface VentasPorCategoriaProps {
  categorias: CategoriaVenta[];
  /** "últimos 7 días": lo que gobierna el selector del panel. */
  etiquetaPeriodo: string;
}

// Las cinco que más facturan con color + "Otras" en gris. La paleta valida
// para daltonismo con cinco vecinas en claro y oscuro (ver --viz-* en
// globals.css); más porciones no se leen en un anillo.
const CATEGORIAS_CON_COLOR = 5;
const COLORES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)"];
const COLOR_OTRAS = "color-mix(in oklab, var(--muted-foreground) 30%, transparent)";
// Cuántas de "Otras" se nombran en su tooltip antes de "y N más".
const OTRAS_EN_TOOLTIP = 6;

const porcentaje = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 0 });

type Porcion = {
  label: string;
  valor: number;
  color: string;
  /** Solo "Otras": las categorías que junta. */
  contenido: CategoriaVenta[] | null;
};

/**
 * Las cinco categorías que más facturan en el período, y el resto junto.
 *
 * Donut a pedido de Nacho (12/10/2026). El color es por PUESTO y no por
 * categoría: con un período distinto la primera puede ser otra y cambia de
 * color. Por eso la identidad no queda solo en el color: la leyenda nombra
 * cada porción con su % (además, cuatro de los cinco tonos no llegan a 3:1
 * sobre blanco y la leyenda es la que los releva).
 *
 * La leyenda va en UNA línea por categoría (pedido de Nacho, 13/10/2026): un
 * nombre largo se corta, y el tooltip (oscuro, afuera del anillo) lo muestra
 * entero con el padre y el monto.
 */
export function VentasPorCategoria({ categorias, etiquetaPeriodo }: Readonly<VentasPorCategoriaProps>) {
  const [activa, setActiva] = useState<number | null>(null);

  const conVentas = categorias.filter((c) => c.ingresos > 0);
  const total = conVentas.reduce((acc, c) => acc + c.ingresos, 0);
  const otras = conVentas.slice(CATEGORIAS_CON_COLOR);
  const resto = otras.reduce((acc, c) => acc + c.ingresos, 0);
  const porciones: Porcion[] = [
    ...conVentas
      .slice(0, CATEGORIAS_CON_COLOR)
      .map((c, i) => ({ label: c.label, valor: c.ingresos, color: COLORES[i], contenido: null })),
    ...(resto > 0 ? [{ label: "Otras", valor: resto, color: COLOR_OTRAS, contenido: otras }] : []),
  ];

  return (
    <section
      aria-label="Top 5 categorías"
      className="flex h-full min-w-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold text-foreground">Top 5 categorías</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Las que más facturan · {etiquetaPeriodo}</p>

      {porciones.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
          Sin ventas en el período.
        </p>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-center gap-5 sm:flex-row lg:flex-col xl:flex-row">
          <div className="relative size-[148px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={porciones}
                  dataKey="valor"
                  nameKey="label"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={porciones.length > 1 ? 2 : 0}
                  cornerRadius={4}
                  stroke="none"
                  startAngle={90}
                  endAngle={-270}
                  isAnimationActive={false}
                  onMouseEnter={(_, i) => setActiva(i)}
                  onMouseLeave={() => setActiva(null)}
                >
                  {porciones.map((p, i) => (
                    <Cell
                      key={p.label}
                      fill={p.color}
                      fillOpacity={activa === null || activa === i ? 1 : 0.35}
                    />
                  ))}
                </Pie>
                {/* Afuera del anillo y sin límite del contenedor: el centro
                    mide 100px y ahí un nombre largo se cortaba. */}
                <Tooltip
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
                  isAnimationActive={false}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as Porcion | undefined;
                    if (!active || !p) return null;
                    return <DetallePorcion porcion={p} total={total} />;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] text-muted-foreground">Total</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">{formatearMoneda(total)}</span>
            </div>
          </div>

          <ul className="w-full min-w-0 space-y-2">
            {porciones.map((p, i) => (
              <li
                key={p.label}
                onMouseEnter={() => setActiva(i)}
                onMouseLeave={() => setActiva(null)}
                className="flex items-center gap-2 text-sm"
              >
                <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate" title={p.label.replace(" › ", " · ")}>
                  <Etiqueta label={p.label} />
                  {p.contenido && <span className="text-muted-foreground"> · {p.contenido.length}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {porcentaje.format(p.valor / total)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** El tooltip: nombre entero, monto y %. En "Otras", qué hay adentro. */
function DetallePorcion({ porcion: p, total }: Readonly<{ porcion: Porcion; total: number }>) {
  const { nombre, padre } = partirEtiqueta(p.label);
  return (
    <div className="w-max max-w-[240px] rounded-xl bg-foreground px-3 py-2.5 text-background shadow-lg">
      <p className="text-xs font-medium leading-snug">
        {nombre}
        {padre && <span className="opacity-70"> · {padre}</span>}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums">
        {formatearMoneda(p.valor)}
        <span className="ml-1.5 text-xs font-normal opacity-70">{porcentaje.format(p.valor / total)}</span>
      </p>
      {p.contenido && (
        <ul className="mt-2 space-y-0.5 border-t border-background/15 pt-2 text-[11px] leading-snug opacity-80">
          {p.contenido.slice(0, OTRAS_EN_TOOLTIP).map((c) => (
            <li key={c.label} className="flex justify-between gap-3">
              <span>{partirEtiqueta(c.label).nombre}</span>
              <span className="tabular-nums">{porcentaje.format(c.ingresos / total)}</span>
            </li>
          ))}
          {p.contenido.length > OTRAS_EN_TOOLTIP && <li>y {p.contenido.length - OTRAS_EN_TOOLTIP} más</li>}
        </ul>
      )}
    </div>
  );
}

/** "Mujer › Remeras" → nombre "Remeras", padre "Mujer". */
function partirEtiqueta(label: string): { nombre: string; padre: string | null } {
  const i = label.lastIndexOf(" › ");
  return i < 0 ? { nombre: label, padre: null } : { nombre: label.slice(i + 3), padre: label.slice(0, i) };
}

/** La subcategoría primero (es la que distingue) y el padre en gris. */
function Etiqueta({ label }: Readonly<{ label: string }>) {
  const { nombre, padre } = partirEtiqueta(label);
  return (
    <>
      <span className="text-foreground">{nombre}</span>
      {padre && <span className="text-muted-foreground"> · {padre}</span>}
    </>
  );
}
