"use client";

import { useState } from "react";
import { formatearMoneda } from "@/shared/utils/formatters";

type HeatmapNode = HeatmapProps["data"][number];

interface HeatmapProps {
  data: {
    dia: string;
    horaInicio: number;
    horaTexto: string;
    ingresos: number;
    ventas: number;
    unidades: number;
    ticketPromedio: number;
  }[];
}

const DIAS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
const FRANJAS = [8, 10, 12, 14, 16, 18, 20];

function getHeatmapColor(value: number, max: number) {
  if (value === 0) return "bg-muted dark:bg-muted/40";

  const ratio = max > 0 ? value / max : 0;

  if (ratio < 0.2) return "bg-chart-4/10";
  if (ratio < 0.4) return "bg-chart-4/20 dark:bg-chart-4/40";
  if (ratio < 0.6) return "bg-chart-4/30 dark:bg-chart-4/50";
  if (ratio < 0.8) return "bg-chart-4/40 dark:bg-success/60";

  return "bg-chart-4";
}

export function HeatmapChart({ data }: Readonly<HeatmapProps>) {
  const [hoveredData, setHoveredData] = useState<
    | ((typeof data)[0] & {
        x: number;
        y: number;
        isRightEdge: boolean;
        isTopEdge: boolean;
      })
    | null
  >(null);

  const maxValue = Math.max(...data.map((d) => d.ingresos), 0);

  const getDataNode = (dia: string, horaInicio: number) => {
    return data.find((d) => d.dia === dia && d.horaInicio === horaInicio);
  };

  const handleMouseMove = (
    e: React.MouseEvent,
    node: HeatmapNode | undefined,
    colIndex: number,
    rowIndex: number,
  ) => {
    if (!node) return;
    const rect =
      e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();

    const isRightEdge = colIndex >= FRANJAS.length - 2;
    const isTopEdge = rowIndex <= 3;

    if (rect) {
      setHoveredData({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        isRightEdge,
        isTopEdge,
        ...node,
      });
    }
  };

  if (maxValue === 0) {
    return (
      <div className="h-70 w-full flex items-center justify-center text-muted-foreground text-sm bg-muted/20 rounded-xl border border-dashed border-border">
        No hay suficientes datos registrados.
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto relative select-none">
      <div className="min-w-150 flex flex-col gap-1.5 py-2">
        <div className="flex pl-10 sm:pl-12 gap-1.5">
          {FRANJAS.map((h) => (
            <div
              key={h}
              className="flex-1 text-center text-[10px] sm:text-xs text-muted-foreground font-semibold tracking-tighter sm:tracking-normal"
            >
              {h.toString().padStart(2, "0")}-{h + 2}h
            </div>
          ))}
        </div>

        {/* CUADRÍCULA DÍA/HORA */}
        {DIAS.map((dia, rowIndex) => (
          <div key={dia} className="flex items-center gap-1.5 h-8 sm:h-10">
            {/* ETIQUETA DEL DÍA */}
            <div className="w-10 sm:w-12 shrink-0 text-[10px] sm:text-xs text-muted-foreground font-bold text-right pr-2 uppercase">
              {dia.substring(0, 3)}
            </div>

            {/* CELDAS DE CALOR */}
            {FRANJAS.map((hora, colIndex) => {
              const node = getDataNode(dia, hora);
              const val = node?.ingresos || 0;
              const colorClass = getHeatmapColor(val, maxValue);

              return (
                <div
                  key={`${dia}-${hora}`}
                  className={`
      flex-1 h-full rounded-md cursor-pointer transition-all duration-300 z-0 hover:z-10
      ${colorClass}
      ${val > 0 ? "" : "hover:bg-muted/40 dark:hover:bg-muted/20"}
    `}
                  onMouseMove={(e) =>
                    handleMouseMove(e, node, colIndex, rowIndex)
                  }
                  onMouseLeave={() => setHoveredData(null)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* TOOLTIP FLOTANTE */}
      {hoveredData && (
        <div
          className={`absolute pointer-events-none z-30 bg-card border border-border shadow-xl rounded-xl p-4 animate-in fade-in zoom-in-95 duration-100 min-w-[200px]
        ${hoveredData.isRightEdge ? "-translate-x-full" : "-translate-x-1/2"} 
        ${hoveredData.isTopEdge ? "translate-y-4" : "-translate-y-[110%]"}`}
          style={{
            left: hoveredData.isRightEdge ? hoveredData.x - 10 : hoveredData.x,
            top: hoveredData.y,
          }}
        >
          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-sm gap-4">
              <span className="text-muted-foreground">Ingresos:</span>
              <span className="font-semibold text-success">
                {formatearMoneda(hoveredData.ingresos)}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm gap-4">
              <span className="text-muted-foreground">Ventas:</span>
              <span className="font-medium text-foreground">
                {hoveredData.ventas} tickets
              </span>
            </div>
            <div className="flex justify-between items-center text-sm gap-4">
              <span className="text-muted-foreground">Piezas:</span>
              <span className="font-medium text-foreground">
                {hoveredData.unidades} u.
              </span>
            </div>
            <div className="flex justify-between items-center text-sm gap-4 pt-1.5 border-t border-border/60">
              <span className="text-muted-foreground">Ticket prom:</span>
              <span className="font-medium text-foreground">
                {formatearMoneda(hoveredData.ticketPromedio)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
