"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { TabsContent } from "@/shared/ui/tabs";
import { KpiFranja, KpiMiniCard } from "@/features/dashboard/ui/kpi-mini-card";
import { AlertTriangle, Clock, Flame, TrendingUp } from "lucide-react";
import { formatearMoneda } from "@/shared/utils/formatters";
import { etiquetaFraccionado } from "@/features/dashboard/lib/unidades-vendidas";
import { Producto } from "@/entities/productos/types";
import { BajaAprobadaReporte } from "@/entities/reportes/types";
import { BajasSeccion } from "@/features/reports/ui/bajas-seccion";
import { ReportesMetrics } from "@/entities/reportes/types";

interface InventarioTabProps {
  metrics: ReportesMetrics;
  bajasDelPeriodo: BajaAprobadaReporte[];
  productos: Producto[];
}

/** Ventanas para "sin movimiento". El default es la misma que usa el panel. */
const VENTANAS_DIAS = [30, 60, 90] as const;

export function InventarioTab({
  metrics,
  bajasDelPeriodo,
  productos,
}: Readonly<InventarioTabProps>) {
  const [filtroDias, setFiltroDias] = useState<number>(30);

  const productosSinMov = metrics.productosSinMovimiento
    .filter((p) => p.diasSinVender >= filtroDias)
    .sort((a, b) => b.diasSinVender - a.diasSinVender);

  const hayAlerta = metrics.productosCriticos > 0;

  return (
    <TabsContent
      value="inventario"
      className="space-y-6 outline-none animate-in fade-in-50 pt-2"
    >
      {/* ── NÚMEROS ── mismo formato que Resumen, Ventas y el panel */}
      <KpiFranja>
        <KpiMiniCard
          label="Capital en mercadería"
          detalle="Valor al costo: lo que pagaste"
          value={formatearMoneda(metrics.stockValorizadoCosto)}
          variacion={null}
        />
        <KpiMiniCard
          label="Venta potencial"
          detalle="Si vendés todo el stock"
          value={formatearMoneda(metrics.stockValorizadoPotencial)}
          variacion={null}
        />
        <KpiMiniCard
          label="Ganancia potencial"
          detalle="Venta potencial menos costo"
          value={formatearMoneda(metrics.stockGananciaPotencial)}
          valorClassName="text-success"
          variacion={null}
        />
        <KpiMiniCard
          label="Unidades en stock"
          detalle={[
            etiquetaFraccionado(metrics.stockFraccionado),
            hayAlerta ? `${metrics.productosCriticos} en nivel crítico` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined}
          value={`${metrics.stockTotalUnidades} u.`}
          valorClassName={hayAlerta ? "text-danger" : "text-foreground"}
          variacion={null}
        />
      </KpiFranja>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── MAYOR ROTACIÓN ── */}
        <Card className="border-border shadow-none flex flex-col">
          <CardHeader className="border-b border-border/40 pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Flame className="size-5 text-muted-foreground" aria-hidden="true" />
              Lo que más se vende
            </CardTitle>
            <p className="text-sm text-muted-foreground">Por unidades en el período.</p>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            {metrics.topProductos.length > 0 ? (
              <ol className="divide-y divide-border/60">
                {metrics.topProductos.slice(0, 5).map((producto, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 break-words text-sm font-medium text-foreground">
                        {producto.nombre}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {producto.cantidadEtiqueta}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="flex min-h-[200px] items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Todavía no hay ventas en este período.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── SIN MOVIMIENTO ── */}
        <Card className="border-border shadow-none flex flex-col">
          <CardHeader className="flex flex-col gap-4 border-b border-border/40 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg flex shrink-0 items-center gap-2">
              <Clock className="size-5 text-muted-foreground" aria-hidden="true" />
              Sin movimiento
            </CardTitle>

            <div
              role="group"
              aria-label="Días sin vender"
              className="flex w-full items-center gap-1 rounded-lg border border-border/50 bg-muted/50 p-1 sm:w-auto"
            >
              {VENTANAS_DIAS.map((dias) => {
                const activa = filtroDias === dias;
                return (
                  <button
                    key={dias}
                    type="button"
                    aria-pressed={activa}
                    onClick={() => setFiltroDias(dias)}
                    className={`min-h-11 flex-1 cursor-pointer rounded-md px-3 text-xs font-semibold transition-colors sm:min-h-0 sm:flex-none sm:py-1.5 ${
                      activa ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    +{dias} días
                  </button>
                );
              })}
            </div>
          </CardHeader>

          <CardContent className="p-0 flex-1">
            {productosSinMov.length > 0 ? (
              <ScrollArea className="h-[280px]">
                <ul className="divide-y divide-border/60">
                  {productosSinMov.map((producto, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="min-w-0 break-words text-sm font-medium text-foreground">
                        {producto.nombre}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {producto.diasSinVender === 9999
                          ? "Nunca se vendió"
                          : `Hace ${producto.diasSinVender} días`}
                      </span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            ) : (
              <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 p-8 text-center">
                <TrendingUp className="size-7 text-success" aria-hidden="true" />
                <p className="text-base font-semibold text-foreground">¡Buena rotación!</p>
                <p className="text-sm text-muted-foreground">
                  No tenés productos sin vender hace más de {filtroDias} días.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── STOCK CRÍTICO ── */}
      <Card className={`shadow-none ${hayAlerta ? "border-danger/30" : "border-border"}`}>
        <CardHeader className="border-b border-border/50 pb-4">
          <CardTitle className={`text-lg flex items-center gap-2 ${hayAlerta ? "text-danger" : ""}`}>
            <AlertTriangle className="size-5" aria-hidden="true" />
            Stock crítico (3 unidades o menos)
          </CardTitle>
        </CardHeader>

        <CardContent className="p-0">
          {metrics.stockCriticoDetallado.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm font-medium text-muted-foreground">
              Tu inventario está sano. No hay productos críticos.
            </p>
          ) : (
            <>
              {/* Celular: una fila por producto con la cantidad a la derecha. */}
              <ul className="divide-y divide-border/60 sm:hidden">
                {metrics.stockCriticoDetallado.map((item, idx) => (
                  <li key={idx} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold text-foreground">{item.nombre}</span>
                      {item.variante ? (
                        <span className="block break-words text-xs text-muted-foreground">{item.variante}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-danger">{item.cantidad} u.</span>
                  </li>
                ))}
              </ul>

              {/* Desde sm: tabla con encabezados. */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs font-semibold text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-5 py-3 font-semibold">Producto</th>
                      <th scope="col" className="px-5 py-3 font-semibold">Talle o variante</th>
                      <th scope="col" className="px-5 py-3 text-right font-semibold">Cantidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {metrics.stockCriticoDetallado.map((item, idx) => (
                      <tr key={idx} className="transition-colors hover:bg-muted/30">
                        <td className="px-5 py-3 font-medium text-foreground">{item.nombre}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{item.variante}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-danger">{item.cantidad} u.</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <BajasSeccion
        metrics={metrics}
        bajasDelPeriodo={bajasDelPeriodo}
        productos={productos}
      />
    </TabsContent>
  );
}
