"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricaSerie, PuntoSerieChart } from "../lib/build-chart-series";
import { VENTANA_MEDIA_MOVIL } from "../lib/build-chart-series";
import { formatearMoneda } from "@/shared/utils/formatters";
import { MEDIA_MOBILE, useMediaQuery } from "@/shared/lib/use-media-query";

const TABS: { value: MetricaSerie; label: string }[] = [
  { value: "ingresos", label: "Facturación" },
  { value: "unidades", label: "Unidades" },
  { value: "ganancia", label: "Ganancia" },
];

const COLOR_POR_METRICA: Record<MetricaSerie, string> = {
  ingresos: "var(--color-primary, #6366f1)",
  unidades: "#0ea5e9",
  ganancia: "#10b981",
};

const compactFormatter = new Intl.NumberFormat("es-AR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatearValorEje(metrica: MetricaSerie, value: number): string {
  if (metrica === "unidades") return compactFormatter.format(value);
  return `$${compactFormatter.format(value)}`;
}

function formatearValorTooltip(metrica: MetricaSerie, value: number): string {
  if (metrica === "unidades") return `${Math.round(value)} u.`;
  return formatearMoneda(value);
}

interface IngresosAreaChartProps {
  serie: PuntoSerieChart[];
  /** "últimos 28 días" — de dónde salen los datos. */
  etiquetaPeriodo: string;
}

/**
 * Chart del panel. NO tiene selector propio de rango y TAMPOCO sigue al
 * selector general: grafica siempre la ventana móvil de 4 semanas que termina
 * hoy (la serie ya viene resuelta desde el server). Las tabs cambian qué
 * métrica se grafica, no el recorte temporal.
 *
 * BARRAS y no área: lo que hay son totales diarios discretos, y un área dibuja
 * una rampa continua entre el martes y el miércoles que no existe. Además el
 * patrón semanal (sábado alto, lunes bajo) se lee de un vistazo en barras, y
 * ese patrón es la única parte del panel que contesta "¿qué días vendo?" — que
 * se traduce directo en cuánta gente poner el sábado.
 *
 * La LÍNEA es la media móvil de 7 días: es lo que saca el diente de sierra
 * semanal y deja ver la tendencia de verdad. Arranca en el día 7 y termina
 * ayer, porque una media sobre ventana incompleta dibuja caídas que no
 * pasaron (ver `agregarMediaMovil`).
 *
 * Ya NO se dibuja la serie del período anterior: comparar día contra día con
 * ~8 ventas diarias es ruido contra ruido, y el veredicto ya lo dan los badges
 * de las KPIs con el número exacto.
 *
 * En mobile el eje Y se oculta y el área del gráfico se estira contra los
 * bordes de la card: el valor exacto se consulta tocando o deslizando el dedo
 * sobre el gráfico (tooltip). En desktop el eje Y queda como estaba.
 */
export function IngresosAreaChart({
  serie,
  etiquetaPeriodo,
}: Readonly<IngresosAreaChartProps>) {
  const [metrica, setMetrica] = useState<MetricaSerie>("ingresos");
  // En mobile el eje Y se come ~56px de un ancho de 320 y deja el área del
  // gráfico demasiado angosta para el dedo: se saca el eje y el valor exacto
  // se consulta con el tooltip (touch/drag). En desktop sigue igual.
  const esMobile = useMediaQuery(MEDIA_MOBILE);

  const color = COLOR_POR_METRICA[metrica];
  const claveMedia = `${metrica}Media` as const;

  const data = useMemo(
    () =>
      serie.map((p) => ({
        etiqueta: p.etiqueta,
        etiquetaCompleta: p.etiquetaCompleta,
        esHoy: p.esHoy,
        valor: p[metrica],
        media: p[claveMedia],
      })),
    [serie, metrica, claveMedia],
  );

  const hayMedia = data.some((p) => p.media !== null);

  // Densidad del eje X: 28 etiquetas se enciman. `interval` es cuántos ticks
  // saltear entre uno y otro, de ahí el -1. En mobile entran ~4, en desktop ~8.
  const intervaloTicks = Math.max(
    0,
    Math.ceil(data.length / (esMobile ? 4 : 8)) - 1,
  );

  return (
    <div className="bg-card border border-border rounded-xl p-3 sm:p-4 flex flex-col gap-3 h-full">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tendencia
          </span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2 rounded-[2px]"
                style={{ background: color, opacity: 0.45 }}
              />
              {etiquetaPeriodo}
            </span>
            {hayMedia && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-0.5 w-3 rounded-full"
                  style={{ background: color }}
                />
                promedio {VENTANA_MEDIA_MOVIL} días
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2 rounded-[2px] border border-dashed"
                style={{ borderColor: color }}
              />
              hoy (en curso)
            </span>
          </div>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setMetrica(tab.value)}
              className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                metrica === tab.value
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* flex-1, no alto fijo: en el bento la card se estira hasta la altura de
          la columna, y lo que sobra tiene que volverse gráfico y no aire. El
          min-h es el piso para cuando no hay sobrante (mobile, donde la card
          mide lo que mide su contenido).
          touch-action pan-y: el deslizamiento vertical sigue scrolleando la
          página, el horizontal se lo queda el chart para mover el tooltip. */}
      <div
        className="flex-1 min-h-[240px] sm:min-h-[260px] w-[calc(100%+1rem)] -mx-2 sm:w-full sm:mx-0"
        style={{ touchAction: "pan-y" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={
              esMobile
                ? { top: 8, right: 4, left: 4, bottom: 0 }
                : { top: 8, right: 8, left: 0, bottom: 0 }
            }
          >
            <CartesianGrid
              vertical={false}
              strokeDasharray="3 3"
              className="stroke-border"
            />
            <XAxis
              dataKey="etiqueta"
              tick={{
                fontSize: esMobile ? 10 : 11,
                fill: "var(--muted-foreground)",
              }}
              axisLine={false}
              tickLine={false}
              interval={intervaloTicks}
              minTickGap={esMobile ? 8 : 16}
              tickMargin={4}
            />
            {/* En mobile va `hide` y no desmontado: el eje sigue definiendo la
                escala, pero no dibuja nada ni reserva ancho. El valor exacto se
                lee en el tooltip. */}
            <YAxis
              hide={esMobile}
              tickFormatter={(v) => formatearValorEje(metrica, v)}
              tick={{
                fontSize: 11,
                fill: "var(--muted-foreground)",
                fontFamily: "var(--font-geist-mono)",
              }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              formatter={(value, name, item) => {
                const punto = item?.payload as
                  | { etiquetaCompleta: string; esHoy: boolean }
                  | undefined;
                if (name === "media") {
                  return [
                    formatearValorTooltip(metrica, Number(value)),
                    `promedio ${VENTANA_MEDIA_MOVIL} días`,
                  ];
                }
                const fecha = punto?.etiquetaCompleta ?? "";
                return [
                  formatearValorTooltip(metrica, Number(value)),
                  punto?.esHoy ? `${fecha} · en curso` : fecha,
                ];
              }}
              labelFormatter={() => ""}
              cursor={{ fill: "var(--muted-foreground)", fillOpacity: 0.08 }}
              offset={16}
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--card)",
                fontSize: 12,
              }}
            />
            <Bar dataKey="valor" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {/* La barra de hoy va hueca y punteada: es un día que todavía no
                  terminó, y pintada igual que las demás se lee todas las
                  mañanas como un desplome. */}
              {data.map((p) => (
                <Cell
                  key={p.etiqueta}
                  fill={color}
                  fillOpacity={p.esHoy ? 0.12 : 0.45}
                  stroke={p.esHoy ? color : undefined}
                  strokeWidth={p.esHoy ? 1 : 0}
                  strokeDasharray={p.esHoy ? "3 2" : undefined}
                />
              ))}
            </Bar>
            {hayMedia && (
              <Line
                type="monotone"
                dataKey="media"
                stroke={color}
                strokeWidth={2}
                dot={false}
                // Sin conectar nulls: la media arranca en el día 7 y termina
                // ayer, y esos huecos tienen que verse como huecos.
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
