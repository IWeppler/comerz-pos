"use client";

import { useMemo, useState, useRef, useEffect, useId } from "react";
import * as d3 from "d3";
import { Venta } from "@/entities/ventas/types";

interface SalesChartProps {
  ventas: Venta[];
  periodo: string;
  desde?: string;
  hasta?: string;
}

/** Un punto del eje X. `current` es el período elegido, `previous` el de
 * comparación. `null` = todavía no ocurrió (no dibuja la línea ahí). */
interface PuntoGrafico {
  dateObj: Date;
  label: string;
  prevLabel: string;
  current: number | null;
  previous: number | null;
}

// Helpers de fechas
const resetTime = (d: Date) => {
  const newD = new Date(d);
  newD.setHours(0, 0, 0, 0);
  return newD;
};
const endOfDay = (d: Date) => {
  const newD = new Date(d);
  newD.setHours(23, 59, 59, 999);
  return newD;
};
const addDays = (d: Date, days: number) => {
  const newD = new Date(d);
  newD.setDate(newD.getDate() + days);
  return newD;
};

const formatoMoneda = (valor: number) => `$${valor.toLocaleString("es-AR")}`;

export function SalesChart({
  ventas,
  periodo,
  desde,
  hasta,
}: Readonly<SalesChartProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const gradientId = useId();
  const height = 320;
  const margin = { top: 20, right: 20, bottom: 30, left: 60 };

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // --- 1. PROCESAMIENTO INTELIGENTE DE LÍNEAS MULTIPLES ---
  const data = useMemo(() => {
    const now = new Date();
    let currStart = new Date(0),
      currEnd = new Date();
    let prevStart = new Date(0),
      prevEnd = new Date(0);
    let points: PuntoGrafico[] = [];
    let hasPrevious = true;

    // A. Construir el andamiaje (Puntos base en el eje X)
    if (periodo === "hoy") {
      currStart = resetTime(now);
      currEnd = endOfDay(now);
      prevStart = addDays(currStart, -1);
      prevEnd = endOfDay(prevStart);

      const currentHour = now.getHours();
      for (let i = 0; i < 24; i++) {
        const d = new Date(currStart);
        d.setHours(i);
        points.push({
          dateObj: d,
          label: `${i}:00 hs`,
          prevLabel: "Ayer",
          current: i <= currentHour ? 0 : null, // Null oculta la línea en horas futuras
          previous: 0,
        });
      }
    } else if (periodo === "7dias") {
      currStart = resetTime(addDays(now, -6));
      currEnd = endOfDay(now);
      prevStart = addDays(currStart, -13);
      prevEnd = endOfDay(addDays(currStart, -1));

      for (let i = 0; i <= 6; i++) {
        const d = addDays(currStart, i);
        points.push({
          dateObj: d,
          label: d.toLocaleDateString("es-AR", { weekday: "short" }),
          prevLabel: "Semana ant.",
          current: 0,
          previous: 0,
        });
      }
    } else if (periodo === "30dias") {
      currStart = resetTime(addDays(now, -29));
      currEnd = endOfDay(now);
      prevStart = addDays(currStart, -30);
      prevEnd = endOfDay(addDays(currStart, -1));

      for (let i = 0; i < 30; i++) {
        const d = addDays(currStart, i);
        points.push({
          dateObj: d,
          label: d.toLocaleDateString("es-AR", {
            day: "numeric",
            month: "short",
          }),
          prevLabel: "Mes ant.",
          current: 0,
          previous: 0,
        });
      }
    } else if (periodo === "mes" || periodo === "mes_anterior") {
      const isMesActual = periodo === "mes";
      currStart = new Date(
        now.getFullYear(),
        now.getMonth() - (isMesActual ? 0 : 1),
        1,
      );
      currEnd = endOfDay(
        new Date(now.getFullYear(), now.getMonth() + (isMesActual ? 1 : 0), 0),
      );
      prevStart = new Date(
        now.getFullYear(),
        now.getMonth() - (isMesActual ? 1 : 2),
        1,
      );
      prevEnd = endOfDay(
        new Date(now.getFullYear(), now.getMonth() - (isMesActual ? 0 : 1), 0),
      );

      const days = currEnd.getDate();
      const currentDay = now.getDate();

      for (let i = 1; i <= days; i++) {
        const d = new Date(currStart);
        d.setDate(i);
        points.push({
          dateObj: d,
          label: `${i} ${d.toLocaleDateString("es-AR", { month: "short" })}`,
          prevLabel: "Mes ant.",
          current: isMesActual && i > currentDay ? null : 0,
          previous: 0,
        });
      }
    } else if (periodo === "anio") {
      currStart = new Date(now.getFullYear(), 0, 1);
      currEnd = endOfDay(new Date(now.getFullYear(), 11, 31));
      prevStart = new Date(now.getFullYear() - 1, 0, 1);
      prevEnd = endOfDay(new Date(now.getFullYear() - 1, 11, 31));

      const currentMonth = now.getMonth();
      for (let i = 0; i < 12; i++) {
        const d = new Date(currStart);
        d.setMonth(i);
        points.push({
          dateObj: d,
          label: d.toLocaleDateString("es-AR", { month: "short" }),
          prevLabel: "Año ant.",
          current:
            i > currentMonth && now.getFullYear() === currStart.getFullYear()
              ? null
              : 0,
          previous: 0,
        });
      }
    } else {
      // Personalizado / Histórico (Fallback de 1 sola línea)
      hasPrevious = false;
      const grouped = new Map<string, PuntoGrafico>();
      const ds = desde ? new Date(desde + "T00:00:00") : new Date(0);
      const hs = hasta
        ? endOfDay(new Date(hasta + "T23:59:59"))
        : endOfDay(now);

      ventas.forEach((v) => {
        const d = new Date(v.fecha_venta);
        if (periodo === "personalizado" && (d < ds || d > hs)) return;

        const norm = resetTime(d);
        if (periodo === "historico") {
          norm.setDate(1); // Agrupamos por mes en histórico
        }
        const key = norm.toISOString();

        if (!grouped.has(key)) {
          grouped.set(key, {
            dateObj: norm,
            label: norm.toLocaleDateString("es-AR", {
              day: "numeric",
              month: "short",
              year: periodo === "historico" ? "2-digit" : undefined,
            }),
            prevLabel: "",
            current: 0,
            previous: null,
          });
        }
        const punto = grouped.get(key);
        if (punto && punto.current !== null) punto.current += Number(v.total);
      });
      points = Array.from(grouped.values()).sort(
        (a, b) => a.dateObj.getTime() - b.dateObj.getTime(),
      );

      // Truco visual si solo hay 1 venta
      if (points.length === 1) {
        points.unshift({
          dateObj: addDays(points[0].dateObj, -1),
          label: "Previo",
          prevLabel: "",
          current: 0,
          previous: null,
        });
      }
    }

    // B. Mapear las Ventas reales a los Puntos de anclaje
    ventas.forEach((v) => {
      const d = new Date(v.fecha_venta);
      const total = Number(v.total);

      // Calculador de Índices
      const getIdx = (date: Date, start: Date) => {
        if (periodo === "hoy") return date.getHours();
        if (periodo === "mes" || periodo === "mes_anterior")
          return date.getDate() - 1;
        if (periodo === "anio") return date.getMonth();
        return Math.floor(
          (resetTime(date).getTime() - resetTime(start).getTime()) / 86400000,
        );
      };

      if (d >= currStart && d <= currEnd) {
        const idx = getIdx(d, currStart);
        if (points[idx] && points[idx].current !== null)
          points[idx].current += total;
      } else if (hasPrevious && d >= prevStart && d <= prevEnd) {
        const idx = getIdx(d, prevStart);
        if (points[idx] && points[idx].previous !== null)
          points[idx].previous += total;
      }
    });

    return { points, hasPrevious };
  }, [ventas, periodo, desde, hasta]);

  // --- 2. Tooltip Interactivo ---
  const [hoveredData, setHoveredData] = useState<{
    x: number;
    y: number;
    data: PuntoGrafico;
  } | null>(null);

  if (data.points.length === 0) {
    return (
      <div className="h-[320px] w-full flex items-center justify-center text-muted-foreground text-sm bg-muted/20 rounded-xl border border-dashed border-border">
        No hay suficientes datos.
      </div>
    );
  }
  if (width === 0)
    return <div ref={containerRef} className="h-[320px] w-full" />;

  // --- 3. D3 Scales & Generators ---
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xScale = d3
    .scaleTime()
    .domain(d3.extent(data.points, (d) => d.dateObj) as [Date, Date])
    .range([0, innerWidth]);

  const maxTotal =
    d3.max(data.points, (d) => Math.max(d.current || 0, d.previous || 0)) || 0;
  const yScale = d3
    .scaleLinear()
    .domain([0, Math.max(100, maxTotal * 1.15)]) // 15% extra de respiro arriba
    .range([innerHeight, 0]);

  // Línea del período elegido (acento de la interfaz)
  const lineCurr = d3
    .line<PuntoGrafico>()
    .defined((d) => d.current !== null)
    .x((d) => xScale(d.dateObj))
    .y((d) => yScale(d.current ?? 0))
    .curve(d3.curveMonotoneX);

  // Línea del período anterior (gris punteada)
  const linePrev = d3
    .line<PuntoGrafico>()
    .defined((d) => d.previous !== null)
    .x((d) => xScale(d.dateObj))
    .y((d) => yScale(d.previous ?? 0))
    .curve(d3.curveMonotoneX);

  // Área gradiente (solo para la actual)
  const areaGenerator = d3
    .area<PuntoGrafico>()
    .defined((d) => d.current !== null)
    .x((d) => xScale(d.dateObj))
    .y0(innerHeight)
    .y1((d) => yScale(d.current ?? 0))
    .curve(d3.curveMonotoneX);

  const xTicks = xScale.ticks(width < 500 ? 4 : 6);
  const yTicks = yScale.ticks(5);

  // Resumen para lectores de pantalla: el dibujo solo no le dice nada a quien no lo ve.
  const totalActual = data.points.reduce((acc, p) => acc + (p.current ?? 0), 0);
  const totalAnterior = data.points.reduce((acc, p) => acc + (p.previous ?? 0), 0);
  const resumenAccesible = data.hasPrevious
    ? `Ventas del período: ${formatoMoneda(totalActual)}. Período anterior: ${formatoMoneda(totalAnterior)}.`
    : `Ventas del período: ${formatoMoneda(totalActual)}.`;

  // Mouse, lápiz y dedo: pointer events. Con mousemove el tooltip nunca aparecía en celular.
  const handlePointerMove = (event: React.PointerEvent<SVGRectElement>) => {
    const [xPos] = d3.pointer(event);
    const dateOnX = xScale.invert(xPos);
    const bisectDate = d3.bisector<PuntoGrafico, Date>((d) => d.dateObj).left;
    const index = bisectDate(data.points, dateOnX, 1);
    const d0 = data.points[index - 1];
    const d1 = data.points[index];

    let closestData = d0;
    if (
      d1 &&
      dateOnX.getTime() - d0.dateObj.getTime() >
        d1.dateObj.getTime() - dateOnX.getTime()
    ) {
      closestData = d1;
    }

    // Calcula posición vertical usando el mayor valor para que el tooltip no tape
    const highestVal = Math.max(
      closestData.current || 0,
      closestData.previous || 0,
    );

    setHoveredData({
      x: xScale(closestData.dateObj),
      y: yScale(highestVal),
      data: closestData,
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[320px] mt-4 select-none"
    >
      <svg
        width={width}
        height={height}
        className="overflow-visible"
        role="img"
        aria-label={resumenAccesible}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--primary)" }} stopOpacity={0.18} />
            <stop offset="100%" style={{ stopColor: "var(--primary)" }} stopOpacity={0} />
          </linearGradient>
        </defs>

        <g transform={`translate(${margin.left},${margin.top})`}>
          {yTicks.map((tickValue) => (
            <g key={tickValue} transform={`translate(0, ${yScale(tickValue)})`}>
              <line
                x1={0}
                x2={innerWidth}
                className="stroke-border"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              <text
                x={-10}
                y={4}
                textAnchor="end"
                className="text-xs fill-muted-foreground font-medium tabular-nums"
              >
                {formatoMoneda(tickValue)}
              </text>
            </g>
          ))}

          {xTicks.map((tickValue) => (
            <g
              key={tickValue.getTime()}
              transform={`translate(${xScale(tickValue)}, ${innerHeight})`}
            >
              <text
                y={20}
                textAnchor="middle"
                className="text-xs fill-muted-foreground font-medium"
              >
                {periodo === "hoy"
                  ? `${tickValue.getHours()}:00`
                  : tickValue.toLocaleDateString("es-AR", {
                      day: "numeric",
                      month: "short",
                    })}
              </text>
            </g>
          ))}

          {/* DIBUJO DE LÍNEAS. Sin transition-all: el atributo `d` no anima con CSS, y
              "all" enciende transiciones en propiedades que no deberían moverse. */}
          {data.hasPrevious && (
            <path
              d={linePrev(data.points) || ""}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth={2}
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
          )}

          <path
            d={areaGenerator(data.points) || ""}
            fill={`url(#${gradientId})`}
          />

          <path
            d={lineCurr(data.points) || ""}
            fill="none"
            style={{ stroke: "var(--primary)" }}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <rect
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            style={{ touchAction: "pan-y" }}
            onPointerDown={handlePointerMove}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoveredData(null)}
          />

          {hoveredData && (
            <g>
              <line
                x1={hoveredData.x}
                x2={hoveredData.x}
                y1={0}
                y2={innerHeight}
                className="stroke-primary opacity-70 pointer-events-none"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
              {hoveredData.data.current !== null && (
                <circle
                  cx={hoveredData.x}
                  cy={yScale(hoveredData.data.current)}
                  r={5}
                  className="fill-card stroke-primary pointer-events-none"
                  strokeWidth={3}
                />
              )}
              {data.hasPrevious && hoveredData.data.previous !== null && (
                <circle
                  cx={hoveredData.x}
                  cy={yScale(hoveredData.data.previous)}
                  r={4}
                  className="fill-card stroke-muted-foreground pointer-events-none"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
        </g>
      </svg>

      {/* TOOLTIP: en tokens, así sigue al modo oscuro */}
      {hoveredData && (
        <div
          className="absolute pointer-events-none z-10 bg-card text-card-foreground border border-border shadow-xl rounded-xl p-3.5 transform -translate-x-1/2 -translate-y-[120%] min-w-[160px]"
          style={{
            left: hoveredData.x + margin.left,
            top: hoveredData.y + margin.top,
          }}
        >
          <div className="text-xs text-muted-foreground font-semibold mb-2.5">
            {hoveredData.data.label}
          </div>

          <div className="flex flex-col gap-1.5">
            {hoveredData.data.current !== null && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <span className="w-2 h-2 rounded-full bg-primary" />
                  Actual
                </span>
                <span className="font-bold text-sm tabular-nums text-foreground">
                  {formatoMoneda(hoveredData.data.current)}
                </span>
              </div>
            )}

            {data.hasPrevious && hoveredData.data.previous !== null && (
              <div className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                  {hoveredData.data.prevLabel}
                </span>
                <span className="font-bold text-sm tabular-nums text-muted-foreground">
                  {formatoMoneda(hoveredData.data.previous)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
