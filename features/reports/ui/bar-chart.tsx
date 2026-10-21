"use client";

import { useState, useRef, useEffect } from "react";
import * as d3 from "d3";

interface BarChartProps {
  data: { label: string; value: number }[];
  color?: string;
  valuePrefix?: string;
}

export function BarChart({
  data,
  color = "#00b3c2",
  valuePrefix = "$",
}: Readonly<BarChartProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const rowHeight = 45;
  // El margen izquierdo se adapta a la etiqueta más larga: con un margen fijo,
  // "Remeras · Mujer" se partía en dos líneas. Con etiquetas cortas queda en 100.
  const LARGO_MAX_ETIQUETA = 28;
  const largoEtiqueta = Math.min(
    d3.max(data, (d) => d.label.length) ?? 0,
    LARGO_MAX_ETIQUETA,
  );
  const margin = {
    top: 10,
    right: 60,
    bottom: 10,
    left: Math.min(Math.max(largoEtiqueta * 6.6 + 16, 100), 210),
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="h-[200px] w-full flex items-center justify-center text-muted-foreground text-sm bg-muted/20 rounded-xl border border-dashed border-border">
        No hay datos registrados en este período.
      </div>
    );
  }

  const height = data.length * rowHeight + margin.top + margin.bottom;

  if (width === 0)
    return <div ref={containerRef} style={{ height }} className="w-full" />;

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const maxValue = d3.max(data, (d) => d.value) || 0;

  // Escala X (Lineal para el ancho de la barra)
  const xScale = d3.scaleLinear().domain([0, maxValue]).range([0, innerWidth]);

  // Escala Y (Bandas para la posición vertical)
  const yScale = d3
    .scaleBand()
    .domain(data.map((d) => d.label))
    .range([0, innerHeight])
    .padding(0.3);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="relative w-full select-none"
    >
      <svg width={width} height={height} className="overflow-visible">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {data.map((d, i) => {
            const barWidth = xScale(d.value);
            const yPos = yScale(d.label) || 0;
            const barHeight = yScale.bandwidth();
            const isHovered = hoveredIndex === i;

            return (
              <g
                key={d.label}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="cursor-pointer"
              >
                {/* Texto Izquierdo (Categoría) */}
                <text
                  x={-10}
                  y={yPos + barHeight / 2}
                  dy="0.35em"
                  textAnchor="end"
                  className={`text-xs font-semibold transition-colors ${isHovered ? "fill-foreground" : "fill-muted-foreground"}`}
                >
                  {d.label.length > LARGO_MAX_ETIQUETA
                    ? d.label.substring(0, LARGO_MAX_ETIQUETA - 1) + "…"
                    : d.label}
                  <title>{d.label}</title>
                </text>

                {/* Fondo de la barra (Rail) */}
                <rect
                  x={0}
                  y={yPos}
                  width={innerWidth}
                  height={barHeight}
                  rx={4}
                  className="fill-muted/30"
                />

                {/* Barra Principal */}
                <rect
                  x={0}
                  y={yPos}
                  width={barWidth}
                  height={barHeight}
                  rx={4}
                  fill={color}
                  className={`transition-all duration-500 ease-out ${isHovered ? "opacity-100" : "opacity-85"}`}
                />

                {/* Texto Derecho (Valor) */}
                <text
                  x={barWidth + 10}
                  y={yPos + barHeight / 2}
                  dy="0.35em"
                  textAnchor="start"
                  className={`text-xs font-bold transition-colors ${isHovered ? "fill-foreground" : "fill-muted-foreground"}`}
                >
                  {valuePrefix}
                  {d.value.toLocaleString("es-AR")}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
