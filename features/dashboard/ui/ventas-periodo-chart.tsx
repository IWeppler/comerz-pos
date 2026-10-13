"use client";

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PuntoComparado } from "../lib/build-chart-series";
import { formatearMoneda } from "@/shared/utils/formatters";
import { MEDIA_MOBILE, useMediaQuery } from "@/shared/lib/use-media-query";

const compacto = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const porcentaje = new Intl.NumberFormat("es-AR", {
  style: "percent",
  maximumFractionDigits: 0,
});

// Ganancia y costo son dos partes de UNA cosa (la facturación): mismo tono,
// fuerte y suave. El período anterior va en gris punteado, detrás en jerarquía.
const COLOR_GANANCIA = "var(--viz-1)";
const COLOR_COSTO = "#4da0fa";
const COLOR_ANTERIOR = "var(--muted-foreground)";

interface VentasPeriodoChartProps {
  serie: PuntoComparado[];
  /** "Por día", "Por semana"… */
  etiquetaTramo: string;
  /** "últimos 28 días": lo que cubre el selector. */
  etiquetaPeriodo: string;
  /** "28 días previos": contra qué es la línea punteada. */
  etiquetaAnterior: string;
}

type Fila = PuntoComparado & { costoBarra: number; gananciaBarra: number };

/**
 * Gráfico de ventas del panel. Sigue al selector (13/10/2026, pedido de
 * Nacho): Hoy por hora, Semana y Mes por día, Trimestre por semana y Año por
 * mes (ver GRANULARIDAD_POR_PERIODO).
 *
 * Reemplaza las pestañas Facturación / Unidades / Ganancia, que dibujaban tres
 * veces casi la misma forma. Ahora UNA barra dice las tres cosas que importan:
 * su altura es la facturación, partida en lo que quedó de ganancia (abajo,
 * fuerte, pegada al piso para compararla entre tramos) y lo que costó la
 * mercadería (arriba, suave). Un tramo con barra alta
 * y poca parte fuerte es uno donde se vendió con poco margen. La línea
 * punteada es la facturación del mismo tramo en el período anterior (mismos
 * días de la semana), el contexto que las tarjetas dan solo como total.
 * El tooltip, corto: facturación, ganancia con margen, variación contra el
 * período anterior (solo el %) y ventas/unidades.
 *
 * El tramo en curso va translúcido: todavía no terminó y no es una caída.
 */
export function VentasPeriodoChart({
  serie,
  etiquetaTramo,
  etiquetaPeriodo,
  etiquetaAnterior,
}: Readonly<VentasPeriodoChartProps>) {
  const esMobile = useMediaQuery(MEDIA_MOBILE);

  const data: Fila[] = useMemo(
    () =>
      serie.map((p) => {
        const gananciaBarra = Math.max(0, Math.min(p.ganancia, p.ingresos));
        return {
          ...p,
          gananciaBarra,
          costoBarra: Math.max(0, p.ingresos - gananciaBarra),
        };
      }),
    [serie],
  );
  const hayAnterior = serie.some((p) => p.ingresosAnterior !== null);

  // En celular entran ~6 etiquetas; en compu ~8, o las 12 de "Año" (meses
  // de tres letras: entran todos y saltear uno confunde).
  const maxEtiquetas = esMobile ? 6 : data.length <= 12 ? 12 : 8;
  const intervaloTicks = Math.max(0, Math.ceil(data.length / maxEtiquetas) - 1);

  return (
    <section
      aria-label="Ventas del período"
      className="flex h-full min-w-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        {/* El tramo y el período van al lado del título, en un solo renglón:
            en celular el header ocupaba de más con el subtítulo abajo. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="text-base font-semibold text-foreground">Ventas</h2>
          <p className="text-xs text-muted-foreground">
            {etiquetaTramo} · {etiquetaPeriodo}
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Leyenda color={COLOR_GANANCIA}>Ganancia</Leyenda>
          <Leyenda color={COLOR_COSTO}>Costo de mercadería</Leyenda>
          {hayAnterior && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="w-3.5 border-t-[1.5px] border-dashed"
                style={{ borderColor: COLOR_ANTERIOR }}
              />
              {etiquetaAnterior}
            </li>
          )}
        </ul>
      </div>

      {/* Alto FIJO, sin flex-1: con flex-1 la base es 0 y, en celular (donde
          la tarjeta no tiene un alto dado por la grilla), el gráfico medía 0 y
          no se veía. touch-action pan-y: deslizar vertical scrollea la página; el
          horizontal mueve el tooltip. */}
      <div
        className="mt-4 h-[240px] w-full sm:h-[280px]"
        style={{ touchAction: "pan-y" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
            barCategoryGap={data.length > 20 ? "18%" : "30%"}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="etiqueta"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              interval={intervaloTicks}
              tickMargin={6}
            />
            <YAxis
              hide={esMobile}
              width={44}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(v: number) => `$${compacto.format(v)}`}
            />
            <Tooltip
              cursor={{ fill: "var(--muted-foreground)", fillOpacity: 0.06 }}
              offset={14}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Fila | undefined;
                if (!active || !p) return null;
                return (
                  <DetalleTramo punto={p} etiquetaAnterior={etiquetaAnterior} />
                );
              }}
            />
            {/* Ganancia ABAJO, pegada al piso: así la de cada tramo se compara
                directo contra las demás. El costo arriba completa la altura,
                que sigue siendo la facturación. */}
            <Bar
              dataKey="gananciaBarra"
              stackId="v"
              fill={COLOR_GANANCIA}
              maxBarSize={40}
              isAnimationActive={false}
            >
              {data.map((p) => (
                <Cell
                  key={p.etiquetaCompleta}
                  fillOpacity={p.enCurso ? 0.5 : 1}
                />
              ))}
            </Bar>
            {/* El trazo del color de la tarjeta separa las dos partes con 1px. */}
            <Bar
              dataKey="costoBarra"
              stackId="v"
              fill={COLOR_COSTO}
              stroke="var(--card)"
              strokeWidth={1}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
              isAnimationActive={false}
            >
              {data.map((p) => (
                <Cell
                  key={p.etiquetaCompleta}
                  fillOpacity={p.enCurso ? 0.5 : 1}
                />
              ))}
            </Bar>
            {hayAnterior && (
              <Line
                dataKey="ingresosAnterior"
                type="monotone"
                stroke={COLOR_ANTERIOR}
                strokeOpacity={0.7}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: COLOR_ANTERIOR }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Leyenda({
  color,
  children,
}: Readonly<{ color: string; children: React.ReactNode }>) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2.5 rounded-[3px]"
        style={{ background: color }}
      />
      {children}
    </li>
  );
}

/** El tooltip: todo lo del tramo en un solo lugar. */
function DetalleTramo({
  punto: p,
  etiquetaAnterior,
}: Readonly<{ punto: Fila; etiquetaAnterior: string }>) {
  const margen = p.ingresos > 0 ? p.ganancia / p.ingresos : null;
  const variacion =
    p.ingresosAnterior !== null && p.ingresosAnterior > 0
      ? p.ingresos / p.ingresosAnterior - 1
      : null;

  return (
    <div className="min-w-[200px] rounded-xl bg-foreground px-3 py-2.5 text-background shadow-lg">
      <p className="text-[11px] opacity-70">
        {p.etiquetaCompleta}
        {p.enCurso ? " · en curso" : ""}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">
        {formatearMoneda(p.ingresos)}
      </p>
      <dl className="mt-2 space-y-1 text-xs tabular-nums">
        <Renglon color={COLOR_GANANCIA} label="Ganancia">
          {formatearMoneda(p.ganancia)}
          {margen !== null && (
            <span className="opacity-70"> · {porcentaje.format(margen)}</span>
          )}
        </Renglon>
        {/* Del período anterior, solo la variación: el monto ya lo dibuja
            la línea punteada. El costo tampoco va: es la parte suave. */}
        {variacion !== null && (
          <Renglon label={`vs. ${etiquetaAnterior}`}>
            {variacion >= 0 ? "+" : "−"}
            {porcentaje.format(Math.abs(variacion))}
          </Renglon>
        )}
      </dl>
      <p className="mt-2 border-t border-background/15 pt-2 text-[11px] tabular-nums opacity-70">
        {p.tickets} {p.tickets === 1 ? "venta" : "ventas"} · {p.unidades} u.
      </p>
    </div>
  );
}

function Renglon({
  color,
  label,
  children,
}: Readonly<{ color?: string; label: string; children: React.ReactNode }>) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 opacity-80">
        {color ? (
          <span
            aria-hidden
            className="size-2 rounded-[2px]"
            style={{ background: color }}
          />
        ) : (
          <span
            aria-hidden
            className="w-2 border-t border-dashed border-current"
          />
        )}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
