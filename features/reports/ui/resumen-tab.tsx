import { etiquetaFraccionado } from "@/features/dashboard/lib/unidades-vendidas";
import { Venta } from "@/entities/ventas/types";
import { PeriodoDashboard } from "@/features/dashboard/lib/get-dashboard-metrics";
import { BarChart } from "@/features/reports/ui/bar-chart";
import { SalesChart } from "@/features/reports/ui/sales-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { TabsContent } from "@/shared/ui/tabs";
import { DollarSign, Percent, Tags, TrendingUp, Info } from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import { ReportesMetrics } from "@/entities/reportes/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";

interface ResumenTabProps {
  metrics: ReportesMetrics;
  ventasDelPeriodo: Venta[];
  periodo: PeriodoDashboard;
}

export function ResumenTab({
  metrics,
  ventasDelPeriodo,
  periodo,
}: Readonly<ResumenTabProps>) {
  return (
    <TabsContent
      value="resumen"
      className="space-y-6 outline-none animate-in fade-in-50 pt-2"
    >
      <TooltipProvider>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {/* INGRESOS BRUTOS */}
          <Card className="border-border shadow-none">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Ingresos Brutos
                </CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[250px] text-xs">
                    <p>
                      Suma total de todas las ventas. Es todo el dinero que
                      ingresó sin descontar ningún tipo de gasto, costo o baja.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <DollarSign className="w-4 h-4 text-chart-1" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {formatearMoneda(metrics.ingresos)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                Total facturado (ventas puras).
              </p>
            </CardContent>
          </Card>

          {/* GANANCIA BRUTA */}
          <Card className="border-border shadow-none">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Ganancia Bruta
                </CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground/50 cursor-pointer hover:text-muted-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[250px] text-xs">
                    <p>
                      Ingresos Brutos menos el costo de la mercadería vendida
                      (lo que pagaste a tus proveedores por esos productos
                      específicos).
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <TrendingUp className="w-4 h-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {formatearMoneda(metrics.gananciaBrutaVentas)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                Ingresos menos costo de mercadería.
              </p>
            </CardContent>
          </Card>

          {/* UNIDADES / TICKET */}
          <Card className="border-border shadow-none">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Unidades / Ticket
              </CardTitle>
              <Tags className="w-4 h-4 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {metrics.unidadesVendidas}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  u.
                </span>
                {etiquetaFraccionado(metrics.fraccionadoVendido) && (
                  <span className="text-xs font-normal text-muted-foreground ml-2">
                    {etiquetaFraccionado(metrics.fraccionadoVendido)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Ticket medio: {formatearMoneda(metrics.ticketPromedio)}
              </p>
            </CardContent>
          </Card>

          {/* MARGEN OPERATIVO */}
          <Card className="shadow-none bg-muted/10 border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium text-chart-1">
                  Margen operativo
                </CardTitle>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-chart-1 cursor-pointer hover:text-chart-1 transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[250px] text-xs bg-foreground text-background border-border">
                    <p>
                      Ganancia Bruta menos los gastos operativos cargados en la
                      caja (fletes, insumos, etc). Los retiros de dueño y las
                      compras de mercadería NO restan acá: el primero es la
                      ganancia ya hecha y el segundo ya viene contado en el
                      costo de lo vendido.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Percent className="w-4 h-4 text-chart-1" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-semibold ${metrics.margenPorcentaje < 0 ? "text-destructive" : "text-chart-1"}`}
              >
                {metrics.margenPorcentaje.toFixed(1)}%
              </div>
              <div className="flex flex-col md:flex-row mt-1 items-center">
                <p className="text-xs text-muted-foreground font-medium">
                  {formatearMoneda(metrics.gananciaNeta)} -{" "}
                </p>
                <p className="text-xs text-muted-foreground">
                  {"  "}Ganancia bruta menos gastos operativos.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </TooltipProvider>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Flujo de Ingresos Diarios</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart ventas={ventasDelPeriodo} periodo={periodo} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-1 border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Dias de Mayor Venta</CardTitle>
          </CardHeader>
          <CardContent className="overflow-hidden">
            <BarChart
              data={metrics.ventasPorDia}
              color="#c781cb"
              valuePrefix="$"
            />
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
