"use client";

import { etiquetaFraccionado } from "@/features/dashboard/lib/unidades-vendidas";
import { KpiFranja, KpiMiniCard } from "@/features/dashboard/ui/kpi-mini-card";
import { useState } from "react";
import { VendedoresSeccion } from "@/features/reports/ui/vendedores-tab";
import { RankingCategorias } from "@/features/reports/ui/ranking-categorias";
import { MetodosPagoDonut } from "@/features/reports/ui/metodos-pago-donut";
import { HeatmapChart } from "@/features/reports/ui/heatmap-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { TabsContent } from "@/shared/ui/tabs";
import { CalendarDays, ListFilter, Trophy } from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import { ReportesMetrics } from "@/entities/reportes/types";

interface VentasTabProps {
  metrics: ReportesMetrics;
  /** Permiso y rango de la sección Vendedores (que vive dentro de Ventas). */
  vendedores: { puedeVer: boolean; desde: string; hasta: string };
}

type MetricaCategoria = "ingresos" | "unidades" | "tickets";

const METRICAS_CATEGORIA: { valor: MetricaCategoria; etiqueta: string }[] = [
  { valor: "ingresos", etiqueta: "Ingresos" },
  { valor: "unidades", etiqueta: "Unidades" },
  { valor: "tickets", etiqueta: "Tickets" },
];


export function VentasTab({ metrics, vendedores }: Readonly<VentasTabProps>) {
  const [metricaCat, setMetricaCat] = useState<MetricaCategoria>("ingresos");

  // Formateo dinámico de la data de categorías según el selector elegido
  const dataCategoria = metrics.ventasPorCategoria
    .map((c) => ({
      label: c.label,
      value: c[metricaCat],
      // En "Unidades" el fraccionado (kg, m) va al lado: no se suma con las piezas.
      detalle:
        metricaCat === "unidades"
          ? (etiquetaFraccionado(c.fraccionado) ?? undefined)
          : undefined,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Total de TODAS las categorías (no solo el top 10): el % que se muestra es real.
  const totalCategorias = metrics.ventasPorCategoria.reduce(
    (acc, c) => acc + c[metricaCat],
    0,
  );
  const formatearCategoria = (valor: number) =>
    metricaCat === "ingresos" ? formatearMoneda(valor) : valor.toLocaleString("es-AR");
  const fraccionado = etiquetaFraccionado(metrics.fraccionadoVendido);

  return (
    <TabsContent
      value="ventas"
      className="space-y-6 outline-none animate-in fade-in-50 pt-2"
    >
      {/* ── NÚMEROS ── mismo formato que Resumen y el panel */}
      <KpiFranja>
        <KpiMiniCard
          label="Ingresos brutos"
          value={formatearMoneda(metrics.ingresos)}
          variacion={null}
        />
        <KpiMiniCard
          label="Cantidad de ventas"
          value={`${metrics.ordenes} tickets`}
          variacion={null}
        />
        <KpiMiniCard
          label="Unidades vendidas"
          detalle={fraccionado ?? undefined}
          value={`${metrics.unidadesVendidas} u.`}
          variacion={null}
        />
        <KpiMiniCard
          label="Ticket promedio"
          value={formatearMoneda(metrics.ticketPromedio)}
          variacion={null}
        />
      </KpiFranja>

      {/* ── ANÁLISIS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Densidad: heatmap (desde md) y las tres mejores franjas */}
        <Card className="lg:col-span-2 border-border shadow-none">
          <CardHeader className="border-b border-border/50 pb-4 mb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              Densidad operativa
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 pt-4">
            <div className="flex-1 overflow-hidden hidden md:block">
              <HeatmapChart data={metrics.ventasHeatmap} />
            </div>

            <div className="w-full border-t border-border pt-4 flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Trophy className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                Mejores franjas
              </h3>

              {metrics.topFranjas && metrics.topFranjas.length > 0 ? (
                <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {metrics.topFranjas.map((franja, idx) => (
                    <li key={idx} className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {idx + 1}. {franja.dia}{" "}
                        {franja.horaInicio.toString().padStart(2, "0")} a{" "}
                        {franja.horaFin.toString().padStart(2, "0")} hs
                      </span>
                      <span className="text-lg font-semibold text-foreground tabular-nums">
                        {formatearMoneda(franja.ingresos)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Todavía no hay datos suficientes.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Métodos de pago */}
        <Card className="lg:col-span-1 border-border flex flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Métodos de pago</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <MetodosPagoDonut
              data={metrics.ventasPorMetodo.map((m) => ({ label: m.label, bruto: m.bruto }))}
              formatearMoneda={formatearMoneda}
            />
          </CardContent>
        </Card>
        {/* Categorías a ancho completo: los nombres largos necesitan lugar sin partirse */}
        <Card className="lg:col-span-3 border-border shadow-none">
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <ListFilter className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
              Ventas por categoría
            </CardTitle>

            <div
              role="group"
              aria-label="Medir categorías por"
              className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border/50 shrink-0 w-full sm:w-auto"
            >
              {METRICAS_CATEGORIA.map((m) => {
                const activa = metricaCat === m.valor;
                return (
                  <button
                    key={m.valor}
                    type="button"
                    aria-pressed={activa}
                    onClick={() => setMetricaCat(m.valor)}
                    className={`flex-1 sm:flex-none min-h-11 sm:min-h-0 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors cursor-pointer ${activa ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {m.etiqueta}
                  </button>
                );
              })}
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <RankingCategorias
              data={dataCategoria}
              total={totalCategorias}
              formatearValor={formatearCategoria}
            />
          </CardContent>
        </Card>

      </div>

      <VendedoresSeccion
        puedeVer={vendedores.puedeVer}
        desde={vendedores.desde}
        hasta={vendedores.hasta}
      />
    </TabsContent>
  );
}
