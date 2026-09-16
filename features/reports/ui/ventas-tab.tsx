"use client";

import { etiquetaFraccionado } from "@/features/dashboard/lib/unidades-vendidas";
import { useState } from "react";
import { BarChart } from "@/features/reports/ui/bar-chart";
import { HeatmapChart } from "@/features/reports/ui/heatmap-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { TabsContent } from "@/shared/ui/tabs";
import {
  CreditCard,
  DollarSign,
  Package,
  ShoppingCart,
  Tags,
  CalendarDays,
  ListFilter,
  Trophy,
} from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import { ReportesMetrics } from "@/entities/reportes/types";

interface VentasTabProps {
  metrics: ReportesMetrics | any;
}

type MetricaCategoria = "ingresos" | "unidades" | "tickets";

export function VentasTab({ metrics }: Readonly<VentasTabProps>) {
  const [metricaCat, setMetricaCat] = useState<MetricaCategoria>("ingresos");

  const totalBrutoCobrado = (metrics.ventasPorMetodo || []).reduce(
    (acc: number, metodo: { bruto: number }) => acc + Number(metodo.bruto || 0),
    0,
  );

  // Formateo Dinámico de la data de categorías según el selector elegido
  const dataCategoria = metrics.ventasPorCategoria
    .map((c: any) => ({
      label: c.label,
      value: c[metricaCat],
    }))
    .sort((a: any, b: any) => b.value - a.value)
    .slice(0, 10);

  // Asignamos colores y prefijos dinámicos
  const colorCategoria =
    metricaCat === "ingresos"
      ? "#ef806f"
      : metricaCat === "unidades"
        ? "#00b3c2"
        : "#e6ac3d";

  const prefixCategoria = metricaCat === "ingresos" ? "$" : "";

  return (
    <TabsContent
      value="ventas"
      className="space-y-6 outline-none animate-in fade-in-50 pt-2"
    >
      {/* ── KPIs SUPERIORES ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ingresos Brutos
            </CardTitle>
            <DollarSign className="w-4 h-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatearMoneda(metrics.ingresos)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cantidad de Ventas
            </CardTitle>
            <ShoppingCart className="w-4 h-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {metrics.ordenes}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                tickets
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unidades Vendidas
            </CardTitle>
            <Package className="w-4 h-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {metrics.unidadesVendidas}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                u.
              </span>
            </div>
            {etiquetaFraccionado(metrics.fraccionadoVendido) && (
              <p className="text-xs text-muted-foreground mt-1">
                {etiquetaFraccionado(metrics.fraccionadoVendido)} por peso o
                medida
              </p>
            )}
          </CardContent>
        </Card>
        <Card className="border-border shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ticket Promedio
            </CardTitle>
            <Tags className="w-4 h-4 text-violet-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatearMoneda(metrics.ticketPromedio)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── CUADRÍCULA DE ANÁLISIS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico Estrella: Heatmap y Top 3 (Ocupa toda la fila) */}
        <Card className="lg:col-span-3 border-border shadow-none">
          <CardHeader className=" border-b border-border/50 pb-4 mb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-success" />
              Densidad Operativa
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col lg:flex-row gap-8 pt-4">
            {/* Izquierda: Heatmap */}
            <div className="flex-1 overflow-hidden hidden md:block">
              <HeatmapChart data={metrics.ventasHeatmap} />
            </div>

            {/* Derecha: Top 3 Mejores Franjas */}
            <div className="w-full lg:w-72 shrink-0 flex flex-col gap-4 border-t lg:border-t-0 lg:border-l border-border pt-6 lg:pt-0 lg:pl-6">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Trophy className="w-4 h-4 text-warning" /> Mejores franjas
              </h3>

              {metrics.topFranjas && metrics.topFranjas.length > 0 ? (
                <div className="space-y-3">
                  {metrics.topFranjas.map((franja: any, idx: number) => (
                    <div key={idx} className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-muted-foreground">
                          {idx + 1}. {franja.dia}{" "}
                          {franja.horaInicio.toString().padStart(2, "0")} a{" "}
                          {franja.horaFin.toString().padStart(2, "0")}hs
                        </span>
                      </div>
                      <span className="text-lg font-semibold text-foreground">
                        {formatearMoneda(franja.ingresos)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No hay suficientes datos aún.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fila Inferior 1/2: Categorías (2 columnas) */}
        <Card className="lg:col-span-2 border-border shadow-none">
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 gap-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <ListFilter className="w-5 h-5 text-chart-1" />
              Ventas por Categoría
            </CardTitle>

            {/* Selector de Métricas */}
            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-lg border border-border/50 shrink-0 overflow-x-auto w-full sm:w-auto">
              <button
                onClick={() => setMetricaCat("ingresos")}
                className={`flex-1 sm:flex-none text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${metricaCat === "ingresos" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Ingresos
              </button>
              <button
                onClick={() => setMetricaCat("unidades")}
                className={`flex-1 sm:flex-none text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${metricaCat === "unidades" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Unidades
              </button>
              <button
                onClick={() => setMetricaCat("tickets")}
                className={`flex-1 sm:flex-none text-xs font-semibold px-3 py-1.5 rounded-md transition-all ${metricaCat === "tickets" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Tickets
              </button>
            </div>
          </CardHeader>
          <CardContent className="overflow-hidden pt-2">
            <BarChart
              data={dataCategoria}
              color={colorCategoria}
              valuePrefix={prefixCategoria}
            />
          </CardContent>
        </Card>

        {/* 🚀 Fila Inferior 2/2: Métodos de Pago Progress Bar (1 columna) */}
        <Card className="lg:col-span-1 border-border flex flex-col shadow-none">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-chart-3" /> Métodos de Pago
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            {metrics.ventasPorMetodo.length > 0 ? (
              <div className="space-y-4 w-full">
                {metrics.ventasPorMetodo.map((metodo: any, idx: number) => {
                  // Sobre el total cobrado por método, no sobre ingresos: el
                  // desglose incluye cobros de deuda, que no son ingresos del
                  // período y desbordarían la barra.
                  const porcentaje =
                    totalBrutoCobrado > 0
                      ? (metodo.bruto / totalBrutoCobrado) * 100
                      : 0;
                  return (
                    <div key={idx} className="flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-sm uppercase text-muted-foreground">
                          {metodo.label}
                        </span>
                        <span className="font-bold text-foreground">
                          {formatearMoneda(metodo.bruto)}
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-chart-3 h-full rounded-full transition-all duration-500"
                          style={{ width: `${porcentaje}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center text-muted-foreground text-sm py-8">
                Sin datos registrados.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
