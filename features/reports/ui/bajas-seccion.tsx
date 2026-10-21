import { Producto } from "@/entities/productos/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { KpiFranja, KpiMiniCard } from "@/features/dashboard/ui/kpi-mini-card";
import { RankingCategorias } from "@/features/reports/ui/ranking-categorias";
import { formatearMoneda } from "@/shared/utils/formatters";
import { formatearCantidad } from "@/shared/lib/unidad-venta";
import { BajaAprobadaReporte, ReportesMetrics } from "@/entities/reportes/types";

interface BajasSeccionProps {
  metrics: ReportesMetrics;
  bajasDelPeriodo: BajaAprobadaReporte[];
  productos: Producto[];
}

/**
 * Bajas (mermas) dentro de Inventario: lo que se rompió o se perdió y cuánto
 * costó. Un solo criterio de signo: los montos van siempre en positivo y la
 * palabra dice que es pérdida.
 */
export function BajasSeccion({
  metrics,
  bajasDelPeriodo,
  productos,
}: Readonly<BajasSeccionProps>) {
  const ratioMermas =
    metrics.ingresos > 0 ? (metrics.costoPerdidoBajas / metrics.ingresos) * 100 : 0;

  const motivos = metrics.bajasPorMotivo.map((m) => ({ label: m.label, value: m.value }));

  return (
    <section aria-labelledby="bajas-titulo" className="space-y-6">
      <div>
        <h2 id="bajas-titulo" className="text-lg font-semibold text-foreground">
          Bajas
        </h2>
        <p className="text-sm text-muted-foreground">
          Mercadería rota, vencida o perdida. Solo cuentan las bajas aprobadas.
        </p>
      </div>

      <KpiFranja>
        <KpiMiniCard
          label="Perdido en bajas"
          detalle="Al costo de compra"
          value={formatearMoneda(metrics.costoPerdidoBajas)}
          variacion={null}
        />
        <KpiMiniCard
          label="Unidades afectadas"
          detalle="Rotas o perdidas"
          value={`${metrics.unidadesBajas} u.`}
          variacion={null}
        />
        <KpiMiniCard
          label="Parte de lo vendido"
          detalle="Pérdida sobre ingresos brutos"
          value={`${ratioMermas.toFixed(1)}%`}
          valorClassName={ratioMermas >= 3 ? "text-danger" : "text-foreground"}
          variacion={null}
        />
      </KpiFranja>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border-border shadow-none lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Pérdidas por motivo</CardTitle>
          </CardHeader>
          <CardContent>
            <RankingCategorias
              data={motivos}
              total={metrics.costoPerdidoBajas}
              formatearValor={formatearMoneda}
            />
            {motivos.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin bajas registradas.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Historial ({bajasDelPeriodo.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {bajasDelPeriodo.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm font-medium text-muted-foreground">
                No hay bajas aprobadas en este período.
              </p>
            ) : (
              <>
                {/* Celular: una fila por baja. */}
                <ul className="divide-y divide-border/60 sm:hidden">
                  {bajasDelPeriodo.map((baja) => {
                    const prod = productos.find((p) => p.id === baja.producto_id);
                    const costo = Number(prod?.precio_costo || 0) * Number(baja.cantidad || 0);
                    return (
                      <li key={baja.id} className="flex items-start justify-between gap-3 px-5 py-3">
                        <span className="min-w-0">
                          <span className="block break-words text-sm font-medium text-foreground">
                            {prod?.nombre || "Producto eliminado"}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {new Date(baja.creado_en).toLocaleDateString("es-AR")} · {baja.motivo ?? "Sin motivo"} · {formatearCantidad(Number(baja.cantidad), prod?.unidad_medida)}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                          {formatearMoneda(costo)}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {/* Desde sm: tabla con encabezados. */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/40 text-xs font-semibold text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-5 py-3 font-semibold">Fecha</th>
                        <th scope="col" className="px-5 py-3 font-semibold">Producto</th>
                        <th scope="col" className="px-5 py-3 font-semibold">Motivo</th>
                        <th scope="col" className="px-5 py-3 text-right font-semibold">Costo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {bajasDelPeriodo.map((baja) => {
                        const prod = productos.find((p) => p.id === baja.producto_id);
                        const costo = Number(prod?.precio_costo || 0) * Number(baja.cantidad || 0);
                        return (
                          <tr key={baja.id} className="transition-colors hover:bg-muted/30">
                            <td className="whitespace-nowrap px-5 py-3 text-xs text-muted-foreground">
                              {new Date(baja.creado_en).toLocaleDateString("es-AR")}
                            </td>
                            <td className="px-5 py-3 font-medium text-foreground">
                              {prod?.nombre || "Producto eliminado"}
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                ({baja.variante}) · {formatearCantidad(Number(baja.cantidad), prod?.unidad_medida)}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-xs text-muted-foreground">{baja.motivo ?? "Sin motivo"}</td>
                            <td className="px-5 py-3 text-right font-semibold tabular-nums text-foreground">
                              {formatearMoneda(costo)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
