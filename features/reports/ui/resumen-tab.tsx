import { etiquetaFraccionado } from "@/features/dashboard/lib/unidades-vendidas";
import { KpiFranja, KpiMiniCard } from "@/features/dashboard/ui/kpi-mini-card";
import { Venta } from "@/entities/ventas/types";
import { PeriodoDashboard } from "@/features/dashboard/lib/get-dashboard-metrics";
import { BarChart } from "@/features/reports/ui/bar-chart";
import { SalesChart } from "@/features/reports/ui/sales-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { TabsContent } from "@/shared/ui/tabs";
import { Info } from "lucide-react";
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

/** Ícono de ayuda con área táctil de 44px (mostrador en celular). Sin esto el
 * tooltip de 14px no se alcanza con el dedo. */
function AyudaTooltip({ titulo, children }: Readonly<{ titulo: string; children: string }>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Qué significa ${titulo}`}
          className="-m-2.5 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[250px] text-xs">
        <p>{children}</p>
      </TooltipContent>
    </Tooltip>
  );
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
        <KpiFranja>
          <KpiMiniCard
            label="Ingresos brutos"
            value={formatearMoneda(metrics.ingresos)}
            variacion={
              <AyudaTooltip titulo="Ingresos brutos">
                Suma total de todas las ventas: todo el dinero que ingresó, sin descontar gastos, costos ni bajas.
              </AyudaTooltip>
            }
          />
          <KpiMiniCard
            label="Ganancia bruta"
            detalle="Ingresos menos costo de mercadería"
            value={formatearMoneda(metrics.gananciaBrutaVentas)}
            variacion={
              <AyudaTooltip titulo="Ganancia bruta">
                Ingresos brutos menos el costo de la mercadería vendida: lo que pagaste a tus proveedores por esos productos.
              </AyudaTooltip>
            }
          />
          <KpiMiniCard
            label="Unidades vendidas"
            detalle={`Ticket medio ${formatearMoneda(metrics.ticketPromedio)}${etiquetaFraccionado(metrics.fraccionadoVendido) ? ` · ${etiquetaFraccionado(metrics.fraccionadoVendido)}` : ""}`}
            value={`${metrics.unidadesVendidas} u.`}
            variacion={null}
          />
          <KpiMiniCard
            label="Margen operativo"
            detalle={`Resultado operativo ${formatearMoneda(metrics.gananciaNeta)}${metrics.coberturaCosto != null ? ` · costo cargado en ${metrics.coberturaCosto}% de lo vendido` : ""}`}
            value={`${metrics.margenPorcentaje.toFixed(1)}%`}
            valorClassName={metrics.margenPorcentaje < 0 ? "text-danger" : "text-foreground"}
            variacion={
              <AyudaTooltip titulo="Margen operativo">
                Ganancia bruta menos los gastos operativos cargados en la caja (fletes, insumos, etc.). Los retiros de dueño y las compras de mercadería NO restan acá: el primero es ganancia ya hecha y el segundo ya está en el costo de lo vendido.
              </AyudaTooltip>
            }
          />
        </KpiFranja>
      </TooltipProvider>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Flujo de ingresos diarios</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesChart ventas={ventasDelPeriodo} periodo={periodo} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-1 border-border shadow-none">
          <CardHeader>
            <CardTitle className="text-lg">Días de mayor venta</CardTitle>
          </CardHeader>
          <CardContent className="overflow-hidden">
            {/* Mismo acento que el panel: --viz-1 (azul Comerz). */}
            <BarChart
              data={metrics.ventasPorDia}
              color="#3363d2"
              valuePrefix="$"
            />
          </CardContent>
        </Card>
      </div>
    </TabsContent>
  );
}
